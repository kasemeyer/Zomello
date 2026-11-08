import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Download, KeyRound, Plus, RefreshCw, Shield, ShieldOff, Trash2, UserCheck, UserPlus, UserX, X } from "lucide-react";
import { admin, me, type AdminBoard, type AdminUser } from "../server";
import { CertHint } from "./ServerGate";
import { useStore } from "../store";
import { ask, Avatar, InlineEdit } from "./ui";
import { copyText } from "./Markdown";

const bytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const ago = (secs: number | null) => (secs ? formatDistanceToNow(secs * 1000, { addSuffix: true }) : "never");

/** What to send someone so they can sign in: the address, their account, and where to use it. */
let publicUrl: string | null = null;
function signInDetails(name: string, username: string, password: string) {
  const address = publicUrl || location.origin;
  return [
    `TCI Boards sign-in for ${name}`,
    `Address: ${address}`,
    `Username: ${username}`,
    `Password: ${password}`,
    "",
    `Open the address in a browser (on a phone you can then install it as an app), or in the TCI Boards app: Settings → TCI Boards servers → add ${address}.`,
    "You can change your password in Settings once you're in.",
  ].join("\n");
}

/** A readable temporary password, e.g. "maple-river-4821". */
function tempPassword() {
  const words = ["maple", "river", "comet", "tiger", "lemon", "harbor", "pixel", "cedar", "ember", "nova", "otter", "violet", "basil", "echo"];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  return `${pick()}-${pick()}-${1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)}`;
}

