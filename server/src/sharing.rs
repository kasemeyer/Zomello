//! Sharing boards: the owner invites people by username — as members who work on the board, or as
//! viewers who can only look — they accept (or decline) from their Home page, and anyone but the
//! owner can leave. The owner can switch anyone between member and viewer later.

use crate::{auth, db, err, now, random_hex, App, ApiResult, Event};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

fn board_title(db: &rusqlite::Connection, board: &str) -> String {
    db.query_row("SELECT data FROM boards WHERE id = ?", [board], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|d| serde_json::from_str::<Value>(&d).ok())
        .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(str::to_string))
        .unwrap_or_else(|| "a board".into())
}

/// Tell everyone on a board (and anyone else listed) to reload, after membership changes.
fn reload(app: &App, board: &str, also: &[&str]) {
    let mut users = db::member_ids(&app.db.lock().unwrap(), board).unwrap_or_default();
    users.extend(also.iter().map(|s| s.to_string()));
    app.send(Event { users, kind: "reload", from: String::new(), json: "{}".into() });
}

/// GET /api/boards/{id}/sharing: members and pending invitations.
pub async fn sharing(State(app): State<App>, headers: HeaderMap, Path(board): Path<String>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let db = app.db.lock().unwrap();
    if !db::is_member(&db, &board, &user.id).unwrap_or(false) && !user.is_admin {
        return Err(err(StatusCode::FORBIDDEN, "That board isn't shared with you."));
    }
    let mut st = db
        .prepare("SELECT i.id, u.id, u.display_name, u.username, i.created, i.role FROM invites i JOIN users u ON u.id = i.to_user WHERE i.board_id = ?")
        .unwrap();
    let pending: Vec<Value> = st
        .query_map([&board], |r| {
            Ok(json!({ "id": r.get::<_, String>(0)?, "userId": r.get::<_, String>(1)?, "displayName": r.get::<_, String>(2)?, "username": r.get::<_, String>(3)?, "created": r.get::<_, i64>(4)?, "role": r.get::<_, String>(5)? }))
        })
        .unwrap()
        .flatten()
        .collect();
    Ok(Json(json!({
        "ownerId": db::board_owner(&db, &board).ok().flatten(),
        "members": db::members(&db, &board).unwrap_or_default(),
        "pending": pending,
    }))
    .into_response())
}

#[derive(Deserialize)]
pub struct InviteReq {
    username: String,
    /// "member" (the default) or "viewer".
    #[serde(default)]
    role: Option<String>,
}

/// A member's role as sharing accepts it: viewers look, members edit (owner is set elsewhere).
fn valid_role(role: Option<&str>) -> Result<&'static str, axum::response::Response> {
    match role {
        None | Some("member") => Ok("member"),
        Some("viewer") => Ok("viewer"),
        Some(_) => Err(err(StatusCode::BAD_REQUEST, "The role must be member or viewer.")),
    }
}

/// POST /api/boards/{id}/invite: the owner invites someone by username.
pub async fn invite(State(app): State<App>, headers: HeaderMap, Path(board): Path<String>, Json(req): Json<InviteReq>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let role = valid_role(req.role.as_deref())?;
    let to = {
        let db = app.db.lock().unwrap();
        let owner = db::board_owner(&db, &board).ok().flatten().ok_or_else(|| err(StatusCode::NOT_FOUND, "No such board"))?;
        if owner != user.id && !user.is_admin {
            return Err(err(StatusCode::FORBIDDEN, "Only the board's owner can invite people."));
        }
        let (to, _) = db::user_by_name(&db, req.username.trim()).ok().flatten().ok_or_else(|| err(StatusCode::NOT_FOUND, "There's no one with that username."))?;
        if to.disabled {
            return Err(err(StatusCode::BAD_REQUEST, "That account is turned off."));
        }
        if db::is_member(&db, &board, &to.id).unwrap_or(false) {
            return Err(err(StatusCode::CONFLICT, &format!("{} is already on this board.", to.display_name)));
        }
        db.execute(
            "INSERT OR IGNORE INTO invites (id, board_id, from_user, to_user, role, created) VALUES (?, ?, ?, ?, ?, ?)",
            params![random_hex(10), board, user.id, to.id, role, now()],
        )
        .ok();
        to
    };
    app.send(Event { users: vec![to.id.clone()], kind: "invites", from: String::new(), json: "{}".into() });
    Ok(Json(json!({ "ok": true, "displayName": to.display_name })).into_response())
}

/// GET /api/invites: invitations waiting for you.
pub async fn my_invites(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let mut st = db
        .prepare("SELECT i.id, i.board_id, u.display_name, i.created FROM invites i JOIN users u ON u.id = i.from_user WHERE i.to_user = ? ORDER BY i.created DESC")
        .unwrap();
    let rows: Vec<(String, String, String, i64)> = st.query_map([&user.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().flatten().collect();
    let out: Vec<Value> = rows
        .into_iter()
        .map(|(id, board, from, created)| json!({ "id": id, "boardId": board, "boardTitle": board_title(&db, &board), "from": from, "created": created }))
        .collect();
    Ok(Json(out).into_response())
}

/// POST /api/invites/{id}/accept or /decline.
pub async fn answer_invite(State(app): State<App>, headers: HeaderMap, Path((id, answer)): Path<(String, String)>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let board = {
        let db = app.db.lock().unwrap();
        let (board, to, role): (String, String, String) = db
            .query_row("SELECT board_id, to_user, role FROM invites WHERE id = ?", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()
            .ok()
            .flatten()
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "That invitation is gone (it may have been cancelled)."))?;
        if to != user.id {
            return Err(err(StatusCode::FORBIDDEN, "That invitation isn't yours."));
        }
        db.execute("DELETE FROM invites WHERE id = ?", [&id]).ok();
        if answer == "accept" {
            db.execute("INSERT OR IGNORE INTO members (board_id, user_id, role, added) VALUES (?, ?, ?, ?)", params![board, user.id, role, now()]).ok();
        }
        board
    };
    if answer == "accept" {
        reload(&app, &board, &[]);
    }
    Ok("ok".into_response())
}

/// DELETE /api/invites/{id}: the owner cancels a pending invitation.
pub async fn cancel_invite(State(app): State<App>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let (board, to): (String, String) = db
        .query_row("SELECT board_id, to_user FROM invites WHERE id = ?", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .ok()
        .flatten()
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "That invitation is gone."))?;
    let owner = db::board_owner(&db, &board).ok().flatten();
    if owner.as_deref() != Some(user.id.as_str()) && !user.is_admin {
        return Err(err(StatusCode::FORBIDDEN, "Only the board's owner can cancel invitations."));
    }
    db.execute("DELETE FROM invites WHERE id = ?", [&id]).ok();
    drop(db);
    app.send(Event { users: vec![to], kind: "invites", from: String::new(), json: "{}".into() });
    Ok("ok".into_response())
}

