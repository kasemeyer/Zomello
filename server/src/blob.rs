//! Attached files in Azure Blob Storage instead of the data folder, so the server can run where the
//! local disk doesn't survive a restart (Azure Container Apps, App Service). Turned on by setting
//! ZOMELLO_BLOB_ACCOUNT and ZOMELLO_BLOB_KEY (and optionally ZOMELLO_BLOB_CONTAINER, default
//! "zomello-files"); without them files stay on disk and nothing here runs. The database itself is
//! not handled here — Litestream streams it to Blob from the container's entrypoint (Dockerfile).
//!
//! Talks to the Blob REST API directly (PUT/GET + SharedKey signing) over the same hyper + rustls
//! stack the calendar fetcher uses, so this adds no HTTP or Azure SDK dependencies.
//! ZOMELLO_BLOB_ENDPOINT (e.g. http://127.0.0.1:10000/devstoreaccount1) points it at the Azurite
//! emulator for local testing.

use base64::Engine;
use bytes::Bytes;
use hmac::{Hmac, Mac};
use http_body_util::{BodyExt, Empty, Full, Limited};
use hyper::{header, Request};
use hyper_util::rt::TokioIo;
use sha2::Sha256;
use std::{sync::Arc, sync::OnceLock, time::Duration};

/// Matches the server's request body limit (main.rs).
const MAX_BYTES: usize = 512 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(60);
const API_VERSION: &str = "2021-08-06";

pub struct Store {
    account: String,
    key: Vec<u8>,
    container: String,
    host: String,
    port: u16,
    https: bool,
    /// "" against real Azure; "/{account}" against Azurite, which keeps the account in the path.
    path_prefix: String,
}

/// The store, if ZOMELLO_BLOB_ACCOUNT and ZOMELLO_BLOB_KEY are set (checked once, at first use).
pub fn store() -> Option<&'static Arc<Store>> {
    static STORE: OnceLock<Option<Arc<Store>>> = OnceLock::new();
    STORE
        .get_or_init(|| {
            let account = crate::env("ZOMELLO_BLOB_ACCOUNT")?;
            let key = base64::engine::general_purpose::STANDARD.decode(crate::env("ZOMELLO_BLOB_KEY")?).ok()?;
            let container = crate::env("ZOMELLO_BLOB_CONTAINER").unwrap_or_else(|| "zomello-files".into());
            let (https, host, port, path_prefix) = match crate::env("ZOMELLO_BLOB_ENDPOINT") {
                None => (true, format!("{account}.blob.core.windows.net"), 443, String::new()),
                Some(ep) => {
                    let (https, rest) = match ep.strip_prefix("https://") {
                        Some(r) => (true, r.to_string()),
                        None => (false, ep.strip_prefix("http://")?.to_string()),
                    };
                    let (hostport, path) = rest.split_once('/').unwrap_or((&rest, ""));
                    let (host, port) = match hostport.split_once(':') {
                        Some((h, p)) => (h.to_string(), p.parse().ok()?),
                        None => (hostport.to_string(), if https { 443 } else { 80 }),
                    };
                    (https, host, port, if path.is_empty() { String::new() } else { format!("/{}", path.trim_end_matches('/')) })
                }
            };
            println!("Attachments: Azure Blob Storage, account {account}, container {container}");
            Some(Arc::new(Store { account, key, container, host, port, https, path_prefix }))
        })
        .as_ref()
}

/// "Thu, 01 Jan 1970 00:00:00 GMT" — the x-ms-date header's required form.
fn http_date(t: i64) -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let days = t.div_euclid(86_400);
    let secs = t.rem_euclid(86_400);
    let (y, m, d) = crate::civil_from_days(days);
    // 1970-01-01 (day 0) was a Thursday.
    let wd = DAYS[((days.rem_euclid(7)) as usize + 4) % 7];
    format!("{wd}, {d:02} {} {y} {:02}:{:02}:{:02} GMT", MONTHS[(m - 1) as usize], secs / 3600, secs % 3600 / 60, secs % 60)
}

/// One request over an already-open connection; returns (status, body).
async fn send<S>(io: S, req: Request<http_body_util::combinators::BoxBody<Bytes, std::convert::Infallible>>) -> Result<(u16, Bytes), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(io)).await.map_err(|e| e.to_string())?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let res = sender.send_request(req).await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let bytes = Limited::new(res.into_body(), MAX_BYTES).collect().await.map_err(|_| "The file is too large".to_string())?.to_bytes();
    Ok((status, bytes))
}

