/**
 * AI hand-off: TCI Boards never talks to an AI itself. These helpers build prompts / exports you paste into
 * any assistant, and read its reply (a small JSON format — or just a bullet list) back into the app.
 */
import type { Board, Card, FieldDef, ID, List, Priority, Progress } from "./types";
import { useStore } from "./store";
import {
  byOrder, describeRecurrence, formatDuration, formatFieldValue, parseDuration, PALETTE, PRIORITIES, PROGRESS, subtaskIds,
  trackedMs, uid,
} from "./utils";
import type { ImportedBoard } from "./importers";

/** Short, stable handle for a card in exports and AI replies. */
export const shortId = (id: ID) => id.replace(/-/g, "").slice(0, 8);

// ------------------------------------------------------------------ reply format

export interface AiCard {
  title: string;
  description?: string;
  labels?: string[];
  priority?: Priority;
  progress?: Progress;
  start?: string;
  due?: string;
  assignees?: string[];
  checklist?: (string | { text: string; done?: boolean })[];
  /** Created as their own cards in the same bucket and linked from this card's checklist. */
  subtasks?: AiCard[];
  /** Custom field values by field name. */
  fields?: Record<string, string | number | boolean>;
  /** e.g. "2h", "45m" */
  estimate?: string;
}

export interface AiUpdate {
  id: string;
  title?: string;
  description?: string;
  appendDescription?: string;
  progress?: Progress;
  priority?: Priority;
  due?: string | null;
  labels?: string[];
  addLabels?: string[];
  assignees?: string[];
  /** Added as a note on the card. */
  note?: string;
  addChecklist?: string[];
  addSubtasks?: AiCard[];
  /** Move to the bucket with this name. */
  bucket?: string;
  estimate?: string;
}

export interface AiReply {
  zomello?: number;
  cards?: AiCard[];
  board?: { title: string; labels?: { name: string; color?: string }[]; buckets: { title: string; cards?: AiCard[] }[] };
  updates?: AiUpdate[];
}

const FORMAT_SPEC = `type Card = {
  title: string;
  description?: string;        // Markdown allowed
  labels?: string[];           // label names (prefer the existing ones)
  priority?: "urgent" | "important" | "medium" | "low";
  progress?: Progress;
  start?: "YYYY-MM-DD"; due?: "YYYY-MM-DD";
  assignees?: string[];        // people's names
  checklist?: string[];        // small steps
  subtasks?: Card[];           // bigger pieces that deserve their own card
  fields?: { [fieldName: string]: string | number | boolean };
  estimate?: string;           // e.g. "2h", "45m"
}`;

const UPDATE_SPEC = `type Update = {
  id: string;                  // the card's id from the list, e.g. "a1b2c3d4"
  title?: string; description?: string; appendDescription?: string;
  progress?: Progress;
  priority?: "urgent" | "important" | "medium" | "low";
  due?: "YYYY-MM-DD" | null;
  labels?: string[]; addLabels?: string[]; assignees?: string[];
  note?: string;               // your findings / reasoning, added as a note on the card
  addChecklist?: string[];
  addSubtasks?: Card[];
  bucket?: string;             // move to the bucket with this name
  estimate?: string;
}`;

// ------------------------------------------------------------------ context

function boardContext(board: Board, lists: List[], people: string[]) {
  const lines = [
    `Board: "${board.title}"`,
    ...(board.description.trim() ? [`About this board:\n${board.description.trim()}`] : []),
    `Buckets (in order): ${lists.map((l) => `"${l.title}"`).join(", ") || "none yet"}`,
    `Labels: ${board.labels.map((l) => `"${l.name}"`).join(", ") || "none"}`,
    `People: ${people.map((p) => `"${p}"`).join(", ") || "none"}`,
  ];
  if (board.fields.length) lines.push(`Custom fields:\n${board.fields.map((f) => `  - ${fieldSpec(f)}`).join("\n")}`);
  lines.push(`Today is ${new Date().toISOString().slice(0, 10)}.`);
  return lines.join("\n");
}

const fieldSpec = (f: FieldDef) =>
  `"${f.name}" (${f.type === "select" ? `one of: ${f.options.map((o) => `"${o.label}"`).join(", ")}` : f.type})`;

const liveLists = (boardId: ID) =>
  Object.values(useStore.getState().data.lists)
    .filter((l) => l.boardId === boardId && !l.archived)
    .sort(byOrder);

