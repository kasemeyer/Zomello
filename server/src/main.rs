//! Zomello Server: Zomello for several people on one server (home server, NAS, Raspberry Pi, VPS).
//!
//! People sign in with their own accounts, make their own boards, and share boards with each other.
//! Admins manage accounts and boards from the app's Admin page. Data lives in one folder: a SQLite
//! database plus attached files.
//!
//! Settings come from environment variables (handy in Docker), or from `settings.env` in the data folder:
//!   ZOMELLO_DATA        data folder (default: Windows C:\ProgramData\Zomello Server, macOS ~/Library/Application
//!                       Support/Zomello Server, Linux ~/.local/share/zomello-server)
//!   ZOMELLO_PORT        port (default 7311)
//!   ZOMELLO_BIND        address to listen on (default 0.0.0.0)
//!   ZOMELLO_TLS         off (default; e.g. behind Caddy) | files | self
//!   ZOMELLO_TLS_CERT / ZOMELLO_TLS_KEY   PEM files for `files`
//!   ZOMELLO_HOSTS       extra names / addresses for the `self` certificate (comma-separated)
//!   ZOMELLO_PUBLIC_URL  the address people use, shown in the admin page
//!   ZOMELLO_NAME        the name the app shows for this server (default "Zomello on <computer name>")
//!   ZOMELLO_DISCOVERY   on/off: announce this server on the local network (default on; off in Docker)
//!
//! For hosts whose disk doesn't survive a restart (Azure Container Apps, App Service):
//!   ZOMELLO_DB_REPLICA  stream the database to Azure Blob Storage with Litestream (Docker image
//!                       only): abs://account@container/path, key in LITESTREAM_AZURE_ACCOUNT_KEY
//!   ZOMELLO_BLOB_ACCOUNT, ZOMELLO_BLOB_KEY, ZOMELLO_BLOB_CONTAINER (default "zomello-files"),
//!   ZOMELLO_BLOB_ENDPOINT (only for the Azurite emulator)
//!                       keep attached files in Azure Blob Storage instead of the data folder (blob.rs)
//!
//! Commands (e.g. `docker exec zomello zomello-server reset-password alice`):
//!   zomello-server                          run the server
//!   zomello-server reset-password <user>    set a new password (prompts, or reads ZOMELLO_PASSWORD)
//!   zomello-server create-admin <user>      add an admin account (same password prompt)
//!   zomello-server health                   exit 0 if the server on ZOMELLO_PORT answers (Docker health check)
//!   zomello-server install                  start with the computer (Windows startup task, macOS LaunchAgent,
//!                                           Linux systemd service), and start now
//!   zomello-server uninstall                stop starting with the computer (data stays)

mod admin;
mod auth;
mod blob;
mod calendar;
mod db;
mod discovery;
mod feed;
mod platform;
mod files;
mod sharing;
mod sync;
mod tls;
#[cfg(test)]
mod tests;

use axum::{
    extract::{DefaultBodyLimit, Request},
    http::{header, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
    Json, Router,
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::broadcast;

pub struct Config {
    pub data_dir: PathBuf,
    pub port: u16,
    pub bind: String,
    pub tls: bool,
    /// https with Zomello's own certificate authority (devices install it from /zomello-ca.crt).
    pub self_cert: bool,
    pub public_url: Option<String>,
}

/// Something that happened, for the people listed in `users` (live updates).
#[derive(Clone)]
pub struct Event {
    pub users: Vec<String>,
    /// "ops" | "user" | "reload" | "invites" | "signout"
    pub kind: &'static str,
    /// The browser tab that caused it (it already has the change).
    pub from: String,
    pub json: String,
}

pub struct AppInner {
    pub db: Mutex<rusqlite::Connection>,
    pub config: Config,
    pub tx: broadcast::Sender<Event>,
    /// Wrong-password counts per username, for the sign-in limit.
    pub fails: Mutex<HashMap<String, (u32, Instant)>>,
}
pub type App = Arc<AppInner>;

impl AppInner {
    pub fn send(&self, e: Event) {
        let _ = self.tx.send(e);
    }
}

pub type ApiResult = Result<Response, Response>;

pub fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(serde_json::json!({ "error": msg }))).into_response()
}

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    getrandom::fill(&mut b).expect("system random source");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|x| format!("{x:02x}")).collect()
}

