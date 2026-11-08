//! Storage: one SQLite file (`zomello.db` in the data folder).
//!
//! Boards, buckets (lists) and cards are kept as the same JSON the app uses, one row each, so the
//! web app's data model stays the single source of truth. The server adds what it alone decides:
//! who owns a board, who's a member, accounts and sessions.

use rusqlite::{params, Connection, OptionalExtension};

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let db = Connection::open(path)?;
    db.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    migrate(&db)?;
    Ok(db)
}

fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS users (
           id TEXT PRIMARY KEY,
           username TEXT NOT NULL UNIQUE COLLATE NOCASE,
           display_name TEXT NOT NULL,
           pass_hash TEXT NOT NULL,
           is_admin INTEGER NOT NULL DEFAULT 0,
           disabled INTEGER NOT NULL DEFAULT 0,
           created INTEGER NOT NULL,
           last_login INTEGER
         );
         CREATE TABLE IF NOT EXISTS sessions (
           token_hash TEXT PRIMARY KEY,
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           created INTEGER NOT NULL,
           last_seen INTEGER NOT NULL,
           agent TEXT
         );
         CREATE TABLE IF NOT EXISTS boards (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL REFERENCES users(id),
           data TEXT NOT NULL,
           updated INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS members (
           board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           role TEXT NOT NULL,
           added INTEGER NOT NULL,
           PRIMARY KEY (board_id, user_id)
         );
         CREATE INDEX IF NOT EXISTS members_by_user ON members(user_id);
         CREATE TABLE IF NOT EXISTS invites (
           id TEXT PRIMARY KEY,
           board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
           from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           role TEXT NOT NULL DEFAULT 'member',
           created INTEGER NOT NULL,
           UNIQUE (board_id, to_user)
         );
         CREATE TABLE IF NOT EXISTS lists (
           id TEXT PRIMARY KEY,
           board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
           data TEXT NOT NULL,
           updated INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS lists_by_board ON lists(board_id);
         CREATE TABLE IF NOT EXISTS cards (
           id TEXT PRIMARY KEY,
           board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
           data TEXT NOT NULL,
           updated INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS cards_by_board ON cards(board_id);
         CREATE TABLE IF NOT EXISTS user_docs (
           user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
           data TEXT NOT NULL,
           updated INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS calendar_links (
           token_hash TEXT PRIMARY KEY,
           user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
           created INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS attachments (
           rel TEXT PRIMARY KEY,
           uploader TEXT,
           created INTEGER NOT NULL
         );",
    )?;
    // Databases from before boards had viewers: invitations didn't carry a role.
    let has_role: i64 = db.query_row("SELECT COUNT(*) FROM pragma_table_info('invites') WHERE name = 'role'", [], |r| r.get(0))?;
    if has_role == 0 {
        db.execute("ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'member'", [])?;
    }
    db.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', '1')", [])?;
    Ok(())
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub is_admin: bool,
    pub disabled: bool,
    pub created: i64,
    pub last_login: Option<i64>,
}

const USER_COLS: &str = "id, username, display_name, is_admin, disabled, created, last_login";

fn row_user(r: &rusqlite::Row) -> rusqlite::Result<User> {
    Ok(User {
        id: r.get(0)?,
        username: r.get(1)?,
        display_name: r.get(2)?,
        is_admin: r.get::<_, i64>(3)? != 0,
        disabled: r.get::<_, i64>(4)? != 0,
        created: r.get(5)?,
        last_login: r.get(6)?,
    })
}

pub fn user_by_id(db: &Connection, id: &str) -> rusqlite::Result<Option<User>> {
    db.query_row(&format!("SELECT {USER_COLS} FROM users WHERE id = ?"), [id], row_user).optional()
}

pub fn user_by_name(db: &Connection, username: &str) -> rusqlite::Result<Option<(User, String)>> {
    db.query_row(&format!("SELECT {USER_COLS}, pass_hash FROM users WHERE username = ?"), [username], |r| {
        Ok((row_user(r)?, r.get(7)?))
    })
    .optional()
}

pub fn all_users(db: &Connection) -> rusqlite::Result<Vec<User>> {
    let mut st = db.prepare(&format!("SELECT {USER_COLS} FROM users ORDER BY display_name COLLATE NOCASE"))?;
    let rows = st.query_map([], row_user)?;
    rows.collect()
}

pub fn user_count(db: &Connection) -> rusqlite::Result<i64> {
    db.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
}

pub fn is_member(db: &Connection, board: &str, user: &str) -> rusqlite::Result<bool> {
    db.query_row("SELECT 1 FROM members WHERE board_id = ? AND user_id = ?", params![board, user], |_| Ok(()))
        .optional()
        .map(|o| o.is_some())
}

/// Can this person change the board's contents? Viewers can only look.
pub fn can_edit(db: &Connection, board: &str, user: &str) -> rusqlite::Result<bool> {
    db.query_row("SELECT 1 FROM members WHERE board_id = ? AND user_id = ? AND role != 'viewer'", params![board, user], |_| Ok(()))
        .optional()
        .map(|o| o.is_some())
}

pub fn board_owner(db: &Connection, board: &str) -> rusqlite::Result<Option<String>> {
    db.query_row("SELECT owner_id FROM boards WHERE id = ?", [board], |r| r.get(0)).optional()
}

/// Everyone who can see a board.
pub fn member_ids(db: &Connection, board: &str) -> rusqlite::Result<Vec<String>> {
    let mut st = db.prepare("SELECT user_id FROM members WHERE board_id = ?")?;
    let rows = st.query_map([board], |r| r.get(0))?;
    rows.collect()
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub user_id: String,
    pub display_name: String,
    pub username: String,
    pub role: String,
}

pub fn members(db: &Connection, board: &str) -> rusqlite::Result<Vec<Member>> {
    let mut st = db.prepare(
        "SELECT m.user_id, u.display_name, u.username, m.role FROM members m JOIN users u ON u.id = m.user_id
         WHERE m.board_id = ? ORDER BY (m.role = 'owner') DESC, u.display_name COLLATE NOCASE",
    )?;
    let rows = st.query_map([board], |r| {
        Ok(Member { user_id: r.get(0)?, display_name: r.get(1)?, username: r.get(2)?, role: r.get(3)? })
    })?;
    rows.collect()
}
