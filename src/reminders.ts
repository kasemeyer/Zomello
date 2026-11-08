import { addDays } from "date-fns";
import { isServer } from "./server";
import { useStore } from "./store";
import { isApplePhoneOrTablet, isMobileApp, notify } from "./storage";
import type { AppData, Card } from "./types";
import { prettyDate, toISO, todayISO } from "./utils";

/**
 * Notifications:
 *  - a card's own reminder (date + time), once;
 *  - a daily digest of what's late / due today, once a day at the chosen time.
 * On a computer TCI Boards checks every 30 seconds while it runs. Sent reminders are remembered per-device so
 * restarts don't repeat them. The phone and tablet app hands them to the system ahead of time instead (see
 * `scheduleOnPhone`), so they arrive while TCI Boards is closed.
 */
const SENT_KEY = "zomello-reminders-sent";
const CHECK_EVERY_MS = 30_000;

function loadSent(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function saveSent(s: Set<string>) {
  try {
    // Keep the list from growing forever.
    localStorage.setItem(SENT_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* not critical */
  }
}

function localNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    dateTime: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Cards that can still remind: not done, not archived, on a board that's still there. */
function liveCards(data: AppData): Card[] {
  return Object.values(data.cards).filter(
    (c) => !c.archived && data.boards[c.boardId] && !data.boards[c.boardId].archived && c.progress !== "completed",
  );
}

function digestText(data: AppData, live: Card[], day: string): string | null {
  const me = data.settings.me;
  const relevant = live.filter((c) => !me || c.assignees.length === 0 || c.assignees.includes(me));
  const late = relevant.filter((c) => !!c.dueDate && c.dueDate < day).length;
  const today = relevant.filter((c) => c.dueDate === day).length;
  if (!late && !today) return null;
  const parts = [today && `${today} due today`, late && `${late} late`].filter(Boolean);
  return `${parts.join(", ")}. Open My Tasks to see them.`;
}

export function checkReminders() {
  const { data, loaded } = useStore.getState();
  if (!loaded || !data.settings.reminders.enabled) return;
  const sent = loadSent();
  const now = localNow();
  const live = liveCards(data);

  for (const c of live) {
    if (!c.reminder || c.reminder > now.dateTime) continue;
    const key = `r:${c.id}:${c.reminder}`;
    if (sent.has(key)) continue;
    sent.add(key);
    const board = data.boards[c.boardId].title;
    void notify(c.title, c.dueDate ? `${board} · due ${prettyDate(c.dueDate)}` : board);
  }

  const r = data.settings.reminders;
  const digestKey = `digest:${todayISO()}`;
  if (r.digest && now.time >= r.digestTime && !sent.has(digestKey)) {
    sent.add(digestKey);
    const text = digestText(data, live, todayISO());
    if (text) void notify("TCI Boards: your day", text);
  }
  saveSent(sent);
}

// ---- Phones and tablets: scheduled with the system ----
const SCHEDULED_KEY = "zomello-reminders-scheduled";
/** iPhone and iPad keep at most 64 waiting notifications per app; stay under that. */
const MAX_SCHEDULED = 50;
const DIGEST_DAYS = 7;

/** A stable 31-bit id for a notification, so the same reminder keeps the same id. */
function notificationId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) || 1;
}

/**
 * Hand the coming reminders to the system: each card's reminder, and the daily digest for the next week (counted
 * from the cards as they are now; opening TCI Boards recounts). Everything scheduled before is replaced.
 */