/// Days since 1970-01-01 → (year, month, day).
pub fn civil_from_days(z: i64) -> (i32, u8, u8) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    ((yoe + era * 400 + i64::from(m <= 2)) as i32, m, d)
}

/// "2026-10-14" (UTC).
pub fn today() -> String {
    let (y, m, d) = civil_from_days(now() / 86_400);
    format!("{y}-{m:02}-{d:02}")
}

/// "20261014-153012" (UTC), for file names.
pub fn stamp() -> String {
    let t = now();
    let (y, m, d) = civil_from_days(t / 86_400);
    let s = t % 86_400;
    format!("{y}{m:02}{d:02}-{:02}{:02}{:02}", s / 3600, s % 3600 / 60, s % 60)
}

/// Settings from `settings.env` in the data folder (environment variables win).
static FILE_SETTINGS: std::sync::OnceLock<Vec<(String, String)>> = std::sync::OnceLock::new();

pub fn env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .or_else(|| FILE_SETTINGS.get()?.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// State-changing requests must come from this site's own pages (a simple guard against other
/// sites submitting forms or scripts on a signed-in person's behalf).
async fn same_origin(req: Request, next: Next) -> Response {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        if let Some(origin) = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
            let origin_host = origin.split("://").nth(1).unwrap_or(origin);
            let fwd = req.headers().get("x-forwarded-host").and_then(|v| v.to_str().ok());
            if origin_host != host && Some(origin_host) != fwd {
                return err(StatusCode::FORBIDDEN, "Requests from other sites aren't allowed.");
            }
        }
    }
    next.run(req).await
}

fn router(app: App) -> Router {
    Router::new()
        .route("/api/session", get(auth::session))
        .route("/api/setup", post(auth::setup))
        .route("/api/login", post(auth::login))
        .route("/api/logout", post(auth::logout))
        .route("/api/me/password", post(auth::change_password))
        .route("/api/me/profile", post(auth::update_profile))
        .route("/api/me/calendar-link", get(feed::status).post(feed::create).delete(feed::remove))
        .route("/calendar/{file}", get(feed::calendar))
        .route("/api/data", get(sync::data))
        .route("/api/sync", post(sync::sync))
        .route("/api/events", get(sync::events))
        .route("/api/users", get(sync::directory))
        .route("/api/boards/{id}/sharing", get(sharing::sharing))
        .route("/api/boards/{id}/invite", post(sharing::invite))
        .route("/api/boards/{id}/members/{user}", patch(sharing::set_role).delete(sharing::remove_member))
        .route("/api/boards/{id}/leave", post(sharing::leave))
        .route("/api/boards/{id}/transfer", post(sharing::transfer))
        .route("/api/invites", get(sharing::my_invites))
        .route("/api/invites/{id}", delete(sharing::cancel_invite))
        .route("/api/invites/{id}/{answer}", post(sharing::answer_invite))
        .route("/api/admin/users", get(admin::users).post(admin::create_user))
        .route("/api/admin/users/{id}", patch(admin::update_user).delete(admin::delete_user))
        .route("/api/admin/users/{id}/sessions", get(admin::sessions))
        .route("/api/admin/boards", get(admin::boards))
        .route("/api/admin/boards/{id}", patch(admin::set_board_owner).delete(admin::delete_board))
        .route("/api/admin/boards/{id}/members", post(admin::add_member))
        .route("/api/admin/info", get(admin::info))
        .route("/api/admin/backup", get(admin::backup))
        .route("/api/attachment", post(files::upload))
        .route("/api/file/{*rel}", get(files::file))
        .route("/api/calendar/{board}/{feed}", get(files::calendar))
        .route("/zomello-ca.crt", get(tls::ca_cert))
        .fallback(get(files::web))
        .layer(middleware::from_fn(same_origin))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .with_state(app)
}

