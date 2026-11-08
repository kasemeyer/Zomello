import { invoke } from "@tauri-apps/api/core";
import { isRemote, remoteFileUrl, remoteLoad, remoteSave, remoteUpload } from "./remote";
import { fileUrl as serverFileUrl, isServer, loadData as serverLoad, upload as serverUpload } from "./server";

/** True when running inside the Tauri shell; false in a plain browser (vite dev). */
/**
 * The app's own page has Tauri's bridge. So may a computer's or server's page shown inside the phone app,
 * but that page isn't the app (its boards live elsewhere), so it doesn't count as "in Tauri" here.
 */
export const hasAppBridge = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const inTauri = hasAppBridge() && !("__ZOMELLO_REMOTE__" in window) && !("__ZOMELLO_SERVER__" in window);

/**
 * On a page loaded from your computer or a server, Android adds the app's bridge a moment after the
 * page starts. Wait for it (briefly) before deciding we're not inside the app.
 */
export async function waitForAppBridge(ms = 3000): Promise<boolean> {
  for (let waited = 0; !hasAppBridge() && waited < ms; waited += 100) await new Promise((r) => setTimeout(r, 100));
  return hasAppBridge();
}

/** The Android / iPhone / iPad app (one window, no tray, no phone server). */
export const isMobileApp =
  inTauri &&
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** The Windows / macOS / Linux app: windows, tray, start at login, phone & tablet access. */
export const isDesktopApp = inTauri && !isMobileApp;

/** A phone or tablet (the app, or a browser on one): files go to the share sheet rather than a folder. */
export const isPhoneOrTablet =
  isMobileApp ||
  (typeof navigator !== "undefined" &&
    (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)));

/** iPhone or iPad (the app, or a browser on one). iPads say "Macintosh" but have a touch screen. */
export const isApplePhoneOrTablet =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** What the phone app calls the device it runs on: "This iPad", "Boards on this tablet", "Match my phone". */
export const deviceWord: "iPad" | "tablet" | "phone" =
  typeof navigator === "undefined"
    ? "phone"
    : /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(navigator.userAgent) && !/Mobile/.test(navigator.userAgent)
        ? "tablet"
        : "phone";

/**
 * Hand a file to the system share sheet (Messages, Mail, Files, AirDrop…) when there is one.
 * "later" means the browser wants a fresh tap first (preparing the file took a moment).
 */
/** Android app: its own Save dialog and share sheet (the app's browser has neither). */
interface AndroidFiles {
  saveFile?(base64: string, name: string): void;
  shareFile?(base64: string, name: string): void;
  setAppIcon?(style: string): void;
}
const androidFiles = () => (window as unknown as { ZomelloAndroid?: AndroidFiles }).ZomelloAndroid;
export const canSaveOnAndroid = () => !!androidFiles()?.saveFile;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Android app: the system's Save dialog. Resolves "saved", "cancelled" or "failed". */
export function saveOnAndroid(bytes: Uint8Array, name: string): Promise<"saved" | "cancelled" | "failed"> {
  return new Promise((resolve) => {
    const on = (e: Event) => {
      window.removeEventListener("zomello-file-saved", on);
      resolve((e as CustomEvent<"saved" | "cancelled" | "failed">).detail);
    };
    window.addEventListener("zomello-file-saved", on);
    androidFiles()!.saveFile!(toBase64(bytes), name);
  });
}

/**
 * The app icon of a style ("classic", "bassdrop", "partycat"): Android switches its launcher icon, iPhone/iPad
 * their alternate icon, computers the window and tray icon (see app_icon.rs).
 */
export async function setAppIcon(style: string): Promise<void> {
  const android = androidFiles();
  if (android?.setAppIcon) return android.setAppIcon(style);
  if (!inTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_app_icon", { style }).catch(() => {});
}

/** Android app: hand a file to another app (email, chat, Drive…). */
export const shareOnAndroid = (bytes: Uint8Array, name: string) => androidFiles()?.shareFile?.(toBase64(bytes), name);

export async function shareFile(file: File): Promise<"shared" | "unsupported" | "later"> {
  if (!navigator.canShare?.({ files: [file] })) return "unsupported";
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotAllowedError") return "later";
    if (!(e instanceof DOMException && e.name === "AbortError")) throw e; // AbortError: closed the sheet
  }
  return "shared";
}

const LS_KEY = "zomello-data";
const LEGACY_LS_KEY = "planwise-data";

export async function loadRaw(): Promise<string | null> {
  // This computer's window onto a phone's boards.
  if (new URLSearchParams(location.search).has("device")) return (await import("./deviceWindow")).loadDeviceData();
  if (isServer) return serverLoad();
  if (isRemote) return remoteLoad();
  if (inTauri) {
    return (await invoke<string | null>("load_data")) ?? null;
  }
  try {
    return localStorage.getItem(LS_KEY) ?? localStorage.getItem(LEGACY_LS_KEY);
  } catch {
    return null;
  }
}

export async function saveRaw(json: string): Promise<void> {
  if (isRemote) return remoteSave(json);
  if (inTauri) return invoke("save_data", { data: json });
  try {
    localStorage.setItem(LS_KEY, json);
  } catch {
    /* storage unavailable: nothing else we can do in a browser */
  }
}

