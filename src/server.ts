import type { AppData, Board, Card, ID, List } from "./types";

/**
 * Talking to a Zomello Server (several people, accounts, shared boards). The server marks its page
 * with `__ZOMELLO_SERVER__`. Instead of saving one big file, the app sends what changed (boards,
 * buckets, cards, and your own settings) and merges other people's changes as they happen.
 */
export const isServer = typeof window !== "undefined" && "__ZOMELLO_SERVER__" in window;

/** Identifies this tab, so its own changes don't come back to it. */
export const clientId = Math.random().toString(36).slice(2, 10);

export interface SessionUser {
  id: ID;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

/** Your private calendar link (feed.rs): whether you have one, make a new one, or turn it off. */
export const calendarLink = {
  status: () => api<{ on: boolean; created: number | null }>("/api/me/calendar-link"),
  create: () => api<{ path: string }>("/api/me/calendar-link", { method: "POST", json: {} }),
  remove: () => api("/api/me/calendar-link", { method: "DELETE" }),
};

/** Who's signed in (set by the sign-in gate). */
export let me: SessionUser | null = null;
export const setMe = (u: SessionUser | null) => void (me = u);

export const SIGNED_OUT_EVENT = "zomello:signed-out";

async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/me/password")) {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? (text || `${res.status}`));
  return body as T;
}

// ---- Accounts ----

export const getSession = () => api<{ user: SessionUser | null; setupNeeded: boolean; selfCert?: boolean; version: string }>("/api/session");
export const setup = (username: string, displayName: string, password: string) =>
  api("/api/setup", { method: "POST", json: { username, displayName, password } });
export const login = (username: string, password: string) => api("/api/login", { method: "POST", json: { username, password } });
export const logout = () => api("/api/logout", { method: "POST" });
export const changePassword = (current: string, next: string) => api("/api/me/password", { method: "POST", json: { current, next } });
export const updateProfile = (displayName: string) => api("/api/me/profile", { method: "POST", json: { displayName } });

export interface DirectoryUser {
  id: ID;
  username: string;
  displayName: string;
}
export const directory = () => api<DirectoryUser[]>("/api/users");

// ---- Sharing ----

export interface Member {
  userId: ID;
  displayName: string;
  username: string;
  role: "owner" | "member" | "viewer";
}
export type MemberRole = Member["role"];
export interface Invite {
  id: ID;
  boardId: ID;
  boardTitle: string;
  from: string;
  created: number;
}
export const sharing = (boardId: ID) =>
  api<{ ownerId: ID; members: Member[]; pending: { id: ID; userId: ID; displayName: string; username: string; role: MemberRole }[] }>(`/api/boards/${boardId}/sharing`);
export const invite = (boardId: ID, username: string, role: "member" | "viewer" = "member") =>
  api(`/api/boards/${boardId}/invite`, { method: "POST", json: { username, role } });
export const cancelInvite = (id: ID) => api(`/api/invites/${id}`, { method: "DELETE" });
export const removeMember = (boardId: ID, userId: ID) => api(`/api/boards/${boardId}/members/${userId}`, { method: "DELETE" });
export const setMemberRole = (boardId: ID, userId: ID, role: "member" | "viewer") =>
  api(`/api/boards/${boardId}/members/${userId}`, { method: "PATCH", json: { role } });
export const leaveBoard = (boardId: ID) => api(`/api/boards/${boardId}/leave`, { method: "POST" });
export const transferBoard = (boardId: ID, userId: ID) => api(`/api/boards/${boardId}/transfer`, { method: "POST", json: { userId } });
export const myInvites = () => api<Invite[]>("/api/invites");
export const answerInvite = (id: ID, answer: "accept" | "decline") => api(`/api/invites/${id}/${answer}`, { method: "POST" });

/** Is this board yours (as opposed to shared with you)? Everything is yours outside server mode. */
export const ownsBoard = (b: Board) => !isServer || !b.ownerId || b.ownerId === me?.id;

/** Can you change this board, or only look at it? Everything is editable outside server mode. */
export const canEditBoard = (b: Board | undefined): boolean =>
  !isServer || !b?.members || b.members.find((m) => m.userId === me?.id)?.role !== "viewer";

// ---- Admin ----

