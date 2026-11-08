//! The app's data, per person: the boards they can see (owned or shared), their buckets and cards,
//! and their own settings. Changes arrive as small "ops" (upsert/delete of a board, bucket or card)
//! and go out live to everyone who can see the board.

use crate::{auth, db, err, now, App, ApiResult, Event};
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{sse, IntoResponse, Response},
    Json,
};
use futures_util::stream::{self, Stream};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{collections::BTreeSet, convert::Infallible};

/// Fields the server owns on a board; whatever the app sends for them is ignored.
const SERVER_FIELDS: [&str; 2] = ["ownerId", "members"];

fn strip_server_fields(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        for f in SERVER_FIELDS {
            o.remove(f);
        }
    }
    v
}

/// A board as the app gets it: its JSON plus owner and members.
fn decorate_board(db: &Connection, id: &str, data: &str, owner: &str) -> Value {
    let mut v: Value = serde_json::from_str(data).unwrap_or_else(|_| json!({ "id": id }));
    if let Some(o) = v.as_object_mut() {
        o.insert("ownerId".into(), json!(owner));
        o.insert("members".into(), json!(db::members(db, id).unwrap_or_default()));
    }
    v
}

fn my_board_ids(db: &Connection, user: &str) -> Vec<String> {
    let mut st = db.prepare("SELECT board_id FROM members WHERE user_id = ?").unwrap();
    st.query_map([user], |r| r.get(0)).unwrap().flatten().collect()
}