/** TCI Boards server: manage people and boards (admins only). */
export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [boards, setBoards] = useState<AdminBoard[]>([]);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof admin.info>> | null>(null);
  const [error, setError] = useState("");
  const toast = (t: string) => useStore.getState().toast(t);

  const refresh = async () => {
    try {
      const [u, b, i] = await Promise.all([admin.users(), admin.boards(), admin.info()]);
      setUsers(u);
      setBoards(b);
      setInfo(i);
      publicUrl = i.publicUrl;
      setError("");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  useEffect(() => void refresh(), []);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
    }
    await refresh();
  };

  if (!me?.isAdmin)
    return (
      <div className="page">
        <h1>Admin</h1>
        <p className="muted">Only admins can see this page.</p>
      </div>
    );

  const name = (id: string) => users.find((u) => u.id === id)?.displayName ?? "?";

  return (
    <div className="page admin">
      <div className="row between">
        <h1>Admin</h1>
        <button className="btn ghost sm" onClick={() => void refresh()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {error && <p className="danger-text">{error}</p>}

      {info && (
        <section className="panel">
          <h3>Server</h3>
          <div className="admin-stats">
            <span>
              <b>{info.users}</b> people
            </span>
            <span>
              <b>{info.boards}</b> boards
            </span>
            <span>
              <b>{info.cards}</b> cards
            </span>
            <span>
              <b>{bytes(info.dbBytes + info.attachmentBytes)}</b> stored
            </span>
            <span className="muted">TCI Boards server {info.version}</span>
          </div>
          <p className="muted small">
            Everything lives in <code>{info.dataDir}</code> (the database plus attached files). A copy of the database is kept
            every day in its <code>backups</code> folder (last 14).
          </p>
          <div className="row gap-sm wrap">
            <a className="btn sm" href="/api/admin/backup" download>
              <Download size={14} /> Download a backup now
            </a>
            {info.backups[0] && <span className="muted small">Latest daily backup: {info.backups.find((b) => b.name.startsWith("zomello-2"))?.name ?? "none yet"}</span>}
          </div>
          {info.selfCert && <CertHint />}
        </section>
      )}

      <section className="panel">
        <h3>People</h3>
        <AddUser onAdded={refresh} />
        <ul className="admin-list">
          {users.map((u) => (
            <UserRow key={u.id} user={u} isMe={u.id === me?.id} act={act} />
          ))}
        </ul>
      </section>

      <section className="panel">
        <h3>Boards</h3>
        <p className="muted small">Every board on the server. Give a board to someone else, add or remove people, or delete it for everyone.</p>
        <ul className="admin-list">
          {boards.map((b) => (
            <li key={b.id} className="admin-board">
              <span className="board-dot" style={{ background: b.color }} />
              <div className="grow admin-main">
                <div className="row gap-sm wrap">
                  <b>{b.title}</b>
                  {b.archived && <span className="chip small">archived</span>}
                  <span className="muted small">
                    {b.cards} cards · changed {ago(b.updated)}
                  </span>
                </div>
                <div className="row gap-sm wrap admin-members">
                  <label className="small muted">
                    Owner{" "}
                    <select value={b.ownerId} onChange={(e) => void act(() => admin.setOwner(b.id, e.target.value), `“${b.title}” now belongs to ${name(e.target.value)}`)}>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {b.members
                    .filter((m) => m.role !== "owner")
                    .map((m) => (
                      <span key={m.userId} className="chip">
                        <Avatar name={m.displayName} size={16} /> {m.displayName}
                        <button
                          className="icon-btn tiny"
                          title={`Remove ${m.displayName} from this board`}
                          aria-label={`Remove ${m.displayName}`}
                          onClick={() => void act(() => admin.removeMember(b.id, m.userId), `Removed ${m.displayName} from “${b.title}”`)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  <select
                    className="add-member"
                    value=""
                    onChange={(e) => e.target.value && void act(() => admin.addMember(b.id, e.target.value), `Added ${name(e.target.value)} to “${b.title}”`)}
                  >
                    <option value="">+ Add someone…</option>
                    {users
                      .filter((u) => !b.members.some((m) => m.userId === u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <button
                className="icon-btn danger"
                title="Delete this board for everyone"
                aria-label="Delete board"
                onClick={async () => {
                  if (await ask(`Delete “${b.title}” and its ${b.cards} cards for everyone? This can't be undone (daily backups are kept).`, { okText: "Delete board", danger: true }))
                    void act(() => admin.deleteBoard(b.id), `Deleted “${b.title}”`);
                }}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
          {boards.length === 0 && <li className="muted small">No boards yet.</li>}
        </ul>
      </section>
    </div>
  );
}

function UserRow({ user: u, isMe, act }: { user: AdminUser; isMe: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [resetting, setResetting] = useState<string | null>(null);
  return (
    <li className={`admin-user ${u.disabled ? "off" : ""}`}>
      <Avatar name={u.displayName} size={30} />
      <div className="grow admin-main">
        <div className="row gap-sm wrap">
          <InlineEdit value={u.displayName} onSave={(displayName) => void act(() => admin.updateUser(u.id, { displayName }), "Renamed")} />
          <span className="muted small">@{u.username}</span>
          {u.isAdmin && <span className="chip small accent">Admin</span>}
          {u.disabled && <span className="chip small">Turned off</span>}
          {isMe && <span className="muted small">(you)</span>}
        </div>
        <span className="muted small">
          On {u.boards} board{u.boards === 1 ? "" : "s"} ({u.ownedBoards} their own) ·{" "}
          {u.lastLogin ? `last signed in ${ago(u.lastLogin)}` : "hasn't signed in yet"}
        </span>
        {resetting !== null && (
          <form
            className="row gap-sm wrap admin-reset"
            onSubmit={(e) => {
              e.preventDefault();
              const pw = resetting;
              void act(() => admin.updateUser(u.id, { password: pw }), `New password set for ${u.displayName}`).then(() => {
                void copyText(signInDetails(u.displayName, u.username, pw));
                setResetting(null);
              });
            }}
          >
            <input value={resetting} onChange={(e) => setResetting(e.target.value)} />
            <button type="button" className="btn sm ghost" onClick={() => setResetting(tempPassword())}>
              New suggestion
            </button>
            <button className="btn sm primary" disabled={resetting.length < 8}>
              Set password &amp; copy sign-in
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setResetting(null)}>
              Cancel
            </button>
          </form>
        )}
      </div>
      <div className="row gap-xs admin-actions">
        <button className="icon-btn" title="Set a new password" aria-label="Set a new password" onClick={() => setResetting(tempPassword())}>
          <KeyRound size={15} />
        </button>
        {!isMe && (
          <>
            <button
              className="icon-btn"
              title={u.isAdmin ? "Remove admin rights" : "Make admin"}
              aria-label={u.isAdmin ? "Remove admin rights" : "Make admin"}
              onClick={() => void act(() => admin.updateUser(u.id, { isAdmin: !u.isAdmin }), u.isAdmin ? `${u.displayName} is no longer an admin` : `${u.displayName} is now an admin`)}
            >
              {u.isAdmin ? <ShieldOff size={15} /> : <Shield size={15} />}
            </button>
            <button
              className="icon-btn"
              title={u.disabled ? "Turn this account back on" : "Turn this account off (they're signed out and can't sign in)"}
              aria-label={u.disabled ? "Turn account on" : "Turn account off"}
              onClick={() => void act(() => admin.updateUser(u.id, { disabled: !u.disabled }), u.disabled ? `${u.displayName} can sign in again` : `${u.displayName} is turned off`)}
            >
              {u.disabled ? <UserCheck size={15} /> : <UserX size={15} />}
            </button>
            <button
              className="icon-btn danger"
              title="Delete this account"
              aria-label="Delete account"
              onClick={async () => {
                if (
                  await ask(
                    `Delete ${u.displayName}'s account? ${u.ownedBoards ? `Their ${u.ownedBoards} board${u.ownedBoards === 1 ? "" : "s"} become yours, so nobody loses shared work.` : ""} This can't be undone.`,
                    { okText: "Delete account", danger: true },
                  )
                )
                  void act(() => admin.deleteUser(u.id), `Deleted ${u.displayName}'s account`);
              }}
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function AddUser({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(tempPassword);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  if (created)
    return (
      <div className="admin-created">
        <p>
          <b>Account created.</b> Give them these sign-in details (they can change the password in Settings):
        </p>
        <pre>{created}</pre>
        <div className="row gap-sm">
          <button className="btn sm primary" onClick={() => void copyText(created)}>
            <Copy size={14} /> Copy
          </button>
          <button className="btn sm ghost" onClick={() => setCreated(null)}>
            Done
          </button>
        </div>
      </div>
    );

  if (!open)
    return (
      <button className="btn sm" onClick={() => setOpen(true)}>
        <UserPlus size={14} /> Add a person
      </button>
    );

  return (
    <form
      className="admin-add"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          await admin.createUser({ username, displayName: name || username, password, isAdmin });
          setCreated(signInDetails(name || username, username.trim().toLowerCase(), password));
          setOpen(false);
          setName("");
          setUsername("");
          setPassword(tempPassword());
          setIsAdmin(false);
          await onAdded();
        } catch (er) {
          setError(String(er instanceof Error ? er.message : er));
        }
      }}
    >
      <label>
        Name
        <input autoFocus placeholder="Alex Rivera" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Username
        <input autoCapitalize="none" spellCheck={false} placeholder="alex" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <span className="row gap-sm">
          <input value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="icon-btn" title="Suggest another" aria-label="Suggest another password" onClick={() => setPassword(tempPassword())}>
            <RefreshCw size={14} />
          </button>
        </span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Admin (can manage people and boards)
      </label>
      {error && <p className="small danger-text">{error}</p>}
      <div className="row gap-sm">
        <button className="btn sm primary" disabled={!username.trim() || password.length < 8}>
          <Plus size={14} /> Create account
        </button>
        <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
