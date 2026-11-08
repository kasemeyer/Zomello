//! "Servers on this network", Plex style: the server announces itself on the local network with
//! mDNS (the way printers and Plex do), so the Zomello app can list it without anyone typing an address.
//!
//! On by default for normal installs. In Docker it's off unless `ZOMELLO_DISCOVERY=on`, because a
//! container only knows its own internal address (use it with `network_mode: host`).
//! `ZOMELLO_DISCOVERY=off` turns it off everywhere.

pub const SERVICE: &str = "_zomello._tcp.local.";

/// Start announcing. The returned daemon keeps the announcement alive; dropping it stops it.
pub fn announce(name: Option<String>, port: u16, https: bool, setting: Option<String>) -> Option<mdns_sd::ServiceDaemon> {
    let in_docker = std::path::Path::new("/.dockerenv").exists();
    match setting.as_deref().map(str::to_ascii_lowercase).as_deref() {
        Some("off") | Some("0") | Some("false") | Some("no") => return None,
        Some("on") | Some("1") | Some("true") | Some("yes") => {}
        _ if in_docker => return None,
        _ => {}
    }
    let host = hostname();
    let name = name.unwrap_or_else(|| format!("TCI Boards on {host}"));
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| eprintln!("Network discovery is off: {e}")).ok()?;
    let props = [("name", name.as_str()), ("scheme", if https { "https" } else { "http" }), ("version", env!("CARGO_PKG_VERSION"))];
    // An empty address list plus enable_addr_auto: the library announces this computer's addresses
    // and keeps up when they change.
    let info = mdns_sd::ServiceInfo::new(SERVICE, &name, &format!("{host}.local."), "", port, &props[..]).ok()?.enable_addr_auto();
    if let Err(e) = daemon.register(info) {
        eprintln!("Network discovery is off: {e}");
        return None;
    }
    Some(daemon)
}

fn hostname() -> String {
    let raw = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .or_else(|| std::process::Command::new("hostname").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).to_string()))
        .unwrap_or_default();
    let clean: String = raw.trim().trim_end_matches(".local").chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
    if clean.is_empty() { "zomello".into() } else { clean }
}