impl Store {
    /// The blob's URL path. Blob names here are ASCII (files::safe_name), so no percent-encoding.
    fn path(&self, name: &str) -> String {
        format!("{}/{}/{name}", self.path_prefix, self.container)
    }

    /// SharedKey authorization for one request (the Blob service's signing recipe).
    fn authorization(&self, method: &str, name: &str, date: &str, length: usize, content_type: &str, blob_type: bool) -> String {
        let length = if length > 0 { length.to_string() } else { String::new() };
        let ms_headers = if blob_type {
            format!("x-ms-blob-type:BlockBlob\nx-ms-date:{date}\nx-ms-version:{API_VERSION}\n")
        } else {
            format!("x-ms-date:{date}\nx-ms-version:{API_VERSION}\n")
        };
        // VERB, then Content-Encoding, -Language, -Length, MD5, -Type, Date, If-Modified-Since,
        // If-Match, If-None-Match, If-Unmodified-Since, Range — unused ones stay empty.
        let to_sign = format!(
            "{method}\n\n\n{length}\n\n{content_type}\n\n\n\n\n\n\n{ms_headers}/{}{}",
            self.account,
            self.path(name)
        );
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key).expect("any key length works");
        mac.update(to_sign.as_bytes());
        format!("SharedKey {}:{}", self.account, base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes()))
    }

    async fn request(&self, method: &str, name: &str, content_type: &str, body: Option<Bytes>) -> Result<(u16, Bytes), String> {
        let date = http_date(crate::now());
        let length = body.as_ref().map(Bytes::len).unwrap_or(0);
        let auth = self.authorization(method, name, &date, length, content_type, body.is_some());
        let host = if (self.https && self.port == 443) || (!self.https && self.port == 80) { self.host.clone() } else { format!("{}:{}", self.host, self.port) };
        let mut req = Request::builder()
            .method(method)
            .uri(self.path(name))
            .header(header::HOST, &host)
            .header("x-ms-date", &date)
            .header("x-ms-version", API_VERSION)
            .header(header::AUTHORIZATION, auth);
        if body.is_some() {
            req = req.header("x-ms-blob-type", "BlockBlob").header(header::CONTENT_TYPE, content_type);
        }

        let req = match body {
            Some(b) => req.body(Full::new(b).boxed()).map_err(|e| e.to_string())?,
            None => req.body(Empty::<Bytes>::new().boxed()).map_err(|e| e.to_string())?,
        };
        let io = tokio::net::TcpStream::connect((self.host.as_str(), self.port)).await.map_err(|e| format!("Couldn't reach {}: {e}", self.host))?;
        let run = async {
            if self.https {
                let sni = rustls::pki_types::ServerName::try_from(self.host.clone()).map_err(|e| e.to_string())?;
                let stream = tokio_rustls::TlsConnector::from(crate::calendar::tls()).connect(sni, io).await.map_err(|e| format!("Secure connection failed: {e}"))?;
                send(stream, req).await
            } else {
                send(io, req).await
            }
        };
        tokio::time::timeout(TIMEOUT, run).await.map_err(|_| "Blob storage took too long to answer".to_string())?
    }

    /// Store one file. The name is the same `attachments/...` path the disk would use.
    pub async fn put(&self, name: &str, content_type: &str, body: Bytes) -> Result<(), String> {
        match self.request("PUT", name, content_type, Some(body)).await? {
            (201, _) => Ok(()),
            (s, b) => Err(format!("Blob storage refused the upload ({s}): {}", String::from_utf8_lossy(&b).chars().take(200).collect::<String>())),
        }
    }

    /// Fetch one file; Ok(None) when it isn't there.
    pub async fn get(&self, name: &str) -> Result<Option<Bytes>, String> {
        match self.request("GET", name, "", None).await? {
            (200, b) => Ok(Some(b)),
            (404, _) => Ok(None),
            (s, b) => Err(format!("Blob storage answered with an error ({s}): {}", String::from_utf8_lossy(&b).chars().take(200).collect::<String>())),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn dates_are_rfc1123() {
        assert_eq!(super::http_date(0), "Thu, 01 Jan 1970 00:00:00 GMT");
        assert_eq!(super::http_date(1_763_000_000), "Thu, 13 Nov 2025 02:13:20 GMT");
    }
}
