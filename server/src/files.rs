//! Attached files, calendar feeds, and the web app itself.

use crate::{auth, err, now, random_hex, App, ApiResult};
use axum::{
    body::Bytes,
    extract::{Path as UrlPath, State},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::path::{Component, Path, PathBuf};

const ATTACH_DIR: &str = "attachments";

/// ASCII letters, digits, "-", "_" and "." only, so the stored path needs no escaping anywhere it
/// goes — the filesystem, a URL, or a blob name (blob.rs signs the path as-is). The file's real
/// name stays on the card; this only names the copy in storage.
fn safe_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
    let s = s.trim_matches('_').trim_start_matches('.').to_string();
    if s.is_empty() { "file".into() } else { s.chars().take(120).collect() }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `attachments/<id>/<name>` inside the data folder, refusing anything that tries to escape it.
fn attachment_path(app: &App, rel: &str) -> Option<PathBuf> {
    let p = Path::new(rel);
    if !p.starts_with(ATTACH_DIR) || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(app.config.data_dir.join(p))
}

/// POST /api/attachment: store an uploaded file (raw body, name in `x-name`). Returns its path.
pub async fn upload(State(app): State<App>, headers: HeaderMap, body: Bytes) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let name = headers.get("x-name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_else(|| "file".into());
    let rel = format!("{ATTACH_DIR}/{}{}/{}", now(), random_hex(4), safe_name(&name));
    if let Some(store) = crate::blob::store() {
        let mime = mime_guess::from_path(&rel).first_or_octet_stream().to_string();
        store.put(&rel, &mime, body).await.map_err(|e| err(StatusCode::BAD_GATEWAY, &e))?;
    } else {
        let abs = app.config.data_dir.join(&rel);
        tokio::fs::create_dir_all(abs.parent().unwrap()).await.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        tokio::fs::write(&abs, &body).await.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    }
    app.db.lock().unwrap().execute("INSERT OR REPLACE INTO attachments (rel, uploader, created) VALUES (?, ?, ?)", params![rel, user.id, now()]).ok();
    Ok(rel.into_response())
}

/// GET /api/file/{*rel}: a stored file, for people who uploaded it or can see a board that uses it.
pub async fn file(State(app): State<App>, headers: HeaderMap, UrlPath(rel): UrlPath<String>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let path = attachment_path(&app, &rel).ok_or_else(|| err(StatusCode::FORBIDDEN, "Not allowed"))?;
    let allowed = {
        let db = app.db.lock().unwrap();
        let mine = db.query_row("SELECT 1 FROM attachments WHERE rel = ? AND uploader = ?", params![rel, user.id], |_| Ok(())).optional().ok().flatten().is_some();
        mine || ["cards", "boards"].iter().any(|t| {
            db.query_row(
                &format!("SELECT 1 FROM {t} x JOIN members m ON m.board_id = {} WHERE m.user_id = ? AND instr(x.data, ?) > 0 LIMIT 1", if *t == "boards" { "x.id" } else { "x.board_id" }),
                params![user.id, rel],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
        })
    };
    if !allowed {
        return Err(err(StatusCode::FORBIDDEN, "Not allowed"));
    }
    // The data folder first (files from before Blob storage was turned on), then Blob.
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => match crate::blob::store() {
            Some(store) => store
                .get(&rel)
                .await
                .map_err(|e| err(StatusCode::BAD_GATEWAY, &e))?
                .ok_or_else(|| err(StatusCode::NOT_FOUND, "Not found"))?
                .to_vec(),
            None => return Err(err(StatusCode::NOT_FOUND, "Not found")),
        },
    };
    let mime = mime_guess::from_path(&path).first_or_octet_stream().to_string();
    Ok(([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "private, max-age=86400".into())], bytes).into_response())
}

/// GET /api/calendar/{board}/{feed}: a board's calendar feed, fetched by the server. Only addresses
/// saved on a board you can see are fetched, so this can't be used to make the server fetch anything else.
pub async fn calendar(State(app): State<App>, headers: HeaderMap, UrlPath((board, feed)): UrlPath<(String, String)>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let url = {
        let db = app.db.lock().unwrap();
        if !crate::db::is_member(&db, &board, &user.id).unwrap_or(false) {
            return Err(err(StatusCode::FORBIDDEN, "That board isn't shared with you."));
        }
        db.query_row("SELECT data FROM boards WHERE id = ?", [&board], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|d| serde_json::from_str::<Value>(&d).ok())
            .and_then(|d| d["calendarFeeds"].as_array()?.iter().find(|f| f["id"] == feed.as_str())?.get("url")?.as_str().map(str::to_string))
    };
    let url = url.ok_or_else(|| err(StatusCode::NOT_FOUND, "No such calendar on that board"))?;
    match crate::calendar::fetch_text(&url).await {
        Ok(ics) => Ok(([(header::CONTENT_TYPE, "text/calendar; charset=utf-8")], ics).into_response()),
        Err(e) => Err(err(StatusCode::BAD_GATEWAY, &e)),
    }
}

/// The web app, built in. index.html is marked so the page knows it's talking to a Zomello Server.
#[derive(rust_embed::Embed)]
#[folder = "../dist"]
struct Web;

pub async fn web(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if !path.is_empty() && !path.starts_with("api/") {
        if let Some(f) = Web::get(path) {
            let mime = mime_guess::from_path(path).first_or_octet_stream().to_string();
            let mime = if path.ends_with(".webmanifest") { "application/manifest+json".to_string() } else { mime };
            // Built files have hashed names and never change; the rest should be checked for updates.
            let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
            return ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, cache.to_string())], f.data.into_owned()).into_response();
        }
    }
    if path.starts_with("api/") {
        return err(StatusCode::NOT_FOUND, "No such API");
    }
    match Web::get("index.html") {
        Some(f) => {
            let html = String::from_utf8_lossy(&f.data).replacen("<head>", "<head><script>window.__ZOMELLO_SERVER__=1</script>", 1);
            ([(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-cache")], html).into_response()
        }
        None => (StatusCode::NOT_FOUND, "The web app wasn't built into this server. Run `npm run build` before building the server.").into_response(),
    }
}
