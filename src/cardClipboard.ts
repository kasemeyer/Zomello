import type { Card, ID } from "./types";
import { applyReply, exportMarkdown, parseReply, type AiCard } from "./ai";
import { PRIORITIES, PROGRESS } from "./utils";
import { inTauri } from "./storage";
import { useStore } from "./store";
import { copyText } from "./components/Markdown";

/**
 * Copying cards and pasting them into any board, on any device: the copy is readable Markdown (the
 * same as the AI export), and "Paste cards" reads it back with labels, dates, checklists and people.
 * A plain list from anywhere (notes, an email) works too: each line becomes a card.
 */

/** Copy cards as text that "Paste cards" (here or on another device) turns back into cards. */
export function copyCards(boardId: ID, cards: Card[], heading: string) {
  if (!cards.length) return useStore.getState().toast("No cards to copy");
  const n = cards.length;
  void copyText(exportMarkdown(boardId, cards, { heading, notes: false }), `Copied ${n} ${n === 1 ? "card" : "cards"}. Use Paste cards in any board to add ${n === 1 ? "it" : "them"}.`);
}

/** The clipboard's text, if this device lets us read it (otherwise the person pastes it in). */
export async function readClipboard(): Promise<string> {
  try {
    if (inTauri) {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return (await readText()) ?? "";
    }
    return (await navigator.clipboard?.readText()) ?? "";
  } catch {
    return "";
  }
}

const progressByName = new Map(PROGRESS.map((p) => [p.name.toLowerCase(), p.id]));
const priorityByName = new Map(PRIORITIES.map((p) => [p.name.toLowerCase(), p.id]));

/** Cards copied from TCI Boards ("### Title" headings with a details line under each). */
function parseCopiedCards(text: string): AiCard[] {
  const cards: AiCard[] = [];
  let card: AiCard | null = null;
  let part: "desc" | "checklist" | "skip" = "desc";
  let desc: string[] = [];
  const finish = () => {
    if (card) card.description = desc.join("\n").trim() || undefined;
    desc = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^###\s+(?:\d+\.\s+)?(.+)$/);
    if (head) {
      finish();
      card = { title: head[1].trim() };
      cards.push(card);
      part = "desc";
      continue;
    }
    if (!card) continue;
    if (/^#{1,2}\s/.test(line)) {
      // A bucket heading (or the end of the cards in a work order).
      finish();
      card = null;
      continue;
    }
    const meta = line.match(/^_(.+)_$/);
    if (meta && !card.labels && desc.length === 0) {
      for (const bit of meta[1].split(" · ")) {
        const b = bit.trim();
        const kv = b.match(/^(priority|labels|assigned):\s*(.*)$/i) ?? b.match(/^(start|due|estimate)\s+(.*)$/i);
        const v = kv?.[2].trim() ?? "";
        const key = kv?.[1].toLowerCase();
        if (progressByName.has(b.toLowerCase())) card.progress = progressByName.get(b.toLowerCase());
        else if (key === "priority") card.priority = priorityByName.get(v.toLowerCase());
        else if (key === "start") card.start = v;
        else if (key === "due") card.due = v;
        else if (key === "labels") card.labels = v.split(/,\s*/).filter(Boolean);
        else if (key === "assigned") card.assignees = v.split(/,\s*/).filter(Boolean);
        else if (key === "estimate") card.estimate = v;
      }
      card.labels ??= [];
      continue;
    }
    if (line === "Checklist:") {
      part = "checklist";
      continue;
    }
    if (line === "Notes:" || line.startsWith("Links: ")) {
      part = "skip";
      continue;
    }
    if (part === "checklist") {
      const item = line.match(/^- \[([ xX])\]\s+(.+)$/);
      if (item) (card.checklist ??= []).push({ text: item[2], done: item[1] !== " " });
      continue;
    }
    if (part === "skip") continue;
    const field = line.match(/^- \*\*(.+?):\*\*\s+(.+)$/);
    if (field) {
      // Custom fields come back by name; sub-task and link lines only made sense on the old board.
      if (!/^(Sub-task of|Blocks|Blocked by|Related to)$/.test(field[1])) (card.fields ??= {})[field[1]] = field[2];
      continue;
    }
    desc.push(line);
  }
  finish();
  return cards;
}

/** Cards in pasted text: copied from TCI Boards, an AI reply, or a plain list. */
export function parsePastedCards(text: string): AiCard[] {
  if (/^###\s/m.test(text)) {
    const copied = parseCopiedCards(text);
    if (copied.length) return copied;
  }
  const reply = parseReply(text);
  if (reply.cards?.length) return reply.cards;
  if (reply.board) return reply.board.buckets.flatMap((b) => b.cards ?? []);
  throw new Error("There are no cards in that text.");
}

/** Add pasted cards to a bucket. Returns how many cards were made. */
export function pasteCards(cards: AiCard[], boardId: ID, listId: ID): number {
  return applyReply({ cards }, { boardId, listId }).created;
}