/**
 * Returns the path written (desktop app), the downloaded file name (browser), or null when it went to
 * the share sheet on a phone or tablet (nothing more to say then).
 */
export async function exportFile(json: string, fileName: string, onShareLater?: (share: () => void) => void): Promise<string | null> {
  if (canSaveOnAndroid()) {
    const r = await saveOnAndroid(new TextEncoder().encode(json), fileName);
    if (r === "failed") throw new Error("Android couldn't save the file there");
    return r === "saved" ? fileName : null;
  }
  if (isPhoneOrTablet) {
    const file = new File([json], fileName, { type: "application/json" });
    const r = await shareFile(file);
    if (r === "shared") return null;
    if (r === "later" && onShareLater) {
      onShareLater(() => void shareFile(file));
      return null;
    }
  }
  if (inTauri) return invoke<string>("export_data", { data: json, fileName });
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
  return fileName;
}

export interface BackupInfo {
  timestamp: number;
  size: number;
}

export async function listBackups(): Promise<BackupInfo[]> {
  return inTauri ? invoke<BackupInfo[]>("list_backups") : [];
}

export async function readBackup(timestamp: number): Promise<string> {
  return invoke<string>("read_backup", { timestamp });
}

export async function dataLocation(): Promise<string> {
  if (isServer) return "On your TCI Boards server (an admin can back it up from the Admin page)";
  if (isRemote) return "On your computer (this device is connected to it)";
  return inTauri ? invoke<string>("data_location") : "Browser localStorage (dev mode)";
}

/** file:///home/me/My%20File.jpg → /home/me/My File.jpg (Windows: file:///C:/x → C:/x). */
export function fileUrlToPath(u: string): string {
  const p = decodeURIComponent(u.replace(/^file:\/\/(localhost)?/i, ""));
  return /^\/[A-Za-z]:\//.test(p) ? p.slice(1) : p;
}

export async function openExternal(target: string): Promise<void> {
  if (/^file:/i.test(target)) target = fileUrlToPath(target);
  if (inTauri) {
    const { openUrl, openPath } = await import("@tauri-apps/plugin-opener");
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return openUrl(target);
    return openPath(target);
  }
  window.open(target, "_blank", "noopener");
}

// ---- Stored attachments ----

/** Copy a file into TCI Boards's storage. Returns the value to keep in `Attachment.url`. */
export async function storeFile(file: File): Promise<string> {
  if (isServer) return serverUpload(file);
  if (isRemote) return remoteUpload(file);
  if (inTauri) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return invoke<string>("save_attachment", bytes, { headers: { "x-name": encodeURIComponent(file.name) } });
  }
  // Browser dev mode: inline as a data URL.
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Copy a file into storage by its path (drops from a file manager only give us the path). */
export async function storeFromPath(path: string): Promise<{ rel: string; name: string; size: number }> {
  return invoke("store_file_from_path", { path });
}

/** Turn a dropped file path into a File (desktop app only). */
export async function fileFromPath(path: string): Promise<File> {
  const buf = await invoke<ArrayBuffer>("read_dropped_file", { path });
  return new File([buf], path.split(/[\\/]/).pop() || "file");
}

/** URL the webview can display for a stored file (images, previews). */
export function storedSrc(url: string): string {
  if (url.startsWith("data:")) return url;
  if (isServer) return /^[a-z]+:/i.test(url) ? url : serverFileUrl(url);
  if (isRemote) return /^[a-z]+:/i.test(url) ? url : remoteFileUrl(url);
  if (!inTauri) return url;
  // Served by the app itself (see `serve_attachment` in lib.rs); Windows' webview needs the http form.
  const path = url.split("/").map(encodeURIComponent).join("/");
  // `npm run app` serves the page from the Vite dev server, which can't load zfile:// — it serves them itself.
  if (location.protocol.startsWith("http") && location.port) return `/__zfile/${path}`;
  return isWindows ? `http://zfile.localhost/${path}` : `zfile://localhost/${path}`;
}

export const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

/** Open a stored file with the system's default app. */
export async function openStored(url: string): Promise<void> {
  if (!inTauri) return void window.open(storedSrc(url), "_blank", "noopener");
  const abs = await invoke<string>("attachment_abs_path", { rel: url });
  const { openPath } = await import("@tauri-apps/plugin-opener");
  return openPath(abs);
}

/** Delete stored files that nothing references any more. Returns how many were removed. */
export async function cleanupStoredFiles(referenced: Set<string>): Promise<number> {
  if (!inTauri) return 0;
  const all = await invoke<string[]>("list_attachments");
  const orphans = all.filter((p) => !referenced.has(p));
  for (const rel of orphans) await invoke("delete_attachment", { rel });
  return orphans.length;
}

// ---- Notifications ----
export async function notify(title: string, body: string): Promise<void> {
  if (isRemote) return; // reminders come from the computer
  if (inTauri) {
    const n = await import("@tauri-apps/plugin-notification");
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === "granted";
    // Android: TCI Boards's own status-bar icon (res/drawable/ic_stat_zomello.xml); other systems ignore it.
    if (ok) n.sendNotification({ title, body, ...(isMobileApp ? { icon: "ic_stat_zomello", iconColor: "#2580C3" } : {}) });
    return;
  }
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission === "granted") new Notification(title, { body });
}
