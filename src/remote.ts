/**
 * Running on a phone or tablet: the page is served by TCI Boards on the computer (see remote.rs), which marks
 * index.html with `__ZOMELLO_REMOTE__`. Data, live updates and files all go through its /api.
 */
export const isRemote = typeof window !== "undefined" && "__ZOMELLO_REMOTE__" in window;

/** Identifies this page's saves so the live feed doesn't echo them back. */
export const clientId = Math.random().toString(36).slice(2, 10);

/** Fired when the computer says this device isn't (or is no longer) paired. */
export const UNPAIRED_EVENT = "zomello:unpaired";

async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401) window.dispatchEvent(new Event(UNPAIRED_EVENT));
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `${res.status} ${res.statusText}`);
  return res;
}

export async function remoteStatus(): Promise<{ paired: boolean; name?: string }> {
  const res = await fetch("/api/status", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function remotePair(code: string, name: string): Promise<void> {
  await api("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }) });
}

export async function remoteLoad(): Promise<string | null> {
  const text = await (await api("/api/data")).text();
  return text || null;
}

export async function remoteSave(json: string): Promise<void> {
  await api("/api/data", { method: "PUT", headers: { "Content-Type": "application/json", "x-client": clientId }, body: json });
}

export async function remoteUpload(file: File): Promise<string> {
  const res = await api("/api/attachment", { method: "POST", headers: { "x-name": encodeURIComponent(file.name) }, body: file });
  return res.text();
}

export const remoteFileUrl = (rel: string) => `/api/file/${rel.split("/").map(encodeURIComponent).join("/")}`;

/** Connection state of the live feed, for the "Reconnecting…" banner. */
type Listener = (online: boolean) => void;
const listeners = new Set<Listener>();
let online = true;
export const onConnectionChange = (l: Listener) => (listeners.add(l), () => void listeners.delete(l));
const setOnline = (v: boolean) => {
  if (v === online) return;
  online = v;
  listeners.forEach((l) => l(v));
};

/** Live changes from the computer (and other devices). The first message on each connect is the current data. */
export function remoteSubscribe(onData: (json: string) => void): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const connect = () => {
    es = new EventSource("/api/events");
    es.onopen = () => setOnline(true);
    es.addEventListener("data", (e) => {
      const m = e as MessageEvent<string>;
      if (m.lastEventId !== clientId && m.data) onData(m.data);
    });
    es.onerror = () => {
      es?.close();
      setOnline(false);
      if (closed) return;
      // Unlinked? /api/status tells us (and the gate shows the pairing screen); otherwise keep retrying.
      remoteStatus()
        .then((s) => !s.paired && window.dispatchEvent(new Event(UNPAIRED_EVENT)))
        .catch(() => {});
      retry = setTimeout(connect, 3000);
    };
  };
  connect();
  // Phones pause the page in the background, dropping the connection. Coming back reconnects at once
  // instead of waiting for the next retry.
  const onVisible = () => {
    if (document.visibilityState !== "visible" || closed) return;
    if (es && es.readyState === EventSource.OPEN) return;
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

export const isIOS = () =>
  /iPad|iPhone/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Opened over plain http, but this device already trusts the computer's certificate? Then https works too. */
export async function httpsTrusted(): Promise<boolean> {
  return fetch(`https://${location.host}/api/status`, { mode: "no-cors", cache: "no-store" }).then(
    () => true,
    () => false,
  );
}

/** A friendly default name for this device. */
export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  return "Browser";
}
