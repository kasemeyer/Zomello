import { useEffect, useState } from "react";
import { Crown, Eye, LogOut, Send, UserMinus, X } from "lucide-react";
import type { Board } from "../types";
import { useStore } from "../store";
import {
  cancelInvite, directory, invite, leaveBoard, me, removeMember, setMemberRole, sharing, transferBoard, type DirectoryUser, type Member,
} from "../server";
import { ask, Avatar, Modal } from "./ui";

type Sharing = Awaited<ReturnType<typeof sharing>>;

/** Zomello Server: who's on a board, inviting people, and leaving. */
export function ShareDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const [info, setInfo] = useState<Sharing | null>(null);
  const [people, setPeople] = useState<DirectoryUser[]>([]);
  const [username, setUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "viewer">("member");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const owner = info?.ownerId === me?.id;
  const canManage = owner || !!me?.isAdmin;

  const refresh = () =>
    sharing(board.id)
      .then(setInfo)
      .catch((e) => setMsg({ text: String(e instanceof Error ? e.message : e), error: true }));
  useEffect(() => {
    void refresh();
    void directory().then(setPeople).catch(() => {});
  }, [board.id]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ text: ok });
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), error: true });
    }
    await refresh();
  };

  const invitable = people.filter((p) => !info?.members.some((m) => m.userId === p.id) && !info?.pending.some((x) => x.userId === p.id));

  return (
    <Modal onClose={onClose} width={520} className="share">
      <header className="customize-head">
        <h2>Share “{board.title}”</h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body share-body">
        {canManage && (
          <form
            className="share-invite"
            onSubmit={(e) => {
              e.preventDefault();
              const u = username.trim();
              if (!u) return;
              void run(
                () => invite(board.id, u, inviteRole),
                `Invited ${people.find((p) => p.username === u.toLowerCase())?.displayName ?? u}${inviteRole === "viewer" ? " to look at this board" : ""}. They'll see it on their Home page.`,
              ).then(() => setUsername(""));
            }}
          >
            <input
              list="share-people"
              placeholder="Username to invite"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <datalist id="share-people">
              {invitable.map((p) => (
                <option key={p.id} value={p.username}>
                  {p.displayName}
                </option>
              ))}
            </datalist>
            <select
              value={inviteRole}
              title="What they can do on this board"
              aria-label="Role"
              onChange={(e) => setInviteRole(e.target.value as "member" | "viewer")}
            >
              <option value="member">Can edit</option>
              <option value="viewer">View only</option>
            </select>
            <button className="btn primary" disabled={!username.trim()}>
              <Send size={14} /> Invite
            </button>
          </form>
        )}
        {msg && <p className={`small ${msg.error ? "danger-text" : "ok-text"}`}>{msg.text}</p>}

        <h4>On this board</h4>
        <ul className="share-list">
          {info?.members.map((m: Member) => (
            <li key={m.userId}>
              <Avatar name={m.displayName} size={26} />
              <span className="grow">
                {m.displayName} <span className="muted small">@{m.username}</span>
                {m.userId === me?.id && <span className="muted small"> (you)</span>}
              </span>
              {m.role === "owner" ? (
                <span className="chip small">
                  <Crown size={12} /> Owner
                </span>
              ) : !canManage ? (
                m.role === "viewer" && (
                  <span className="chip small" title="They can look at this board but not change it">
                    <Eye size={12} /> View only
                  </span>
                )
              ) : (
                canManage && (
                  <>
                    <select
                      value={m.role}
                      title={`What ${m.displayName} can do on this board`}
                      aria-label={`Role of ${m.displayName}`}
                      onChange={(e) =>
                        void run(
                          () => setMemberRole(board.id, m.userId, e.target.value as "member" | "viewer"),
                          e.target.value === "viewer" ? `${m.displayName} can only look now` : `${m.displayName} can edit now`,
                        )
                      }
                    >
                      <option value="member">Can edit</option>
                      <option value="viewer">View only</option>
                    </select>
                    {owner && (
                      <button
                        className="btn sm ghost"
                        title={`Give the board to ${m.displayName} (you stay on it)`}
                        onClick={async () => {
                          if (await ask(`Make ${m.displayName} the owner of “${board.title}”? You'll stay on the board, but only they can invite people or delete it.`, { okText: "Make owner" }))
                            void run(() => transferBoard(board.id, m.userId), `${m.displayName} owns the board now`);
                        }}
                      >
                        <Crown size={13} /> Make owner
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title={`Remove ${m.displayName}`}
                      aria-label={`Remove ${m.displayName}`}
                      onClick={async () => {
                        if (await ask(`Remove ${m.displayName} from “${board.title}”? The board disappears for them.`, { okText: "Remove", danger: true }))
                          void run(() => removeMember(board.id, m.userId), `Removed ${m.displayName}`);
                      }}
                    >
                      <UserMinus size={15} />
                    </button>
                  </>
                )
              )}
            </li>
          ))}
        </ul>

        {!!info?.pending.length && (
          <>
            <h4>Invited</h4>
            <ul className="share-list">
              {info.pending.map((p) => (
                <li key={p.id}>
                  <Avatar name={p.displayName} size={26} />
                  <span className="grow">
                    {p.displayName} <span className="muted small">@{p.username} · waiting</span>
                  </span>
                  {canManage && (
                    <button className="btn sm ghost" onClick={() => void run(() => cancelInvite(p.id), "Invitation cancelled")}>
                      Cancel
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {info && !owner && info.members.some((m) => m.userId === me?.id) && (
          <button
            className="btn danger-outline"
            onClick={async () => {
              if (!(await ask(`Leave “${board.title}”? It disappears from your boards until someone invites you again.`, { okText: "Leave board", danger: true }))) return;
              try {
                await leaveBoard(board.id);
                onClose();
                useStore.getState().toast(`You left “${board.title}”`);
              } catch (e) {
                setMsg({ text: String(e instanceof Error ? e.message : e), error: true });
              }
            }}
          >
            <LogOut size={14} /> Leave this board
          </button>
        )}
        <p className="muted small">
          People who can edit may add, change and complete the board's cards; view-only people can just look. Only the owner
          can invite people, remove them, change what they can do, archive or delete the board.
        </p>
      </div>
    </Modal>
  );
}
