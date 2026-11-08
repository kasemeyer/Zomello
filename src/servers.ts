import { goToPlace } from "./places";
import { invoke } from "@tauri-apps/api/core";
import { inTauri, isMobileApp, openExternal } from "./storage";
import type { ServerEntry } from "./types";

/**
 * TCI Boards servers inside the app, Plex style. The desktop app opens each server in its own window
 * (that server's web app, signed in with your account there); the phone and tablet apps and plain
 * browsers open it in the browser, where it can be installed as an app of its own.
 */
export interface ServerCheck {
  url: string;
  ok: boolean;
  version: string | null;
  setupNeeded: boolean;
  certProblem: boolean;
  error: string | null;
}

/** "zomello.example.com" → "https://zomello.example.com" (as the desktop app would save it). */
export function normalizeAddress(address: string): string {
  const a = address.trim().replace(/\/+$/, "");
  const u = new URL(a.includes("://") ? a : `https://${a}`);
  return u.origin;
}

export async function checkServer(address: string): Promise<ServerCheck> {
  if (inTauri) return invoke<ServerCheck>("check_server", { address });
  // A browser can't ask another site (no CORS on purpose), so it just takes the address.
  return { url: normalizeAddress(address), ok: true, version: null, setupNeeded: false, certProblem: false, error: null };
}

export interface FoundServer {
  name: string;
  url: string;
  version: string | null;
}

/** TCI Boards servers announcing themselves on this network (the app only; a browser can't listen). */
export async function findServers(): Promise<FoundServer[]> {
  if (!inTauri) return [];
  return invoke<FoundServer[]>("find_servers");
}

/** The app can look for servers on the network; a browser can't. */
export const canFindServers = inTauri;

export async function openServer(s: ServerEntry): Promise<void> {
  if (inTauri && !isMobileApp) return invoke("open_server_window", { id: s.id, address: s.url, name: s.name });
  // Phone app: https places open right in the app (encrypted); anything else goes to the browser.
  if (isMobileApp && s.url.startsWith("https://")) return goToPlace(s.url);
  return openExternal(s.url);
}

/** A friendly default name: the host without "www." and the port. */
export const nameFromUrl = (url: string) => new URL(url).hostname.replace(/^www\./, "");
export const NO_SERVERS: ServerEntry[] = [];