/// DELETE /api/boards/{id}/members/{user}: the owner (or an admin) removes someone.
pub async fn remove_member(State(app): State<App>, headers: HeaderMap, Path((board, member)): Path<(String, String)>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    {
        let db = app.db.lock().unwrap();
        let owner = db::board_owner(&db, &board).ok().flatten().ok_or_else(|| err(StatusCode::NOT_FOUND, "No such board"))?;
        if owner != user.id && !user.is_admin {
            return Err(err(StatusCode::FORBIDDEN, "Only the board's owner can remove people."));
        }
        if member == owner {
            return Err(err(StatusCode::BAD_REQUEST, "The owner can't be removed. Give the board to someone else first."));
        }
        db.execute("DELETE FROM members WHERE board_id = ? AND user_id = ?", params![board, member]).ok();
    }
    reload(&app, &board, &[&member]);
    Ok("ok".into_response())
}

#[derive(Deserialize)]
pub struct RoleReq {
    role: String,
}

/// PATCH /api/boards/{id}/members/{user}: the owner (or an admin) makes someone a member or a viewer.
pub async fn set_role(State(app): State<App>, headers: HeaderMap, Path((board, member)): Path<(String, String)>, Json(req): Json<RoleReq>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let role = valid_role(Some(&req.role))?;
    {
        let db = app.db.lock().unwrap();
        let owner = db::board_owner(&db, &board).ok().flatten().ok_or_else(|| err(StatusCode::NOT_FOUND, "No such board"))?;
        if owner != user.id && !user.is_admin {
            return Err(err(StatusCode::FORBIDDEN, "Only the board's owner can change roles."));
        }
        if member == owner {
            return Err(err(StatusCode::BAD_REQUEST, "The owner always edits. Give the board to someone else first."));
        }
        let n = db.execute("UPDATE members SET role = ? WHERE board_id = ? AND user_id = ?", params![role, board, member]).unwrap_or(0);
        if n == 0 {
            return Err(err(StatusCode::NOT_FOUND, "They're not on this board."));
        }
    }
    reload(&app, &board, &[]);
    Ok("ok".into_response())
}

/// POST /api/boards/{id}/leave: stop being a member of someone else's board.
pub async fn leave(State(app): State<App>, headers: HeaderMap, Path(board): Path<String>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    {
        let db = app.db.lock().unwrap();
        if db::board_owner(&db, &board).ok().flatten().as_deref() == Some(user.id.as_str()) {
            return Err(err(StatusCode::BAD_REQUEST, "You own this board. Give it to someone else first, or delete it."));
        }
        db.execute("DELETE FROM members WHERE board_id = ? AND user_id = ?", params![board, user.id]).ok();
    }
    reload(&app, &board, &[&user.id]);
    Ok("ok".into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferReq {
    user_id: String,
}

/// POST /api/boards/{id}/transfer: the owner (or an admin) gives the board to another member.
pub async fn transfer(State(app): State<App>, headers: HeaderMap, Path(board): Path<String>, Json(req): Json<TransferReq>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    set_owner(&app, &board, &req.user_id, Some(&user))?;
    Ok("ok".into_response())
}

/// Make someone the owner (adding them as a member if needed). `by` = None for admin tools.
pub fn set_owner(app: &App, board: &str, new_owner: &str, by: Option<&db::User>) -> Result<(), axum::response::Response> {
    {
        let db = app.db.lock().unwrap();
        let owner = db::board_owner(&db, board).ok().flatten().ok_or_else(|| err(StatusCode::NOT_FOUND, "No such board"))?;
        if let Some(u) = by {
            if owner != u.id && !u.is_admin {
                return Err(err(StatusCode::FORBIDDEN, "Only the board's owner can give it away."));
            }
        }
        if db::user_by_id(&db, new_owner).ok().flatten().is_none() {
            return Err(err(StatusCode::NOT_FOUND, "No such user"));
        }
        db.execute("UPDATE boards SET owner_id = ? WHERE id = ?", params![new_owner, board]).ok();
        db.execute("UPDATE members SET role = 'member' WHERE board_id = ? AND user_id = ?", params![board, owner]).ok();
        db.execute(
            "INSERT INTO members (board_id, user_id, role, added) VALUES (?1, ?2, 'owner', ?3) ON CONFLICT(board_id, user_id) DO UPDATE SET role = 'owner'",
            params![board, new_owner, now()],
        )
        .ok();
    }
    reload(app, board, &[]);
    Ok(())
}
