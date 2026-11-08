//! Accounts and sign-in: Argon2 password hashes, session cookies (stored hashed), first-run setup,
//! and a limit on repeated wrong passwords.

use crate::{db, err, now, random_hex, sha256_hex, App, ApiResult};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::params;
use serde::Deserialize;
use std::time::{Duration, Instant};

pub const COOKIE: &str = "zomello_session";
const SESSION_DAYS: i64 = 60;
const MAX_FAILS: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(60);

pub fn hash_password(pw: &str) -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("system random source");
    let salt = SaltString::encode_b64(&b).expect("salt");
    Argon2::default().hash_password(pw.as_bytes(), &salt).expect("argon2").to_string()
}

pub fn verify_password(pw: &str, hash: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
}

/// A password good enough for a home server: at least 8 characters.
pub fn check_password_rules(pw: &str) -> Result<(), Response> {
    if pw.chars().count() < 8 {
        return Err(err(StatusCode::BAD_REQUEST, "Use a password of at least 8 characters."));
    }
    Ok(())
}

pub fn check_username(u: &str) -> Result<String, Response> {
    let u = u.trim().to_lowercase();
    if u.len() < 2 || u.len() > 32 || !u.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        return Err(err(StatusCode::BAD_REQUEST, "Usernames are 2 to 32 letters, numbers, dots, dashes or underscores."));
    }
    Ok(u)
}

fn token_from(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|kv| kv.trim().strip_prefix(&format!("{COOKIE}=")).map(str::to_string))
}

/// The signed-in user for a request, if any (refreshing the session's "last seen").
pub fn current_user(app: &App, headers: &HeaderMap) -> Option<db::User> {
    let token = token_from(headers)?;
    let h = sha256_hex(&token);
    let db = app.db.lock().unwrap();
    let (user_id, last_seen): (String, i64) = db
        .query_row("SELECT user_id, last_seen FROM sessions WHERE token_hash = ?", [&h], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok()?;
    let t = now();
    if t - last_seen > SESSION_DAYS * 86_400 {
        let _ = db.execute("DELETE FROM sessions WHERE token_hash = ?", [&h]);
        return None;
    }
    if t - last_seen > 300 {
        let _ = db.execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", params![t, h]);
    }
    let user = db::user_by_id(&db, &user_id).ok()??;
    (!user.disabled).then_some(user)
}

/// For handlers: the signed-in user, or a 401.
pub fn require(app: &App, headers: &HeaderMap) -> Result<db::User, Response> {
    current_user(app, headers).ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Please sign in."))
}

pub fn require_admin(app: &App, headers: &HeaderMap) -> Result<db::User, Response> {
    let u = require(app, headers)?;
    if !u.is_admin {
        return Err(err(StatusCode::FORBIDDEN, "Only admins can do that."));
    }
    Ok(u)
}

fn new_session(app: &App, user_id: &str, headers: &HeaderMap) -> String {
    let token = random_hex(32);
    let agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").chars().take(200).collect::<String>();
    let db = app.db.lock().unwrap();
    let _ = db.execute(
        "INSERT INTO sessions (token_hash, user_id, created, last_seen, agent) VALUES (?, ?, ?, ?, ?)",
        params![sha256_hex(&token), user_id, now(), now(), agent],
    );
    let _ = db.execute("UPDATE users SET last_login = ? WHERE id = ?", params![now(), user_id]);
    token
}

fn cookie(app: &App, headers: &HeaderMap, token: &str, max_age: i64) -> String {
    let https = app.config.tls || headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()) == Some("https");
    format!(
        "{COOKIE}={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{}",
        if https { "; Secure" } else { "" }
    )
}

// ---- Routes ----