// ------------------------------------------------------------------ prompts

export function promptAddCards(boardId: ID, listId: ID, request: string): string {
  const { data } = useStore.getState();
  const board = data.boards[boardId];
  const list = data.lists[listId];
  const existing = Object.values(data.cards)
    .filter((c) => c.listId === listId && !c.archived)
    .sort(byOrder);
  return `You're helping me plan work in my task board app (TCI Boards).

## The board
${boardContext(board, liveLists(boardId), data.settings.people)}

## The bucket to add to: "${list.title}"
${existing.length ? `It already has these cards (don't duplicate them):\n${existing.map((c) => `- ${c.title}`).join("\n")}` : "It's empty."}

## What I need
${request.trim() || "(describe what you need here)"}

## How to answer
Reply with ONE \`\`\`json code block in this shape (anything outside the block is ignored):
{ "zomello": 1, "cards": [ Card, ... ] }

${FORMAT_SPEC}

Keep titles short and actionable; put detail in the description or checklist. Only include fields you're confident about.`;
}

export function promptNewBoard(request: string): string {
  const { data } = useStore.getState();
  return `You're helping me set up a new board in my task board app (TCI Boards). It works like Trello / Microsoft Planner: a board has buckets (columns) and cards.

## What the board is for
${request.trim() || "(describe the project here)"}

People who can be assigned: ${data.settings.people.map((p) => `"${p}"`).join(", ") || "just me"}
Today is ${new Date().toISOString().slice(0, 10)}.

## How to answer
Reply with ONE \`\`\`json code block in this shape:
{
  "zomello": 1,
  "board": {
    "title": string,
    "labels": [ { "name": string, "color": "#rrggbb" } ],
    "buckets": [ { "title": string, "cards": [ Card, ... ] } ]
  }
}

${FORMAT_SPEC}

Use 3 to 6 buckets that fit the work (e.g. a workflow like To do / Doing / Done, or phases). Keep titles short and actionable.`;
}

export type DelegateTask = "workorder" | "triage" | "breakdown" | "prioritize" | "status" | "custom" | "none";

export const DELEGATE_TASKS: { id: DelegateTask; name: string; ask: string; replies: boolean }[] = [
  {
    id: "workorder",
    name: "Do them (work order, e.g. for a coding assistant)",
    ask: `Work through the numbered items below, in order (most important first). For each one:
1. Do it: fix the bug / build the feature / complete the task. Ask me if something is ambiguous rather than guessing.
2. Check it works (build, run, test as appropriate).
3. Report back: what you changed, anything I should know or test, and follow-ups you noticed.
When you're finished (or if you stop part-way), reply with the status JSON below: mark finished items "completed", partly done ones "inProgress", ones you can't finish without the user "waiting", and put your summary in each item's note. Add follow-ups with addChecklist or addSubtasks.`,
    replies: true,
  },
  {
    id: "triage",
    name: "Work through them (e.g. bugs)",
    ask: "Go through each card. For each one, figure out the likely cause and a concrete fix or next step. Put your findings in a note, adjust priority if needed, and add checklist steps.",
    replies: true,
  },
  {
    id: "breakdown",
    name: "Break them down",
    ask: "Break each card into concrete steps. Small steps go in addChecklist; pieces big enough to be their own task go in addSubtasks.",
    replies: true,
  },
  {
    id: "prioritize",
    name: "Prioritize & estimate",
    ask: "Set a sensible priority and a time estimate for each card, and suggest due dates where it makes sense. Explain your reasoning briefly in a note.",
    replies: true,
  },
  {
    id: "status",
    name: "Summarize status",
    ask: "Write me a short status summary: what's done, what's in progress, what's blocked or late, and what I should focus on next. Plain text is fine, no JSON needed.",
    replies: false,
  },
  { id: "custom", name: "Something else…", ask: "", replies: true },
  { id: "none", name: "Just the export", ask: "", replies: false },
];

/** Markdown description of cards for an AI (or a person). */
export function exportMarkdown(
  boardId: ID,
  cards: Card[],
  opts: { heading?: string; notes?: boolean; checklists?: boolean; done?: boolean; numbered?: boolean } = {},
): string {
  const { data } = useStore.getState();
  const board = data.boards[boardId];
  const lists = liveLists(boardId);
  const label = (id: ID) => board.labels.find((l) => l.id === id)?.name;
  const shown = cards.filter((c) => opts.done !== false || c.progress !== "completed");
  const out: string[] = [`# ${opts.heading ?? board.title}`, ""];
  const listIndex = new Map(lists.map((l, i) => [l.id, i]));
  const RANK = { urgent: 0, important: 1, medium: 2, low: 3 } as const;
  // Work orders: one numbered list, most important first. Otherwise: grouped by bucket.
  const groups: { title: string | null; cards: Card[] }[] = opts.numbered
    ? [
        {
          title: null,
          cards: [...shown].sort(
            (a, b) => RANK[a.priority] - RANK[b.priority] || (listIndex.get(a.listId) ?? 0) - (listIndex.get(b.listId) ?? 0) || byOrder(a, b),
          ),
        },
      ]
    : lists.map((l) => ({ title: l.title, cards: shown.filter((c) => c.listId === l.id).sort(byOrder) })).filter((g) => g.cards.length);
  // A single bucket doesn't need its own heading under the export title.
  const showListHeadings = groups.length > 1 || (groups[0]?.title && !(opts.heading ?? "").includes(groups[0].title));
  let n = 0;
  for (const g of groups) {
    if (g.title && showListHeadings) out.push(`## ${g.title}`, "");
    for (const c of g.cards) {
      n++;
      const meta = [
        `id: ${shortId(c.id)}`,
        opts.numbered && `bucket: ${data.lists[c.listId]?.title}`,
        PROGRESS.find((p) => p.id === c.progress)!.name,
        `priority: ${PRIORITIES.find((p) => p.id === c.priority)!.name}`,
        c.startDate && `start ${c.startDate}`,
        c.dueDate && `due ${c.dueDate}`,
        c.labelIds.length && `labels: ${c.labelIds.map(label).filter(Boolean).join(", ")}`,
        c.assignees.length && `assigned: ${c.assignees.join(", ")}`,
        c.recurrence && `repeats: ${describeRecurrence(c.recurrence)}`,
        c.estimate && `estimate ${formatDuration(c.estimate * 60_000)}`,
        trackedMs(c) > 0 && `tracked ${formatDuration(trackedMs(c))}`,
      ].filter(Boolean);
      out.push(`### ${opts.numbered ? `${n}. ` : ""}${c.title}`, `_${meta.join(" · ")}_`);
      for (const f of board.fields) {
        const v = formatFieldValue(f, c.fields[f.id] ?? null);
        if (v) out.push(`- **${f.name}:** ${v}`);
      }
      const parents = Object.values(data.cards).filter((p) => subtaskIds(p).includes(c.id));
      if (parents.length) out.push(`- **Sub-task of:** ${parents.map((p) => p.title).join(", ")}`);
      for (const ln of c.links) {
        const o = data.cards[ln.cardId];
        if (o) out.push(`- **${ln.type === "blocks" ? "Blocks" : ln.type === "blockedBy" ? "Blocked by" : "Related to"}:** ${o.title}`);
      }
      if (c.description.trim()) out.push("", c.description.trim());
      if (opts.checklists !== false && c.checklist.length) {
        out.push("", "Checklist:");
        for (const i of c.checklist) out.push(`- [${i.done ? "x" : " "}] ${i.cardId ? data.cards[i.cardId]?.title ?? i.text : i.text}`);
      }
      if (opts.notes !== false && c.comments.length) {
        out.push("", "Notes:");
        for (const n of [...c.comments].reverse()) out.push(`> ${n.text.replace(/\n/g, "\n> ")}`);
      }
      const links = c.attachments.filter((a) => !a.stored);
      if (links.length) out.push("", `Links: ${links.map((a) => `[${a.name}](${a.url})`).join(", ")}`);
      out.push("");
    }
  }
  return out.join("\n").trim() + "\n";
}

export function promptDelegate(boardId: ID, cards: Card[], task: DelegateTask, custom: string, scope: string): string {
  const { data } = useStore.getState();
  const t = DELEGATE_TASKS.find((x) => x.id === task)!;
  const body = exportMarkdown(boardId, cards, { heading: scope, numbered: task === "workorder" });
  if (task === "none") return body;
  const ask = task === "custom" ? custom.trim() || "(describe what you want done)" : t.ask;
  return `You're helping me with tasks from my task board app (TCI Boards).

## Context
${boardContext(data.boards[boardId], liveLists(boardId), data.settings.people)}

## What I need
${ask}

## The cards
${body}
${
  t.replies
    ? `
## How to answer
Explain whatever you like, then include ONE \`\`\`json code block with your changes, so I can apply them automatically:
{ "zomello": 1, "updates": [ Update, ... ] }

${UPDATE_SPEC}

${FORMAT_SPEC}

Only include the fields you want to change. Use the ids exactly as given.`
    : ""
}`;
}

export function promptBreakdownCard(cardId: ID): string {
  const { data } = useStore.getState();
  const c = data.cards[cardId];
  return promptDelegate(c.boardId, [c], "breakdown", "", `Card: ${c.title}`);
}

// ------------------------------------------------------------------ reading a reply

/** Pull the JSON out of an AI reply; falls back to treating a bullet list as cards. */
export function parseReply(text: string): AiReply {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim());
  const candidates = [...fenced, text.trim()];
  for (const c of candidates) {
    const start = c.search(/[{[]/);
    if (start < 0) continue;
    try {
      const v = JSON.parse(c.slice(start));
      if (Array.isArray(v)) return { cards: v.map(asCard) };
      if (v && typeof v === "object") return v as AiReply;
    } catch {
      /* try the next candidate */
    }
  }
  // Plain list: "- Card" lines become cards; indented lines become their checklist.
  const cards: AiCard[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (!m) continue;
    const t = m[2].replace(/\*\*/g, "").trim();
    if (m[1].length >= 2 && cards.length) (cards[cards.length - 1].checklist ??= []).push(t);
    else cards.push({ title: t });
  }
  if (cards.length) return { cards };
  throw new Error("Couldn't find any cards or updates in that text. Paste the AI's whole reply (with its ```json block).");
}