/// Keep a daily copy of the database (last 14 kept) in the data folder's `backups`.
async fn daily_backups(app: App) {
    loop {
        let name = format!("zomello-{}.db", today());
        if !app.config.data_dir.join("backups").join(&name).exists() {
            match admin::snapshot(&app, &name) {
                Ok(_) => {
                    let mut daily: Vec<String> = admin::list_backups(&app)
                        .into_iter()
                        .filter_map(|b| b["name"].as_str().map(str::to_string))
                        .filter(|n| n.starts_with("zomello-2"))
                        .collect();
                    daily.sort();
                    while daily.len() > 14 {
                        let old = daily.remove(0);
                        let _ = std::fs::remove_file(app.config.data_dir.join("backups").join(old));
                    }
                }
                Err(e) => eprintln!("backup failed: {e}"),
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
    }
}

fn read_password() -> String {
    if let Some(p) = env("ZOMELLO_PASSWORD") {
        return p;
    }
    eprint!("New password (at least 8 characters): ");
    let mut s = String::new();
    std::io::stdin().read_line(&mut s).ok();
    s.trim_end_matches(['\r', '\n']).to_string()
}

fn command(conn: &rusqlite::Connection, args: &[String]) -> bool {
    match args.first().map(String::as_str) {
        Some("reset-password") => {
            let Some(user) = args.get(1) else {
                eprintln!("usage: zomello-server reset-password <username>");
                std::process::exit(2)
            };
            let pw = read_password();
            if pw.chars().count() < 8 {
                eprintln!("Use at least 8 characters.");
                std::process::exit(2);
            }
            let n = conn
                .execute("UPDATE users SET pass_hash = ?, disabled = 0 WHERE username = ?", rusqlite::params![auth::hash_password(&pw), user.to_lowercase()])
                .unwrap_or(0);
            conn.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)", [user.to_lowercase()]).ok();
            if n == 0 {
                eprintln!("No user named {user}.");
                std::process::exit(1);
            }
            println!("Password changed for {user}.");
            true
        }
        Some("create-admin") => {
            let Some(user) = args.get(1) else {
                eprintln!("usage: zomello-server create-admin <username>");
                std::process::exit(2)
            };
            let pw = read_password();
            if pw.chars().count() < 8 {
                eprintln!("Use at least 8 characters.");
                std::process::exit(2);
            }
            let r = conn.execute(
                "INSERT INTO users (id, username, display_name, pass_hash, is_admin, created) VALUES (?, ?, ?, ?, 1, ?)",
                rusqlite::params![random_hex(12), user.to_lowercase(), user, auth::hash_password(&pw), now()],
            );
            match r {
                Ok(_) => println!("Admin {user} created."),
                Err(e) => {
                    eprintln!("Couldn't create {user}: {e}");
                    std::process::exit(1);
                }
            }
            true
        }
        Some(other) => {
            eprintln!("Unknown command: {other}. Commands: install, uninstall, reset-password <user>, create-admin <user>, health.");
            std::process::exit(2);
        }
        None => false,
    }
}

/// `zomello-server health`: ask the running server for its session page over plain http (the port
/// answers http even when https is on), so the container needs no curl or shell.
fn health() -> ! {
    use std::io::{Read, Write};
    let port = env("ZOMELLO_PORT").and_then(|p| p.parse::<u16>().ok()).unwrap_or(7311);
    let ok = (|| {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).ok()?;
        s.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok()?;
        s.write_all(b"GET /api/session HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").ok()?;
        let mut head = [0u8; 12];
        s.read_exact(&mut head).ok()?;
        Some(head.ends_with(b"200"))
    })()
    .unwrap_or(false);
    std::process::exit(if ok { 0 } else { 1 })
}