export interface AdminUser extends DirectoryUser {
  isAdmin: boolean;
  disabled: boolean;
  created: number;
  lastLogin: number | null;
  boards: number;
  ownedBoards: number;
}
export interface AdminBoard {
  id: ID;
  title: string;
  color: string;
  archived: boolean;
  ownerId: ID;
  members: Member[];
  cards: number;
  updated: number;
}
export const admin = {
  users: () => api<AdminUser[]>("/api/admin/users"),
  createUser: (u: { username: string; displayName: string; password: string; isAdmin: boolean }) => api("/api/admin/users", { method: "POST", json: u }),
  updateUser: (id: ID, patch: Partial<{ displayName: string; isAdmin: boolean; disabled: boolean; password: string }>) =>
    api(`/api/admin/users/${id}`, { method: "PATCH", json: patch }),
  deleteUser: (id: ID) => api<{ boardsMovedToYou: number }>(`/api/admin/users/${id}`, { method: "DELETE" }),
  boards: () => api<AdminBoard[]>("/api/admin/boards"),
  setOwner: (id: ID, ownerId: ID) => api(`/api/admin/boards/${id}`, { method: "PATCH", json: { ownerId } }),
  addMember: (id: ID, userId: ID) => api(`/api/admin/boards/${id}/members`, { method: "POST", json: { userId } }),
  removeMember: (id: ID, userId: ID) => api(`/api/boards/${id}/members/${userId}`, { method: "DELETE" }),
  deleteBoard: (id: ID) => api(`/api/admin/boards/${id}`, { method: "DELETE" }),
  info: () =>
    api<{
      version: string;
      users: number;
      boards: number;
      cards: number;
      sessions: number;
      dataDir: string;
      dbBytes: number;
      attachmentBytes: number;
      backups: { name: string; bytes: number }[];
      publicUrl: string | null;
      selfCert?: boolean;
    }>("/api/admin/info"),
};

// ---- Data & sync ----

export async function loadData(): Promise<string> {
  const res = await fetch("/api/data", { credentials: "same-origin" });
  if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  if (!res.ok) throw new Error(`Couldn't load your boards (${res.status})`);
  return res.text();
}

type Kind = "boards" | "lists" | "cards";
const KINDS: Kind[] = ["boards", "lists", "cards"];
type Entity = Board | List | Card;

export interface Ops {
  upserts: Partial<Record<Kind, Entity[]>>;
  deletes: Partial<Record<Kind, ID[]>>;
}

/** The data as the server last had it (what this tab's changes are measured against). */
let base: AppData | null = null;
export const setBase = (d: AppData) => void (base = d);
export const getBase = () => base;

/** Your own part: settings, per-board view state, templates, saved filters. */
const userDoc = (d: AppData) => ({ settings: d.settings, ui: d.ui, templates: d.templates, boardTemplates: d.boardTemplates, savedFilters: d.savedFilters });

/** What changed since the server last heard from us. Data is immutable, so a changed object is a new object. */
export function diff(prev: AppData, next: AppData) {
  const upserts: Partial<Record<Kind, Entity[]>> = {};
  const deletes: Partial<Record<Kind, ID[]>> = {};
  let any = false;
  for (const k of KINDS) {
    const a = prev[k] as Record<ID, Entity>;
    const b = next[k] as Record<ID, Entity>;
    if (a === b) continue;
    for (const id in b) if (a[id] !== b[id]) ((upserts[k] ??= []).push(b[id]), (any = true));
    for (const id in a) if (!(id in b)) ((deletes[k] ??= []).push(id), (any = true));
  }
  const userChanged =
    prev.settings !== next.settings || prev.ui !== next.ui || prev.templates !== next.templates || prev.boardTemplates !== next.boardTemplates || prev.savedFilters !== next.savedFilters;
  return any || userChanged ? { upserts, deletes, user: userChanged ? userDoc(next) : undefined } : null;
}

export const RELOAD_EVENT = "zomello:reload";