const asCard = (v: unknown): AiCard => (typeof v === "string" ? { title: v } : (v as AiCard));

export function summarizeReply(r: AiReply) {
  const count = (cs?: AiCard[]): number => (cs ?? []).reduce((n, c) => n + 1 + count(c.subtasks), 0);
  return {
    cards: count(r.cards),
    board: r.board ? { title: r.board.title, buckets: r.board.buckets.length, cards: r.board.buckets.reduce((n, b) => n + count(b.cards), 0) } : null,
    updates: r.updates?.length ?? 0,
  };
}

// ------------------------------------------------------------------ applying a reply

const PRI = new Set(["urgent", "important", "medium", "low"]);
const PROG = new Set(["notStarted", "inProgress", "waiting", "onHold", "completed"]);
const isoOrNull = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** Find or create labels by name on a board; returns their ids. */
function labelIds(boardId: ID, names: string[] = []): ID[] {
  const st = useStore.getState();
  const board = st.data.boards[boardId];
  const labels = [...board.labels];
  const ids = names.map((name) => {
    const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const nl = { id: uid(), name, color: PALETTE[labels.length % PALETTE.length] };
    labels.push(nl);
    return nl.id;
  });
  if (labels.length !== board.labels.length) st.updateBoard(boardId, { labels });
  return ids;
}