#[tokio::main]
async fn main() {
    if std::env::args().nth(1).as_deref() == Some("health") {
        health();
    }
    let data_dir = env("ZOMELLO_DATA").map(PathBuf::from).unwrap_or_else(platform::default_data_dir);
    std::fs::create_dir_all(&data_dir).unwrap_or_else(|e| panic!("can't create the data folder {}: {e}", data_dir.display()));
    let _ = FILE_SETTINGS.set(platform::read_settings(&data_dir));
    let port: u16 = env("ZOMELLO_PORT").and_then(|p| p.parse().ok()).unwrap_or(7311);

    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("install") => std::process::exit(if platform::install(&data_dir, port) { 0 } else { 1 }),
        Some("uninstall") => std::process::exit(if platform::uninstall() { 0 } else { 1 }),
        _ => {}
    }
    let conn = db::open(&data_dir.join("zomello.db")).expect("can't open the database");
    if command(&conn, &args) {
        return;
    }

    let tls_mode = env("ZOMELLO_TLS").unwrap_or_else(|| "off".into()).to_lowercase();
    let config = Config {
        port,
        bind: env("ZOMELLO_BIND").unwrap_or_else(|| "0.0.0.0".into()),
        tls: tls_mode != "off",
        self_cert: tls_mode == "self",
        public_url: env("ZOMELLO_PUBLIC_URL"),
        data_dir: data_dir.clone(),
    };
    let app: App = Arc::new(AppInner { db: Mutex::new(conn), config, tx: broadcast::channel(256).0, fails: Mutex::new(HashMap::new()) });

    let tls_config = match tls_mode.as_str() {
        "off" => None,
        "files" => Some(tls::from_files(&env("ZOMELLO_TLS_CERT").expect("ZOMELLO_TLS_CERT"), &env("ZOMELLO_TLS_KEY").expect("ZOMELLO_TLS_KEY"))),
        "self" => Some(tls::self_signed(&data_dir, env("ZOMELLO_HOSTS").as_deref())),
        other => panic!("ZOMELLO_TLS must be off, files or self (got {other})"),
    };

    tokio::spawn(daily_backups(app.clone()));
    let addr = format!("{}:{}", app.config.bind, app.config.port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Can't use port {} ({e}).", app.config.port);
            if e.kind() == std::io::ErrorKind::AddrInUse {
                eprintln!("Something else is using it: another Zomello Server, or the Zomello app's phone & tablet access.");
                eprintln!("Pick another port with ZOMELLO_PORT in {}", data_dir.join(platform::SETTINGS_FILE).display());
            }
            platform::pause_before_closing();
            std::process::exit(1);
        }
    };
    let users = db::user_count(&app.db.lock().unwrap()).unwrap_or(0);
    println!(
        "TCI Boards server {} on {}://{addr}  (data: {})",
        env!("CARGO_PKG_VERSION"),
        if tls_config.is_some() { "https" } else { "http" },
        data_dir.display()
    );
    println!("Settings: {}", data_dir.join(platform::SETTINGS_FILE).display());
    if users == 0 {
        println!("First run: open it in a browser to create the admin account.");
        platform::maybe_open_browser(&format!("{}://localhost:{}", if tls_config.is_some() { "https" } else { "http" }, app.config.port));
    }
    // Let the Zomello app find this server on the home network (kept alive while the server runs).
    let _announce = discovery::announce(env("ZOMELLO_NAME"), app.config.port, tls_config.is_some(), env("ZOMELLO_DISCOVERY"));
    let router = router(app);
    match tls_config {
        None => axum::serve(listener, router).await.expect("server"),
        Some(cfg) => tls::serve(listener, router, cfg).await,
    }
}