pub async fn session(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    let setup_needed = db::user_count(&app.db.lock().unwrap()).unwrap_or(0) == 0;
    let user = current_user(&app, &headers);
    Ok(Json(serde_json::json!({ "user": user, "setupNeeded": setup_needed, "selfCert": app.config.self_cert, "version": env!("CARGO_PKG_VERSION") })).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReq {
    username: String,
    display_name: String,
    password: String,
}

/// First run only: create the first account, an admin, and sign it in.
pub async fn setup(State(app): State<App>, headers: HeaderMap, Json(req): Json<SetupReq>) -> ApiResult {
    if db::user_count(&app.db.lock().unwrap()).unwrap_or(1) > 0 {
        return Err(err(StatusCode::CONFLICT, "TCI Boards is already set up. Sign in instead."));
    }
    let username = check_username(&req.username)?;
    check_password_rules(&req.password)?;
    let name = req.display_name.trim();
    let id = {
        let db = app.db.lock().unwrap();
        if db::user_count(&db).unwrap_or(1) > 0 {
            return Err(err(StatusCode::CONFLICT, "TCI Boards is already set up. Sign in instead."));
        }
        let id = random_hex(12);
        db.execute(
            "INSERT INTO users (id, username, display_name, pass_hash, is_admin, created) VALUES (?, ?, ?, ?, 1, ?)",
            params![id, username, if name.is_empty() { &username } else { name }, hash_password(&req.password), now()],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        id
    };
    let token = new_session(&app, &id, &headers);
    Ok(([(header::SET_COOKIE, cookie(&app, &headers, &token, SESSION_DAYS * 86_400))], "ok").into_response())
}

#[derive(Deserialize)]
pub struct LoginReq {
    username: String,
    password: String,
}

pub async fn login(State(app): State<App>, headers: HeaderMap, Json(req): Json<LoginReq>) -> ApiResult {
    let key = req.username.trim().to_lowercase();
    {
        let mut fails = app.fails.lock().unwrap();
        if let Some((n, since)) = fails.get(&key) {
            if *n >= MAX_FAILS && since.elapsed() < LOCKOUT {
                return Err(err(StatusCode::TOO_MANY_REQUESTS, "Too many wrong passwords. Wait a minute and try again."));
            }
        }
        fails.retain(|_, (_, t)| t.elapsed() < LOCKOUT * 10);
    }
    let found = db::user_by_name(&app.db.lock().unwrap(), &key).ok().flatten();
    // Hash anyway when the user doesn't exist, so timing doesn't reveal usernames.
    let ok = match &found {
        Some((u, hash)) => verify_password(&req.password, hash) && !u.disabled,
        None => {
            static DUMMY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
            let _ = verify_password(&req.password, DUMMY.get_or_init(|| hash_password("not-a-real-password")));
            false
        }
    };
    if !ok {
        let mut fails = app.fails.lock().unwrap();
        let e = fails.entry(key).or_insert((0, Instant::now()));
        e.0 += 1;
        e.1 = Instant::now();
        return Err(err(StatusCode::UNAUTHORIZED, "That username and password don't match."));
    }
    app.fails.lock().unwrap().remove(&key);
    let (user, _) = found.unwrap();
    let token = new_session(&app, &user.id, &headers);
    Ok(([(header::SET_COOKIE, cookie(&app, &headers, &token, SESSION_DAYS * 86_400))], "ok").into_response())
}

pub async fn logout(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    if let Some(token) = token_from(&headers) {
        let _ = app.db.lock().unwrap().execute("DELETE FROM sessions WHERE token_hash = ?", [sha256_hex(&token)]);
    }
    Ok(([(header::SET_COOKIE, cookie(&app, &headers, "", 0))], "ok").into_response())
}

#[derive(Deserialize)]
pub struct PasswordReq {
    current: String,
    next: String,
}

/// Change your own password. Signs out your other sessions.
pub async fn change_password(State(app): State<App>, headers: HeaderMap, Json(req): Json<PasswordReq>) -> ApiResult {
    let user = require(&app, &headers)?;
    check_password_rules(&req.next)?;
    let db = app.db.lock().unwrap();
    let hash: String = db.query_row("SELECT pass_hash FROM users WHERE id = ?", [&user.id], |r| r.get(0)).map_err(|_| err(StatusCode::NOT_FOUND, "No such user"))?;
    if !verify_password(&req.current, &hash) {
        return Err(err(StatusCode::FORBIDDEN, "Your current password isn't right."));
    }
    db.execute("UPDATE users SET pass_hash = ? WHERE id = ?", params![hash_password(&req.next), user.id]).ok();
    if let Some(token) = token_from(&headers) {
        db.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", params![user.id, sha256_hex(&token)]).ok();
    }
    Ok("ok".into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileReq {
    display_name: String,
}

/// Change your display name (what others see, and what tasks are assigned to).
pub async fn update_profile(State(app): State<App>, headers: HeaderMap, Json(req): Json<ProfileReq>) -> ApiResult {
    let user = require(&app, &headers)?;
    let name = req.display_name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(err(StatusCode::BAD_REQUEST, "Use a name of 1 to 60 characters."));
    }
    crate::sync::rename_person(&app, &user.id, &user.display_name, name)?;
    Ok("ok".into_response())
}