/** Send what changed. Things the server refused (e.g. a board unshared a moment ago) trigger a reload. */
export async function pushChanges(next: AppData): Promise<void> {
  if (!base) return void (base = next);
  const changes = diff(base, next);
  if (!changes) return;
  const res = await api<{ rejected: unknown[] }>("/api/sync", { method: "POST", json: { client: clientId, ...changes } });
  // Other people's changes may have arrived while this was in flight: put ours on top of them.
  base = rebaseSnapshot(base!, changes);
  if (changes.user) base = { ...base, settings: next.settings, ui: next.ui, templates: next.templates, boardTemplates: next.boardTemplates, savedFilters: next.savedFilters };
  if (res.rejected?.length) window.dispatchEvent(new Event(RELOAD_EVENT));
}

/**
 * Merge changes from other people into `data` (and into `base`). Something this tab changed but hasn't
 * sent yet stays as it is here; it goes out next and wins.
 */
export function mergeOps(data: AppData, ops: Ops): AppData {
  const b = base ?? data;
  const nextData: AppData = { ...data };
  const nextBase: AppData = { ...b };
  for (const k of KINDS) {
    const ups = ops.upserts[k] ?? [];
    const dels = ops.deletes[k] ?? [];
    if (!ups.length && !dels.length) continue;
    const d = { ...(data[k] as Record<ID, Entity>) };
    const bb = { ...(b[k] as Record<ID, Entity>) };
    for (const e of ups) {
      const untouched = (data[k] as Record<ID, Entity>)[e.id] === (b[k] as Record<ID, Entity>)[e.id];
      if (untouched) d[e.id] = e;
      bb[e.id] = e;
    }
    for (const id of dels) {
      const untouched = (data[k] as Record<ID, Entity>)[id] === (b[k] as Record<ID, Entity>)[id];
      if (untouched) delete d[id];
      delete bb[id];
    }
    (nextData as unknown as Record<Kind, unknown>)[k] = d;
    (nextBase as unknown as Record<Kind, unknown>)[k] = bb;
  }
  base = nextBase;
  return nextData;
}

/** Apply the same remote changes to an undo snapshot, so Undo never brings back someone else's old version. */
export function rebaseSnapshot(snap: AppData, ops: Ops): AppData {
  const out: AppData = { ...snap };
  for (const k of KINDS) {
    const ups = ops.upserts[k] ?? [];
    const dels = ops.deletes[k] ?? [];
    if (!ups.length && !dels.length) continue;
    const m = { ...(snap[k] as Record<ID, Entity>) };
    for (const e of ups) m[e.id] = e;
    for (const id of dels) delete m[id];
    (out as unknown as Record<Kind, unknown>)[k] = m;
  }
  return out;
}

// ---- Live updates ----

type Listener = (online: boolean) => void;
const listeners = new Set<Listener>();
let online = true;
export const onServerConnection = (l: Listener) => (listeners.add(l), () => void listeners.delete(l));
const setOnline = (v: boolean) => {
  if (v === online) return;
  online = v;
  listeners.forEach((l) => l(v));
};

export function subscribe(handlers: {
  ops: (ops: Ops) => void;
  user: (doc: ReturnType<typeof userDoc>) => void;
  reload: () => void;
  invites: () => void;
}): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let first = true;
  const connect = () => {
    es = new EventSource(`/api/events?client=${clientId}`);
    es.addEventListener("hello", () => {
      setOnline(true);
      // Reconnected after a gap: catch up on anything missed.
      if (!first) handlers.reload();
      first = false;
      handlers.invites();
    });
    es.addEventListener("ops", (e) => handlers.ops(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("user", (e) => handlers.user(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("reload", () => handlers.reload());
    es.addEventListener("invites", () => handlers.invites());
    es.onerror = () => {
      es?.close();
      setOnline(false);
      if (closed) return;
      void getSession()
        .then((s) => !s.user && window.dispatchEvent(new Event(SIGNED_OUT_EVENT)))
        .catch(() => {});
      retry = setTimeout(connect, 3000);
    };
  };
  connect();
  const onVisible = () => {
    if (document.visibilityState !== "visible" || closed || (es && es.readyState === EventSource.OPEN)) return;
    clearTimeout(retry);
    es?.close();
    connect();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  return () => {
    closed = true;
    clearTimeout(retry);
    es?.close();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
  };
}

// ---- Files ----

export async function upload(file: File): Promise<string> {
  const res = await fetch("/api/attachment", {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-name": encodeURIComponent(file.name) },
    body: file,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}
export const fileUrl = (rel: string) => `/api/file/${rel.split("/").map(encodeURIComponent).join("/")}`;
