import { useEffect, useState } from "react";
import { CalendarPlus, Copy, KeyRound, LogOut, UserCog } from "lucide-react";
import { useStore } from "../store";
import { calendarLink, changePassword, loadData, logout, me, updateProfile } from "../server";
import { copyText } from "./Markdown";
import { ask, InlineEdit } from "./ui";

/** TCI Boards server: your name, password, and signing out. */
export function AccountPanel() {
  const name = useStore((s) => s.data.settings.me);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  return (
    <section className="panel" id="set-account">
      <h3>
        <UserCog size={15} /> Your account
      </h3>
      <div className="field-row">
        <label>Name</label>
        <InlineEdit
          value={name}
          onSave={async (displayName) => {
            try {
              await updateProfile(displayName);
              // Cards assigned to your old name follow the new one.
              useStore.getState().reloadFromServer(await loadData());
              useStore.getState().toast("Name changed everywhere");
            } catch (e) {
              useStore.getState().toast(String(e instanceof Error ? e.message : e));
            }
          }}
        />
      </div>
      <div className="field-row">
        <label>Username</label>
        <span>
          @{me?.username} {me?.isAdmin && <span className="chip small accent">Admin</span>}
        </span>
      </div>
      <form
        className="password-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (next !== again) return setMsg({ text: "The new passwords don't match.", error: true });
          try {
            await changePassword(current, next);
            setMsg({ text: "Password changed. Your other devices were signed out." });
            setCurrent("");
            setNext("");
            setAgain("");
          } catch (er) {
            setMsg({ text: String(er instanceof Error ? er.message : er), error: true });
          }
        }}
      >
        <span className="step-title">
          <KeyRound size={14} /> Change password
        </span>
        <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="New password again" value={again} onChange={(e) => setAgain(e.target.value)} />
        <button className="btn sm" disabled={!current || next.length < 8 || !again}>
          Change password
        </button>
        {msg && <p className={`small ${msg.error ? "danger-text" : "ok-text"}`}>{msg.text}</p>}
      </form>
      <button
        className="btn sm ghost"
        onClick={async () => {
          await logout().catch(() => {});
          location.hash = "";
          location.reload();
        }}
      >
        <LogOut size={14} /> Sign out
      </button>
      <CalendarLink />
    </section>
  );
}

/** A private link your calendar app subscribes to, so your TCI Boards dates show there (see feed.rs). */
function CalendarLink() {
  const [on, setOn] = useState<boolean | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void calendarLink.status().then((s) => setOn(s.on), () => setOn(false));
  }, []);
  const make = async () => {
    if (on && !(await ask("Make a new link? The old one stops working, so calendars using it need the new one.", { okText: "Make a new link" }))) return;
    try {
      const { path } = await calendarLink.create();
      setUrl(location.origin + path);
      setOn(true);
    } catch (e) {
      useStore.getState().toast(String(e instanceof Error ? e.message : e));
    }
  };
  const off = async () => {
    if (!(await ask("Turn off your calendar link? Calendars using it stop getting your TCI Boards dates.", { okText: "Turn off", danger: true }))) return;
    await calendarLink.remove().catch(() => {});
    setUrl(null);
    setOn(false);
  };
  return (
    <div className="calendar-link">
      <h4>
        <CalendarPlus size={15} /> Your dates in your calendar app
      </h4>
      <p className="muted small">
        A private link that Google Calendar, Outlook or Apple Calendar can subscribe to. It shows the dated cards on every board you
        can see (not completed ones), with their times, and updates whenever your calendar app checks (often every few hours). Anyone
        with the link can see those cards, so keep it to yourself.
      </p>
      {url ? (
        <>
          <div className="row gap-sm wrap">
            <code className="grow calendar-url">{url}</code>
            <button className="btn sm" onClick={() => void copyText(url, "Copied the calendar link")}>
              <Copy size={14} /> Copy
            </button>
          </div>
          <ul className="small calendar-steps">
            <li>
              <b>Google Calendar</b> (on a computer): <b>Other calendars</b> + &gt; <b>From URL</b>, paste the link.
            </li>
            <li>
              <b>Outlook:</b> <b>Add calendar</b> &gt; <b>Subscribe from web</b>, paste the link.
            </li>
            <li>
              <b>Apple Calendar:</b> <a href={url.replace(/^https?:/, "webcal:")}>open it in Calendar</a>, or File &gt; New Calendar
              Subscription.
            </li>
          </ul>
          <p className="muted small">
            This link is shown once. Google and Outlook fetch it from the internet, so this server must be reachable from outside your
            home network (for example with your own domain); Apple Calendar on the same network works either way.
          </p>
        </>
      ) : (
        on && <p className="small">You have a calendar link. Lost it? Make a new one (the old one then stops working).</p>
      )}
      <div className="row gap-sm wrap">
        <button className="btn sm" onClick={() => void make()} disabled={on === null}>
          {on ? "Make a new link" : "Make my calendar link"}
        </button>
        {on && (
          <button className="btn sm ghost" onClick={() => void off()}>
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}