fn user_doc(db: &Connection, user: &str) -> Value {
    db.query_row("SELECT data FROM user_docs WHERE user_id = ?", [user], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

/// Everyone's display names, for assigning tasks.
fn directory_names(db: &Connection) -> Vec<String> {
    db::all_users(db).unwrap_or_default().into_iter().filter(|u| !u.disabled).map(|u| u.display_name).collect()
}

/// GET /api/data: everything this person can see, shaped like the app's own data file.
pub async fn data(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let db = app.db.lock().unwrap();
    let mut boards = Map::new();
    let mut lists = Map::new();
    let mut cards = Map::new();
    for id in my_board_ids(&db, &user.id) {
        let Some((data, owner)) = db
            .query_row("SELECT data, owner_id FROM boards WHERE id = ?", [&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .optional()
            .ok()
            .flatten()
        else {
            continue;
        };
        boards.insert(id.clone(), decorate_board(&db, &id, &data, &owner));
        for (table, out) in [("lists", &mut lists), ("cards", &mut cards)] {
            let mut st = db.prepare(&format!("SELECT id, data FROM {table} WHERE board_id = ?")).unwrap();
            for row in st.query_map([&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).unwrap().flatten() {
                if let Ok(v) = serde_json::from_str::<Value>(&row.1) {
                    out.insert(row.0, v);
                }
            }
        }
    }
    let doc = user_doc(&db, &user.id);
    let mut settings = doc.get("settings").cloned().unwrap_or_else(|| json!({}));
    // You are your account; the people list is everyone on this server plus any extra names you added.
    let mut people: BTreeSet<String> = directory_names(&db).into_iter().collect();
    if let Some(extra) = settings.get("people").and_then(|p| p.as_array()) {
        people.extend(extra.iter().filter_map(|x| x.as_str().map(str::to_string)));
    }
    if let Some(o) = settings.as_object_mut() {
        o.insert("me".into(), json!(user.display_name));
        o.insert("people".into(), json!(people.into_iter().collect::<Vec<_>>()));
        // Desktop-only features don't apply on a server.
        o.insert("runInBackground".into(), json!(false));
    }
    let out = json!({
        "version": 1,
        "boards": boards,
        "lists": lists,
        "cards": cards,
        "settings": settings,
        "ui": doc.get("ui").cloned().unwrap_or_else(|| json!({})),
        "templates": doc.get("templates").cloned().unwrap_or_else(|| json!([])),
        "boardTemplates": doc.get("boardTemplates").cloned().unwrap_or_else(|| json!([])),
        "savedFilters": doc.get("savedFilters").cloned().unwrap_or_else(|| json!([])),
    });
    Ok(Json(out).into_response())
}

#[derive(Deserialize, Default)]
pub struct Kinds {
    #[serde(default)]
    boards: Vec<Value>,
    #[serde(default)]
    lists: Vec<Value>,
    #[serde(default)]
    cards: Vec<Value>,
}

#[derive(Deserialize, Default)]
pub struct IdKinds {
    #[serde(default)]
    boards: Vec<String>,
    #[serde(default)]
    lists: Vec<String>,
    #[serde(default)]
    cards: Vec<String>,
}

#[derive(Deserialize)]
pub struct SyncReq {
    #[serde(default)]
    client: String,
    #[serde(default)]
    upserts: Kinds,
    #[serde(default)]
    deletes: IdKinds,
    /// Your own settings, view state, templates and saved filters.
    user: Option<Value>,
}

fn id_of(v: &Value) -> Option<String> {
    v.get("id").and_then(|x| x.as_str()).filter(|s| !s.is_empty() && s.len() <= 100).map(str::to_string)
}

fn board_of(v: &Value) -> Option<String> {
    v.get("boardId").and_then(|x| x.as_str()).map(str::to_string)
}

/// POST /api/sync: apply a batch of changes. Changes this person isn't allowed to make are skipped
/// and listed in `rejected` (the app then reloads to get back in step).
pub async fn sync(State(app): State<App>, headers: HeaderMap, Json(req): Json<SyncReq>) -> ApiResult {
    let user = auth::require(&app, &headers)?;
    let t = now();
    let mut rejected: Vec<Value> = vec![];
    let mut touched: BTreeSet<String> = BTreeSet::new(); // boards whose people should hear about this
    let mut audience_extra: BTreeSet<String> = BTreeSet::new(); // members of boards deleted in this batch
    let mut out_up = json!({ "boards": [], "lists": [], "cards": [] });
    let mut out_del = json!({ "boards": [], "lists": [], "cards": [] });
    let mut reject = |kind: &str, id: &str, why: &str| rejected.push(json!({ "kind": kind, "id": id, "reason": why }));
    {
        let mut db = app.db.lock().unwrap();
        let tx = db.transaction().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

        for b in req.upserts.boards {
            let Some(id) = id_of(&b) else { continue };
            match db::board_owner(&tx, &id).ok().flatten() {
                None => {
                    // A new board: yours.
                    tx.execute("INSERT INTO boards (id, owner_id, data, updated) VALUES (?, ?, ?, ?)", params![id, user.id, strip_server_fields(b).to_string(), t]).ok();
                    tx.execute("INSERT OR IGNORE INTO members (board_id, user_id, role, added) VALUES (?, ?, 'owner', ?)", params![id, user.id, t]).ok();
                }
                Some(_) if db::can_edit(&tx, &id, &user.id).unwrap_or(false) => {
                    tx.execute("UPDATE boards SET data = ?, updated = ? WHERE id = ?", params![strip_server_fields(b).to_string(), t, id]).ok();
                }
                Some(_) if db::is_member(&tx, &id, &user.id).unwrap_or(false) => {
                    reject("board", &id, "the board is view-only for you");
                    continue;
                }
                Some(_) => {
                    reject("board", &id, "not shared with you");
                    continue;
                }
            }
            touched.insert(id.clone());
            out_up["boards"].as_array_mut().unwrap().push(json!(id));
        }

        for (kind, table, items) in [("list", "lists", req.upserts.lists), ("card", "cards", req.upserts.cards)] {
            for v in items {
                let (Some(id), Some(board)) = (id_of(&v), board_of(&v)) else { continue };
                if !db::is_member(&tx, &board, &user.id).unwrap_or(false) {
                    reject(kind, &id, "board not shared with you");
                    continue;
                }
                if !db::can_edit(&tx, &board, &user.id).unwrap_or(false) {
                    reject(kind, &id, "the board is view-only for you");
                    continue;
                }
                // Moving between boards needs edit access to both.
                let old: Option<String> = tx.query_row(&format!("SELECT board_id FROM {table} WHERE id = ?"), [&id], |r| r.get(0)).optional().ok().flatten();
                if let Some(old) = &old {
                    if old != &board && !db::can_edit(&tx, old, &user.id).unwrap_or(false) {
                        reject(kind, &id, "it's on a board you can't edit");
                        continue;
                    }
                    touched.insert(old.clone());
                }
                tx.execute(
                    &format!("INSERT INTO {table} (id, board_id, data, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET board_id = ?2, data = ?3, updated = ?4"),
                    params![id, board, v.to_string(), t],
                )
                .ok();
                touched.insert(board);
                out_up[table].as_array_mut().unwrap().push(v);
            }
        }

        for (kind, table, ids) in [("list", "lists", req.deletes.lists), ("card", "cards", req.deletes.cards)] {
            for id in ids {
                let Some(board): Option<String> = tx.query_row(&format!("SELECT board_id FROM {table} WHERE id = ?"), [&id], |r| r.get(0)).optional().ok().flatten() else {
                    continue;
                };
                if !db::is_member(&tx, &board, &user.id).unwrap_or(false) {
                    reject(kind, &id, "board not shared with you");
                    continue;
                }
                if !db::can_edit(&tx, &board, &user.id).unwrap_or(false) {
                    reject(kind, &id, "the board is view-only for you");
                    continue;
                }
                tx.execute(&format!("DELETE FROM {table} WHERE id = ?"), [&id]).ok();
                touched.insert(board);
                out_del[table].as_array_mut().unwrap().push(json!(id));
            }
        }

        for id in req.deletes.boards {
            let Some(owner) = db::board_owner(&tx, &id).ok().flatten() else { continue };
            if owner != user.id && !user.is_admin {
                reject("board", &id, "only its owner can delete it (others can leave it)");
                continue;
            }
            audience_extra.extend(db::member_ids(&tx, &id).unwrap_or_default());
            tx.execute("DELETE FROM boards WHERE id = ?", [&id]).ok(); // buckets, cards, members, invites cascade
            touched.remove(&id);
            out_del["boards"].as_array_mut().unwrap().push(json!(id));
        }

        if let Some(doc) = &req.user {
            tx.execute(
                "INSERT INTO user_docs (user_id, data, updated) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated = ?3",
                params![user.id, doc.to_string(), t],
            )
            .ok();
        }

        // Boards go out with their owner and members filled in.
        let ids: Vec<String> = out_up["boards"].as_array().unwrap().iter().filter_map(|x| x.as_str().map(str::to_string)).collect();
        out_up["boards"] = json!(ids
            .iter()
            .filter_map(|id| {
                tx.query_row("SELECT data, owner_id FROM boards WHERE id = ?", [id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .ok()
                    .map(|(d, o)| decorate_board(&tx, id, &d, &o))
            })
            .collect::<Vec<_>>());

        let mut audience: BTreeSet<String> = audience_extra;
        for b in &touched {
            audience.extend(db::member_ids(&tx, b).unwrap_or_default());
        }
        tx.commit().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

        if !audience.is_empty() {
            app.send(Event {
                users: audience.into_iter().collect(),
                kind: "ops",
                from: req.client.clone(),
                json: json!({ "upserts": out_up, "deletes": out_del }).to_string(),
            });
        }
    }
    if let Some(doc) = req.user {
        app.send(Event { users: vec![user.id.clone()], kind: "user", from: req.client, json: doc.to_string() });
    }
    Ok(Json(json!({ "ok": true, "rejected": rejected })).into_response())
}

#[derive(Deserialize)]
pub struct EventsQuery {
    #[serde(default)]
    client: String,
}

/// GET /api/events: live changes for this person (Server-Sent Events).
pub async fn events(State(app): State<App>, headers: HeaderMap, Query(q): Query<EventsQuery>) -> Response {
    let user = match auth::require(&app, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let rx = app.tx.subscribe();
    let hello = stream::once(async { Ok::<_, Infallible>(sse::Event::default().event("hello").data("{}")) });
    let me = user.id.clone();
    let updates = stream::unfold((rx, me, q.client), |(mut rx, me, client)| async move {
        loop {
            match rx.recv().await {
                Ok(ev) if ev.users.iter().any(|u| u == &me) && (ev.from.is_empty() || ev.from != client) => {
                    if ev.kind == "signout" {
                        return None;
                    }
                    return Some((Ok(sse::Event::default().event(ev.kind).data(ev.json)), (rx, me, client)));
                }
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => return None,
            }
        }
    });
    let s: std::pin::Pin<Box<dyn Stream<Item = Result<sse::Event, Infallible>> + Send>> =
        Box::pin(futures_util::StreamExt::chain(hello, updates));
    sse::Sse::new(s).keep_alive(sse::KeepAlive::default()).into_response()
}

/// GET /api/users: who's on this server (for inviting people and assigning tasks).
pub async fn directory(State(app): State<App>, headers: HeaderMap) -> ApiResult {
    auth::require(&app, &headers)?;
    let users: Vec<Value> = db::all_users(&app.db.lock().unwrap())
        .unwrap_or_default()
        .into_iter()
        .filter(|u| !u.disabled)
        .map(|u| json!({ "id": u.id, "username": u.username, "displayName": u.display_name }))
        .collect();
    Ok(Json(users).into_response())
}

/// A new display name: update the account and every card on your boards assigned to the old name.
pub fn rename_person(app: &App, user_id: &str, from: &str, to: &str) -> Result<(), Response> {
    let mut changed: Vec<(String, Value)> = vec![];
    let audience: BTreeSet<String>;
    {
        let db = app.db.lock().unwrap();
        db.execute("UPDATE users SET display_name = ? WHERE id = ?", params![to, user_id]).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let boards = my_board_ids(&db, user_id);
        let mut aud = BTreeSet::new();
        for b in &boards {
            let mut st = db.prepare("SELECT id, data FROM cards WHERE board_id = ?").unwrap();
            let rows: Vec<(String, String)> = st.query_map([b], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().flatten().collect();
            for (id, data) in rows {
                let Ok(mut v) = serde_json::from_str::<Value>(&data) else { continue };
                let Some(arr) = v.get_mut("assignees").and_then(|a| a.as_array_mut()) else { continue };
                if !arr.iter().any(|x| x == from) {
                    continue;
                }
                for x in arr.iter_mut() {
                    if x == from {
                        *x = json!(to);
                    }
                }
                db.execute("UPDATE cards SET data = ?, updated = ? WHERE id = ?", params![v.to_string(), now(), id]).ok();
                changed.push((b.clone(), v));
            }
            aud.extend(db::member_ids(&db, b).unwrap_or_default());
        }
        audience = aud;
    }
    // Everyone sharing a board with you sees the new name (their people list comes from /api/data).
    app.send(Event { users: audience.into_iter().collect(), kind: "reload", from: String::new(), json: "{}".into() });
    let _ = changed;
    Ok(())
}