export async function scheduleOnPhone(data: AppData) {
  const n = await import("@tauri-apps/plugin-notification");
  let before: number[] = [];
  try {
    before = JSON.parse(localStorage.getItem(SCHEDULED_KEY) ?? "[]");
  } catch {
    /* start over */
  }
  if (before.length) await n.cancel(before).catch(() => {});

  const plan: { key: string; at: Date; title: string; body: string; cardId?: string }[] = [];
  const r = data.settings.reminders;
  const now = Date.now();
  if (r.enabled) {
    const live = liveCards(data);
    for (const c of live) {
      if (!c.reminder) continue;
      const at = new Date(c.reminder);
      if (isNaN(+at) || +at <= now) continue;
      const board = data.boards[c.boardId].title;
      plan.push({ key: `r:${c.id}:${c.reminder}`, at, title: c.title, body: c.dueDate ? `${board} · due ${prettyDate(c.dueDate)}` : board, cardId: c.id });
    }
    if (r.digest) {
      const [hh, mm] = r.digestTime.split(":").map(Number);
      for (let i = 0; i < DIGEST_DAYS; i++) {
        const d = addDays(new Date(), i);
        d.setHours(hh || 0, mm || 0, 0, 0);
        if (+d <= now) continue;
        const text = digestText(data, live, toISO(d));
        if (text) plan.push({ key: `digest:${toISO(d)}`, at: d, title: "TCI Boards: your day", body: text });
      }
    }
  }
  plan.sort((a, b) => +a.at - +b.at);
  await registerActions(n);
  const ids: number[] = [];
  if (plan.length) {
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === "granted";
    if (ok) {
      for (const p of plan.slice(0, MAX_SCHEDULED)) {
        const id = notificationId(p.key);
        // iPhone/iPad can't read the time stamp the plugin sends with Schedule.at, so name the local date and time
        // there instead (with the year, it fires only once).
        const d = p.at;
        const schedule = isApplePhoneOrTablet
          ? n.Schedule.interval({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: 0 })
          : n.Schedule.at(d, false, true);
        n.sendNotification({
          id,
          title: p.title,
          body: p.body,
          schedule,
          icon: "ic_stat_zomello",
          iconColor: "#2580C3",
          // A card's reminder gets Done and Snooze buttons (see handleAction).
          ...(p.cardId ? { actionTypeId: ACTIONS, extra: { cardId: p.cardId } } : {}),
        });
        ids.push(id);
      }
    }
  }
  try {
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify(ids));
  } catch {
    /* not critical */
  }
}

// ---- Done and Snooze on a reminder (phones and tablets) ----
const ACTIONS = "zomello-reminder";
let registered = false;

async function registerActions(n: typeof import("@tauri-apps/plugin-notification")) {
  if (registered) return;
  registered = true;
  await n
    .registerActionTypes([
      {
        id: ACTIONS,
        actions: [
          { id: "done", title: "Done", foreground: true },
          { id: "snooze", title: "Snooze 1 hour", foreground: true },
        ],
      },
    ])
    .catch(() => (registered = false));
}

const SNOOZE_MS = 3600e3;

/** A reminder's button, or the reminder itself, was tapped. */
function handleAction(actionId: string, notification: unknown) {
  const raw = typeof notification === "string" ? safeJson(notification) : notification;
  const cardId = (raw as { extra?: { cardId?: string } } | null)?.extra?.cardId;
  const st = useStore.getState();
  const card = cardId ? st.data.cards[cardId] : undefined;
  if (!card) return;
  if (actionId === "done") {
    st.updateCard(card.id, { progress: "completed" });
    st.toast(`Marked “${card.title}” done`, { undo: true });
  } else if (actionId === "snooze") {
    const at = new Date(Date.now() + SNOOZE_MS);
    const pad = (x: number) => String(x).padStart(2, "0");
    const reminder = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
    st.updateCard(card.id, { reminder });
    st.toast(`Reminding you about “${card.title}” again at ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`, { undo: true });
  } else {
    // The reminder itself: open its card.
    st.openCard(card.id);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Listen for reminder actions: on Android through TCI Boards's own activity (so one that opened the app isn't missed), elsewhere the plugin. */
function installActions(): () => void {
  const android = (window as unknown as { ZomelloAndroid?: { takeNotificationAction?(): string | null } }).ZomelloAndroid;
  if (android?.takeNotificationAction) {
    const take = () => {
      const a = safeJson(android.takeNotificationAction!() ?? "") as { action?: string; notification?: string } | null;
      if (a?.action) handleAction(a.action, a.notification);
    };
    take();
    window.addEventListener("zomello-notification-action", take);
    return () => window.removeEventListener("zomello-notification-action", take);
  }
  let un: (() => void) | undefined;
  let gone = false;
  void import("@tauri-apps/plugin-notification").then(async (n) => {
    const l = await n.onAction((e) => handleAction(e.actionId, e.notification)).catch(() => null);
    if (gone) void l?.unregister();
    else un = () => void l?.unregister();
  });
  return () => {
    gone = true;
    un?.();
  };
}

export function startReminders() {
  // The phone's own boards (not a server opened in the app): let the system deliver them.
  if (isMobileApp && !isServer) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => (clearTimeout(timer), (timer = setTimeout(() => void scheduleOnPhone(useStore.getState().data).catch(() => {}), 2000)));
    later();
    const unsub = useStore.subscribe((s, prev) => {
      if (s.data !== prev.data) later();
    });
    const offActions = installActions();
    return () => (clearTimeout(timer), unsub(), offActions());
  }
  checkReminders();
  const t = setInterval(checkReminders, CHECK_EVERY_MS);
  return () => clearInterval(t);
}