function fieldValues(boardId: ID, fields?: AiCard["fields"]): Card["fields"] {
  const board = useStore.getState().data.boards[boardId];
  const out: Card["fields"] = {};
  for (const [name, v] of Object.entries(fields ?? {})) {
    const f = board.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) continue;
    if (f.type === "select") out[f.id] = f.options.find((o) => o.label.toLowerCase() === String(v).toLowerCase())?.id ?? null;
    else if (f.type === "number") out[f.id] = Number(v);
    else if (f.type === "checkbox") out[f.id] = !!v;
    else out[f.id] = String(v);
  }
  return out;
}

function cardPatch(boardId: ID, c: AiCard): Partial<Card> {
  const people = useStore.getState().data.settings.people;
  return {
    description: c.description ?? "",
    labelIds: labelIds(boardId, c.labels),
    priority: c.priority && PRI.has(c.priority) ? c.priority : "medium",
    progress: c.progress && PROG.has(c.progress) ? c.progress : "notStarted",
    startDate: isoOrNull(c.start),
    dueDate: isoOrNull(c.due),
    assignees: (c.assignees ?? []).filter((a) => people.includes(a)),
    checklist: (c.checklist ?? []).map((i) =>
      typeof i === "string" ? { id: uid(), text: i, done: false } : { id: uid(), text: i.text, done: !!i.done },
    ),
    fields: fieldValues(boardId, c.fields),
    estimate: c.estimate ? parseDuration(c.estimate) : null,
  };
}

