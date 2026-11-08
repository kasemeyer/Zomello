//! End-to-end checks of the server's rules, run against the real router with a fresh database:
//! accounts, sign-in limits, who can see and change which board, sharing, admin-only pages, and files.
//! `cargo test` in server/.

use crate::*;
use axum::body::Body;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

struct T {
    router: Router,
    _dir: TempDir,
}

/// A data folder that's removed when the test ends.
struct TempDir(PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Res {
    status: u16,
    cookie: Option<String>,
    text: String,
}
impl Res {
    fn json(&self) -> Value {
        serde_json::from_str(&self.text).unwrap_or(Value::Null)
    }
    fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

impl T {
    fn new() -> T {
        let dir = std::env::temp_dir().join(format!("zomello-test-{}", random_hex(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = db::open(&dir.join("zomello.db")).unwrap();
        let config = Config { data_dir: dir.clone(), port: 0, bind: "127.0.0.1".into(), tls: false, self_cert: false, public_url: None };
        let app: App = Arc::new(AppInner { db: Mutex::new(conn), config, tx: broadcast::channel(64).0, fails: Mutex::new(HashMap::new()) });
        T { router: router(app), _dir: TempDir(dir) }
    }

    async fn req(&self, method: &str, path: &str, cookie: Option<&str>, body: Option<Value>, origin: Option<&str>) -> Res {
        let mut b = axum::http::Request::builder().method(method).uri(path).header("host", "zomello.test");
        if let Some(c) = cookie {
            b = b.header("cookie", c);
        }
        if let Some(o) = origin {
            b = b.header("origin", o);
        }
        let req = match body {
            Some(v) => b.header("content-type", "application/json").body(Body::from(v.to_string())).unwrap(),
            None => b.body(Body::empty()).unwrap(),
        };
        let res = self.router.clone().oneshot(req).await.unwrap();
        let status = res.status().as_u16();
        let cookie = res
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find(|v| v.starts_with("zomello_session=") && !v.starts_with("zomello_session=;"))
            .map(|v| v.split(';').next().unwrap().to_string());
        let text = String::from_utf8_lossy(&res.into_body().collect().await.unwrap().to_bytes()).to_string();
        Res { status, cookie, text }
    }
    async fn get(&self, path: &str, cookie: &str) -> Res {
        self.req("GET", path, Some(cookie), None, None).await
    }
    async fn post(&self, path: &str, cookie: &str, body: Value) -> Res {
        self.req("POST", path, Some(cookie), Some(body), Some("http://zomello.test")).await
    }
    async fn login(&self, user: &str, pass: &str) -> Res {
        self.req("POST", "/api/login", None, Some(json!({ "username": user, "password": pass })), None).await
    }

    /// First run: the admin account. Then two more people made by the admin.
    async fn people(&self) -> (String, String, String) {
        let r = self.req("POST", "/api/setup", None, Some(json!({ "username": "pat", "displayName": "Pat", "password": "secret-pass-1" })), None).await;
        assert!(r.ok(), "setup: {} {}", r.status, r.text);
        let pat = r.cookie.expect("setup signs in");
        for (u, n) in [("sam", "Sam"), ("alex", "Alex")] {
            let r = self.post("/api/admin/users", &pat, json!({ "username": u, "displayName": n, "password": format!("{u}-pass-123"), "isAdmin": false })).await;
            assert!(r.ok(), "create {u}: {} {}", r.status, r.text);
        }
        let sam = self.login("sam", "sam-pass-123").await.cookie.expect("sam signs in");
        let alex = self.login("alex", "alex-pass-123").await.cookie.expect("alex signs in");
        (pat, sam, alex)
    }

    /// A board with one bucket and one card, owned by `who`.
    async fn board(&self, who: &str, id: &str) {
        let r = self
            .post(
                "/api/sync",
                who,
                json!({ "client": "t", "upserts": {
                    "boards": [{ "id": id, "title": format!("Board {id}"), "color": "#f00" }],
                    "lists": [{ "id": format!("{id}-l"), "boardId": id, "title": "To do", "order": 0 }],
                    "cards": [{ "id": format!("{id}-c"), "boardId": id, "listId": format!("{id}-l"), "title": "Paint fence", "attachments": [] }]
                }}),
            )
            .await;
        assert!(r.ok(), "create board: {} {}", r.status, r.text);
    }

    async fn boards_of(&self, who: &str) -> Vec<String> {
        let d = self.get("/api/data", who).await.json();
        d["boards"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default()
    }

    async fn card_title(&self, who: &str, id: &str) -> Option<String> {
        self.get("/api/data", who).await.json()["cards"][id]["title"].as_str().map(str::to_string)
    }

    /// `owner` invites `username`; `guest` accepts.
    async fn share(&self, owner: &str, board: &str, username: &str, guest: &str) {
        let r = self.post(&format!("/api/boards/{board}/invite"), owner, json!({ "username": username })).await;
        assert!(r.ok(), "invite: {} {}", r.status, r.text);
        let invites = self.get("/api/invites", guest).await.json();
        let id = invites[0]["id"].as_str().expect("an invitation").to_string();
        let r = self.post(&format!("/api/invites/{id}/accept"), guest, json!({})).await;
        assert!(r.ok(), "accept: {} {}", r.status, r.text);
    }
}

#[tokio::test]
async fn first_run_makes_one_admin_only() {
    let t = T::new();
    let s = t.req("GET", "/api/session", None, None, None).await.json();
    assert_eq!(s["setupNeeded"], true);
    t.people().await;
    let again = t.req("POST", "/api/setup", None, Some(json!({ "username": "x", "displayName": "X", "password": "another-pass-1" })), None).await;
    assert!(!again.ok(), "a second setup must be refused");
    assert_eq!(t.req("GET", "/api/session", None, None, None).await.json()["setupNeeded"], false);
}

#[tokio::test]
async fn sign_in_rules() {
    let t = T::new();
    t.people().await;
    assert!(t.login("SAM", "sam-pass-123").await.ok(), "usernames ignore letter case");
    assert!(!t.login("sam", "wrong").await.ok());
    assert!(!t.login("nobody", "whatever-1").await.ok());
    for _ in 0..6 {
        t.login("alex", "wrong").await;
    }
    assert!(!t.login("alex", "alex-pass-123").await.ok(), "after repeated wrong passwords, sign-in pauses even with the right one");
    let r = t.post("/api/admin/users", &t.login("pat", "secret-pass-1").await.cookie.unwrap(), json!({ "username": "shorty", "displayName": "S", "password": "short", "isAdmin": false })).await;
    assert!(!r.ok(), "passwords under 8 characters are refused");
}

#[tokio::test]
async fn boards_are_private_until_shared() {
    let t = T::new();
    let (pat, sam, alex) = t.people().await;
    t.board(&pat, "b1").await;

    assert!(!t.boards_of(&sam).await.contains(&"b1".to_string()), "others can't see a board");
    t.post("/api/sync", &sam, json!({ "upserts": { "cards": [{ "id": "b1-c", "boardId": "b1", "listId": "b1-l", "title": "HACKED" }] } })).await;
    assert_eq!(t.card_title(&pat, "b1-c").await.as_deref(), Some("Paint fence"), "others can't change a board's cards");
    t.post("/api/sync", &sam, json!({ "upserts": { "lists": [{ "id": "evil", "boardId": "b1", "title": "x", "order": 9 }] } })).await;
    let lists = t.get("/api/data", &pat).await.json()["lists"].clone();
    assert!(lists.get("evil").is_none(), "others can't add buckets to a board");

    t.share(&pat, "b1", "sam", &sam).await;
    assert!(t.boards_of(&sam).await.contains(&"b1".to_string()));
    let r = t.post("/api/sync", &sam, json!({ "upserts": { "cards": [{ "id": "b1-c", "boardId": "b1", "listId": "b1-l", "title": "Painted by Sam" }] } })).await;
    assert!(r.ok());
    assert_eq!(t.card_title(&pat, "b1-c").await.as_deref(), Some("Painted by Sam"), "members can change cards");

    t.post("/api/sync", &sam, json!({ "deletes": { "boards": ["b1"] } })).await;
    assert!(t.boards_of(&pat).await.contains(&"b1".to_string()), "only the owner deletes a board");

    let r = t.post("/api/boards/b1/invite", &sam, json!({ "username": "alex" })).await;
    assert!(!r.ok(), "only the owner invites");
    assert!(!t.boards_of(&alex).await.contains(&"b1".to_string()));

    // Moving a card onto a board you can't see is refused.
    t.board(&alex, "b2").await;
    t.post("/api/sync", &sam, json!({ "upserts": { "cards": [{ "id": "b1-c", "boardId": "b2", "listId": "b2-l", "title": "Moved" }] } })).await;
    assert_eq!(t.get("/api/data", &pat).await.json()["cards"]["b1-c"]["boardId"], "b1");

    assert!(t.post("/api/boards/b1/leave", &sam, json!({})).await.ok());
    assert!(!t.boards_of(&sam).await.contains(&"b1".to_string()), "leaving removes the board for that person");
}

#[tokio::test]
async fn viewers_can_look_but_not_touch() {
    let t = T::new();
    let (pat, sam, _alex) = t.people().await;
    t.board(&pat, "b1").await;

    // Invited as a viewer: the invitation carries the role.
    let r = t.post("/api/boards/b1/invite", &pat, json!({ "username": "sam", "role": "viewer" })).await;
    assert!(r.ok(), "invite viewer: {} {}", r.status, r.text);
    assert!(!t.post("/api/boards/b1/invite", &pat, json!({ "username": "alex", "role": "boss" })).await.ok(), "made-up roles are refused");
    let id = t.get("/api/invites", &sam).await.json()[0]["id"].as_str().expect("an invitation").to_string();
    assert!(t.post(&format!("/api/invites/{id}/accept"), &sam, json!({})).await.ok());

    // Viewers see the board and its cards.
    assert!(t.boards_of(&sam).await.contains(&"b1".to_string()), "viewers see the board");
    assert_eq!(t.card_title(&sam, "b1-c").await.as_deref(), Some("Paint fence"));

    // ...but every change is refused and listed in `rejected`.
    let r = t.post("/api/sync", &sam, json!({ "upserts": { "cards": [{ "id": "b1-c", "boardId": "b1", "listId": "b1-l", "title": "Changed" }] } })).await;
    assert_eq!(r.json()["rejected"].as_array().map(Vec::len), Some(1), "a viewer's edit comes back rejected");
    assert_eq!(t.card_title(&pat, "b1-c").await.as_deref(), Some("Paint fence"), "viewers can't change cards");
    t.post("/api/sync", &sam, json!({ "upserts": { "lists": [{ "id": "v-l", "boardId": "b1", "title": "x", "order": 9 }] } })).await;
    assert!(t.get("/api/data", &pat).await.json()["lists"].get("v-l").is_none(), "viewers can't add buckets");
    t.post("/api/sync", &sam, json!({ "deletes": { "cards": ["b1-c"] } })).await;
    assert_eq!(t.card_title(&pat, "b1-c").await.as_deref(), Some("Paint fence"), "viewers can't delete cards");
    t.post("/api/sync", &sam, json!({ "upserts": { "boards": [{ "id": "b1", "title": "Renamed" }] } })).await;
    assert_eq!(t.get("/api/data", &sam).await.json()["boards"]["b1"]["title"], "Board b1", "viewers can't change the board itself");

    // Members can't drag a card off a board that's view-only for them onto their own board.
    t.board(&sam, "b2").await;
    t.post("/api/sync", &sam, json!({ "upserts": { "cards": [{ "id": "b1-c", "boardId": "b2", "listId": "b2-l", "title": "Taken" }] } })).await;
    assert_eq!(t.get("/api/data", &pat).await.json()["cards"]["b1-c"]["boardId"], "b1");

    // The sharing page says who's a viewer, and the owner can switch roles.
    let members = t.get("/api/boards/b1/sharing", &pat).await.json()["members"].clone();
    let sam_row = members.as_array().unwrap().iter().find(|m| m["username"] == "sam").expect("sam is on the board").clone();
    assert_eq!(sam_row["role"], "viewer");
    let sam_id = sam_row["userId"].as_str().unwrap().to_string();
    let not_owner = t.req("PATCH", &format!("/api/boards/b1/members/{sam_id}"), Some(&sam), Some(json!({ "role": "member" })), Some("http://zomello.test")).await;
    assert!(!not_owner.ok(), "only the owner changes roles");
    let r = t.req("PATCH", &format!("/api/boards/b1/members/{sam_id}"), Some(&pat), Some(json!({ "role": "member" })), Some("http://zomello.test")).await;
    assert!(r.ok(), "promote: {} {}", r.status, r.text);
    let r = t.post("/api/sync", &sam, json!({ "upserts": { "cards": [{ "id": "b1-c", "boardId": "b1", "listId": "b1-l", "title": "Painted by Sam" }] } })).await;
    assert!(r.ok());
    assert_eq!(t.card_title(&pat, "b1-c").await.as_deref(), Some("Painted by Sam"), "promoted to member, they can edit");
    assert!(t.req("PATCH", &format!("/api/boards/b1/members/{sam_id}"), Some(&pat), Some(json!({ "role": "viewer" })), Some("http://zomello.test")).await.ok(), "and back to viewer");

    // The owner's own role can't be changed away.
    let pat_id = members.as_array().unwrap().iter().find(|m| m["role"] == "owner").unwrap()["userId"].as_str().unwrap().to_string();
    assert!(!t.req("PATCH", &format!("/api/boards/b1/members/{pat_id}"), Some(&pat), Some(json!({ "role": "viewer" })), Some("http://zomello.test")).await.ok());
}

#[tokio::test]
async fn admin_pages_and_turning_people_off() {
    let t = T::new();
    let (pat, sam, _) = t.people().await;
    assert!(!t.get("/api/admin/users", &sam).await.ok(), "only admins see the Admin pages");
    assert!(!t.get("/api/admin/backup", &sam).await.ok());
    let users = t.get("/api/admin/users", &pat).await.json();
    let sam_id = users.as_array().unwrap().iter().find(|u| u["username"] == "sam").unwrap()["id"].as_str().unwrap().to_string();
    let r = t.req("PATCH", &format!("/api/admin/users/{sam_id}"), Some(&pat), Some(json!({ "disabled": true })), Some("http://zomello.test")).await;
    assert!(r.ok(), "{} {}", r.status, r.text);
    assert_eq!(t.get("/api/data", &sam).await.status, 401, "turning someone off ends their sessions");
    assert!(!t.login("sam", "sam-pass-123").await.ok(), "and they can't sign in");
    assert!(t.get("/api/admin/backup", &pat).await.ok());
}

#[tokio::test]
async fn other_sites_cant_make_changes() {
    let t = T::new();
    let (pat, _, _) = t.people().await;
    let r = t.req("POST", "/api/sync", Some(&pat), Some(json!({ "upserts": { "boards": [{ "id": "x", "title": "Evil" }] } })), Some("https://evil.example")).await;
    assert_eq!(r.status, 403);
    assert!(!t.boards_of(&pat).await.contains(&"x".to_string()));
    assert_eq!(t.req("GET", "/api/data", None, None, None).await.status, 401, "nothing without signing in");
}

#[tokio::test]
async fn files_only_for_people_on_the_board() {
    let t = T::new();
    let (pat, sam, alex) = t.people().await;
    t.board(&pat, "b1").await;
    let up = axum::http::Request::builder()
        .method("POST")
        .uri("/api/attachment")
        .header("host", "zomello.test")
        .header("origin", "http://zomello.test")
        .header("cookie", &pat)
        .header("x-name", "plan.txt")
        .body(Body::from("secret plan"))
        .unwrap();
    let res = t.router.clone().oneshot(up).await.unwrap();
    assert!(res.status().is_success());
    let rel = String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap();
    assert!(rel.starts_with("attachments/"));

    assert_eq!(t.get(&format!("/api/file/{rel}"), &pat).await.text, "secret plan", "the uploader can open it");
    assert!(!t.get(&format!("/api/file/{rel}"), &sam).await.ok(), "others can't, before it's on a shared board");

    t.post(
        "/api/sync",
        &pat,
        json!({ "upserts": { "cards": [{ "id": "b1-c", "boardId": "b1", "listId": "b1-l", "title": "Paint fence",
            "attachments": [{ "id": "a", "name": "plan.txt", "url": rel, "stored": true, "addedAt": 1 }] }] } }),
    )
    .await;
    t.share(&pat, "b1", "sam", &sam).await;
    assert!(t.get(&format!("/api/file/{rel}"), &sam).await.ok(), "people on the board can open its files");
    assert!(!t.get(&format!("/api/file/{rel}"), &alex).await.ok(), "people who aren't still can't");

    for bad in ["/api/file/../zomello.db", "/api/file/attachments/../zomello.db", "/api/file/%2e%2e/zomello.db"] {
        assert!(!t.get(bad, &pat).await.ok(), "{bad} must not escape the attachments folder");
    }
}

#[tokio::test]
async fn calendar_links_are_private_and_can_be_turned_off() {
    let t = T::new();
    let (pat, sam, _) = t.people().await;
    t.board(&pat, "g").await;
    let r = t
        .post("/api/sync", &pat, json!({ "client": "t", "upserts": { "cards": [{ "id": "g-d", "boardId": "g", "listId": "g-l", "title": "Dentist", "dueDate": "2026-10-28", "startTime": "15:00", "dueTime": "16:00", "attachments": [] }] } }))
        .await;
    assert!(r.ok(), "{}", r.text);
    assert_eq!(t.get("/api/me/calendar-link", &pat).await.json()["on"], false);
    let path = t.post("/api/me/calendar-link", &pat, json!({})).await.json()["path"].as_str().unwrap().to_string();
    // No sign-in needed: the secret in the link is the key.
    let ics = t.req("GET", &path, None, None, None).await;
    assert_eq!(ics.status, 200);
    assert!(ics.text.contains("SUMMARY:Dentist") && ics.text.contains("DTSTART:20261028T150000"));
    // Someone else's calendar doesn't have it.
    let sams = t.post("/api/me/calendar-link", &sam, json!({})).await.json()["path"].as_str().unwrap().to_string();
    assert!(!t.req("GET", &sams, None, None, None).await.text.contains("Dentist"));
    // A new link turns the old one off, and so does turning it off.
    let newer = t.post("/api/me/calendar-link", &pat, json!({})).await.json()["path"].as_str().unwrap().to_string();
    assert_eq!(t.req("GET", &path, None, None, None).await.status, 404);
    assert_eq!(t.req("GET", &newer, None, None, None).await.status, 200);
    t.req("DELETE", "/api/me/calendar-link", Some(&pat), None, Some("http://zomello.test")).await;
    assert_eq!(t.req("GET", &newer, None, None, None).await.status, 404);
    assert_eq!(t.req("GET", "/calendar/nope.ics", None, None, None).await.status, 404);
}
