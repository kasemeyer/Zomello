//! Calendar feeds (same as the desktop app's calendar.rs): download an iCal (.ics) address, such as Google Calendar's "Secret address in iCal
//! format", so a board's Calendar view can show those events. The page can't fetch other sites itself.

use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Limited};
use hyper::{header, Request, Uri};
use hyper_util::rt::TokioIo;
use std::{sync::Arc, time::Duration};
use tokio::io::{AsyncRead, AsyncWrite};

const MAX_BYTES: usize = 15 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(25);

pub fn tls() -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    Arc::new(
        rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .expect("TLS versions")
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

/// One GET over an already-open connection. Returns (status, Location header, body).
async fn get<S>(io: S, host: &str, path: &str) -> Result<(u16, Option<String>, Bytes), String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(io)).await.map_err(|e| e.to_string())?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let req = Request::get(path)
        .header(header::HOST, host)
        .header(header::USER_AGENT, "Zomello (calendar feed)")
        .header(header::ACCEPT, "text/calendar, */*")
        .body(Empty::<Bytes>::new())
        .map_err(|e| e.to_string())?;
    let res = sender.send_request(req).await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let location = res.headers().get(header::LOCATION).and_then(|v| v.to_str().ok()).map(str::to_string);
    let body = Limited::new(res.into_body(), MAX_BYTES)
        .collect()
        .await
        .map_err(|_| "The calendar is too large (over 15 MB)".to_string())?
        .to_bytes();
    Ok((status, location, body))
}

/// Download a calendar address (https, http or webcal), following a few redirects.
pub async fn fetch_text(address: &str) -> Result<String, String> {
    let mut url = address.trim().to_string();
    if let Some(rest) = url.strip_prefix("webcal://") {
        url = format!("https://{rest}");
    }
    for _ in 0..5 {
        let uri: Uri = url.parse().map_err(|_| "That isn't a web address".to_string())?;
        let https = match uri.scheme_str() {
            Some("https") => true,
            Some("http") => false,
            _ => return Err("Calendar addresses start with https://, http:// or webcal://".into()),
        };
        let host = uri.host().ok_or("That address has no host")?.to_string();
        let port = uri.port_u16().unwrap_or(if https { 443 } else { 80 });
        let path = uri.path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| "/".into());
        let host_header = if uri.port_u16().is_some() { format!("{host}:{port}") } else { host.clone() };

        let attempt = async {
            let tcp = tokio::net::TcpStream::connect((host.as_str(), port)).await.map_err(|e| format!("Couldn't reach {host}: {e}"))?;
            if https {
                let name = rustls::pki_types::ServerName::try_from(host.clone()).map_err(|e| e.to_string())?;
                let stream = tokio_rustls::TlsConnector::from(tls()).connect(name, tcp).await.map_err(|e| format!("Secure connection to {host} failed: {e}"))?;
                get(stream, &host_header, &path).await
            } else {
                get(tcp, &host_header, &path).await
            }
        };
        let (status, location, body) = tokio::time::timeout(TIMEOUT, attempt).await.map_err(|_| "The calendar took too long to answer".to_string())??;
        match status {
            200..=299 => return Ok(String::from_utf8_lossy(&body).into_owned()),
            301 | 302 | 303 | 307 | 308 => {
                let loc = location.ok_or("The calendar address redirected nowhere")?;
                url = if loc.starts_with("http") { loc } else { format!("{}://{}{}", if https { "https" } else { "http" }, host_header, loc) };
            }
            404 => return Err("Calendar not found (404). Check the address.".into()),
            401 | 403 => return Err("The calendar refused access. For Google, use the \"Secret address in iCal format\".".into()),
            s => return Err(format!("The calendar answered with an error ({s})")),
        }
    }
    Err("Too many redirects".into())
}