/** Create a card (and its sub-tasks, linked from its checklist) in a bucket. Returns [id, cards created]. */
function createAiCard(listId: ID, c: AiCard): [ID, number] {
  const st = useStore.getState();
  const boardId = st.data.lists[listId].boardId;
  const id = st.createCard(listId, String(c.title ?? "Untitled").slice(0, 300), cardPatch(boardId, c));
  let n = 1;
  for (const sub of c.subtasks ?? []) {
    const [subId, m] = createAiCard(listId, sub);
    useStore.getState().addToParent(id, subId);
    n += m;
  }
  return [id, n];
}

export interface ApplyResult {
  created: number;
  updated: number;
  boardId?: ID;
  missing: string[];
}

export function applyReply(r: AiReply, target: { boardId: ID | null; listId: ID | null }): ApplyResult {
  const st = useStore.getState();
  const res: ApplyResult = { created: 0, updated: 0, missing: [] };

  if (r.board) {
    const ib: ImportedBoard = {
      source: "Trello", // only used for the label; importBoard ignores it
      title: r.board.title || "New board",
      labels: (r.board.labels ?? []).map((l, i) => ({ name: l.name, color: l.color ?? PALETTE[i % PALETTE.length] })),
      people: [],
      lists: r.board.buckets.map((b) => ({ name: b.title, cards: [] })),
      warnings: [],
    };
    const boardId = st.importBoard(ib, { addPeople: false });
    const lists = liveLists(boardId);
    r.board.buckets.forEach((b, i) => {
      for (const c of b.cards ?? []) res.created += createAiCard(lists[i].id, c)[1];
    });
    res.boardId = boardId;
  }

  if (r.cards?.length) {
    if (!target.listId) throw new Error("Pick a bucket for the new cards.");
    for (const c of r.cards) res.created += createAiCard(target.listId, c)[1];
  }

  if (r.updates?.length) {
    const scope = Object.values(useStore.getState().data.cards).filter((c) => !target.boardId || c.boardId === target.boardId);
    for (const u of r.updates) {
      const card = scope.find((c) => shortId(c.id) === String(u.id).replace(/^#/, "").toLowerCase().slice(0, 8));
      if (!card) {
        res.missing.push(String(u.id));
        continue;
      }
      const cur = useStore.getState().data.cards[card.id];
      const patch: Partial<Card> = {};
      if (u.title) patch.title = u.title;
      if (u.description !== undefined) patch.description = u.description;
      if (u.appendDescription) patch.description = `${cur.description.trim()}\n\n${u.appendDescription}`.trim();
      if (u.progress && PROG.has(u.progress)) patch.progress = u.progress;
      if (u.priority && PRI.has(u.priority)) patch.priority = u.priority;
      if (u.due !== undefined) patch.dueDate = isoOrNull(u.due);
      if (u.labels) patch.labelIds = labelIds(cur.boardId, u.labels);
      if (u.addLabels) patch.labelIds = [...new Set([...(patch.labelIds ?? cur.labelIds), ...labelIds(cur.boardId, u.addLabels)])];
      if (u.assignees) patch.assignees = u.assignees.filter((a) => st.data.settings.people.includes(a));
      if (u.note) patch.comments = [{ id: uid(), text: u.note, createdAt: Date.now() }, ...cur.comments];
      if (u.addChecklist?.length)
        patch.checklist = [...cur.checklist, ...u.addChecklist.map((text) => ({ id: uid(), text, done: false }))];
      if (u.estimate) patch.estimate = parseDuration(u.estimate);
      if (u.bucket) {
        const l = liveLists(cur.boardId).find((x) => x.title.toLowerCase() === u.bucket!.toLowerCase());
        if (l) patch.listId = l.id;
      }
      useStore.getState().updateCard(card.id, patch);
      for (const sub of u.addSubtasks ?? []) {
        const [subId, n] = createAiCard(useStore.getState().data.cards[card.id].listId, sub);
        useStore.getState().addToParent(card.id, subId);
        res.created += n;
      }
      res.updated++;
    }
  }
  return res;
}

/** One-click work order for a set of cards (used by "Copy work order"). */
export function workOrder(boardId: ID, cards: Card[], scope: string): string {
  return promptDelegate(boardId, cards.filter((c) => c.progress !== "completed" && !c.archived), "workorder", "", scope);
}
