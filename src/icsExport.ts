import { format } from "date-fns";
import { saveBoardFile, SHARE_LATER } from "./boardFile";
import { isDesktopApp } from "./storage";
import { useStore } from "./store";
import type { AppData, ID } from "./types";
import { cardSpan } from "./utils";

/**
 * A calendar file (.ics) of your dated cards, to import into Google Calendar, Outlook or Apple Calendar.
 * It's a snapshot: for dates that keep up to date, a TCI Boards server has a calendar link (feed.rs), with the
 * same events.
 */

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines of at most 75 bytes; longer ones go on with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  let out = "";
  let len = 0;
  for (const ch of line) {
    const w = bytes.encode(ch).length;
    if (len + w > 75) {
      out += "\r\n ";
      len = 1;
    }
    out += ch;
    len += w;
  }
  return `${out}\r\n`;
}

const local = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");
const day = (d: Date) => format(d, "yyyyMMdd");

/**
 * Every dated card that isn't done or archived (on one board, or all). All boards leaves out private ones,
 * since a calendar file ends up in Google Calendar or someone's inbox; a private board's own menu includes it.
 */
export function calendarFile(data: AppData, boardId?: ID): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  let out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ZomBeatz Media//TCI Boards//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(boardId ? data.boards[boardId]?.title ?? "TCI Boards" : "TCI Boards")}`].map(fold).join("");
  for (const c of Object.values(data.cards)) {
    const b = data.boards[c.boardId];
    const l = data.lists[c.listId];
    if (!b || b.archived || c.archived || l?.archived || c.progress === "completed" || (boardId ? c.boardId !== boardId : b.private)) continue;
    const s = cardSpan(c);
    if (!s) continue;
    const where = `${b.title} › ${l?.title ?? ""}`;
    const desc = c.description ? `${where}\n\n${c.description.slice(0, 800)}` : where;
    out += [
      "BEGIN:VEVENT",
      `UID:${c.id}@zomello`,
      `DTSTAMP:${stamp}`,
      s.allDay ? `DTSTART;VALUE=DATE:${day(s.start)}` : `DTSTART:${local(s.start)}`,
      s.allDay ? `DTEND;VALUE=DATE:${day(s.end)}` : `DTEND:${local(s.end)}`,
      `SUMMARY:${esc(c.title)}`,
      `DESCRIPTION:${esc(desc)}`,
      `CATEGORIES:${esc(b.title)}`,
      "END:VEVENT",
    ]
      .map(fold)
      .join("");
  }
  return out + fold("END:VCALENDAR");
}

/** Board menu / Settings: save the calendar file (Downloads, the share sheet, or a download). */
export async function exportCalendarFile(boardId?: ID): Promise<void> {
  const st = useStore.getState();
  const text = calendarFile(st.data, boardId);
  const n = (text.match(/BEGIN:VEVENT/g) ?? []).length;
  if (!n) return st.toast(boardId ? "No dated cards on this board to put in a calendar" : "No dated cards to put in a calendar");
  const title = boardId ? st.data.boards[boardId].title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Board" : "TCI Boards";
  try {
    const where = await saveBoardFile(new TextEncoder().encode(text), `${title} dates.ics`, "text/calendar");
    if (where === SHARE_LATER || !where) return;
    st.toast(
      `Saved ${n} ${n === 1 ? "date" : "dates"}${isDesktopApp ? ` to ${where}` : ""}. Import the file in your calendar app (in Google Calendar: Settings > Import).`,
      { key: "ics" },
    );
  } catch (e) {
    st.toast(`Couldn't save the calendar file: ${e instanceof Error ? e.message : e}`);
  }
}
