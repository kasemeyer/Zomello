import { create } from "zustand";
import { demoData, isDemo } from "./demo";
import { addDays, differenceInCalendarDays } from "date-fns";
import { isPhoneOrTablet, loadRaw, saveRaw } from "./storage";
import { loadDeviceLook, noteLookPatch, withDeviceLook, withPlaceLook } from "./deviceLook";
import type {
  Activity, ActivityKind, AppData, BadgeMode, Board, BoardDisplay, BoardUi, Card, CardTemplate, Filter, FocusTimer, ID, LinkType, List, Route, Settings,
} from "./types";
import type { ImportedBoard } from "./importers";
import { boardAsTemplate } from "./boardTemplates";
import { broadcastData, isDeviceWindow, isExtraWindow, windowBoardId } from "./windows";
import { sendDeviceChanges, setDeviceBase } from "./deviceWindow";
import { isRemote } from "./remote";
import { canEditBoard, isServer, mergeOps, pushChanges, rebaseSnapshot, setBase, type Ops } from "./server";
import {
  blockLoopReason, byOrder, emptyFilter, fromISO, inverseLink, isBlocked, isLate, nextRecurrenceDate, PALETTE, subtaskLoopReason, toISO, todayISO, uid,
} from "./utils";

const DEFAULT_LABELS = [
  { name: "Bug", color: "#ef4444" },
  { name: "Feature", color: "#22c55e" },
  { name: "Design", color: "#a855f7" },
  { name: "Research", color: "#0ea5e9" },
  { name: "Blocked", color: "#f97316" },
  { name: "Idea", color: "#eab308" },
];

export const defaultDisplay = (): BoardDisplay => ({
  columnWidth: "normal",
  compact: false,
  labelStyle: "text",
  badges: {
    dates: "icon",
    checklist: "icon",
    assignees: "icon",
    priority: "icon",
    description: "icon",
    notes: "icon",
    links: "icon",
    time: "icon",
    attachments: "icon",
  },
  aging: false,
});

export const defaultSettings = (): Settings => ({
  theme: "system",
  me: "Me",
  people: ["Me"],
  accent: null,
  density: "normal",
  weekStartsOn: 1,
  defaultView: "board",
  sidebarCollapsed: false,
  reminders: { enabled: true, digest: true, digestTime: "09:00" },
  zoom: 1,
  focusMinutes: 25,
  focusSound: true,
  a11y: {
    reduceMotion: false,
    highContrast: false,
    underlineLinks: false,
    readableSpacing: false,
    strongFocus: false,
    largerTargets: false,
  },
  style: "classic",
  unlockedStyles: [],
  onboarded: false,
  collapsedCategories: [],
  runInBackground: false,
});

export const newBoard = (title: string, color: string, order: number): Board => ({
  id: uid(),
  title,
  description: "",
  color,
  icon: null,
  background: { type: "none" },
  backgroundFx: { blur: 0, dim: 0 },
  display: defaultDisplay(),
  fields: [],
  hiddenSections: [],
  labels: DEFAULT_LABELS.map((l) => ({ id: uid(), ...l })),
  archived: false,
  starred: false,
  order,
  createdAt: Date.now(),
});

const newList = (boardId: ID, title: string, order: number): List => ({
  id: uid(),
  boardId,
  title,
  order,
  archived: false,
  wipLimit: null,
  collapsed: false,
  sort: "custom",
  sortDesc: false,
});

/** New boards: To do → In progress → Done, where the last two set progress when cards arrive. */
const defaultBuckets = (boardId: ID): List[] => [
  newList(boardId, "To do", 0),
  { ...newList(boardId, "In progress", 1), autoProgress: "inProgress" },
  { ...newList(boardId, "Done", 2), autoProgress: "completed" },
];

/** Labels from a bucket rule added to a card's own, skipping any the board no longer has. */
function withLabels(d: AppData, boardId: ID, own: ID[], add: ID[] | undefined): ID[] {
  const known = new Set(d.boards[boardId]?.labels.map((l) => l.id));
  const extra = (add ?? []).filter((l) => known.has(l) && !own.includes(l));
  return extra.length ? [...own, ...extra] : own;
}

/** A bucket's other arrival rules: a due date (when the card has none), people and My Day. */
function arrivalRules(list: List | undefined, c: Pick<Card, "dueDate" | "assignees" | "myDay">): Partial<Card> {
  const out: Partial<Card> = {};
  if (!list) return out;
  if (list.arriveDueDays != null && !c.dueDate) out.dueDate = toISO(addDays(new Date(), list.arriveDueDays));
  const people = (list.arriveAssignees ?? []).filter((a) => !c.assignees.includes(a));
  if (people.length) out.assignees = [...c.assignees, ...people];
  if (list.arriveMyDay && c.myDay !== todayISO()) out.myDay = todayISO();
  return out;
}

/**
 * Which bucket's rule made each kind of change about to be saved, so the card's history can say so. The rules
 * below fill it in and the next patchCard of that card uses it up.
 */
let ruleTag: { id: ID; kinds: Partial<Record<ActivityKind, ID>> } | null = null;
function tagRule(id: ID, listId: ID, ...kinds: ActivityKind[]) {
  if (ruleTag?.id !== id) ruleTag = { id, kinds: {} };
  for (const k of kinds) ruleTag.kinds[k] ??= listId;
}

/**
 * A bucket's "moved or made here" rules for a card: arriving in it (`moving`), or already in it when the
 * rules are applied to the cards there.
 */
function bucketRules(d: AppData, card: Card, list: List | undefined, patch: Partial<Card>, moving: boolean): Partial<Card> {
  const own = patch.labelIds ?? card.labelIds;
  const labelIds = withLabels(d, patch.boardId ?? card.boardId, own, list?.arriveLabelIds);
  if (labelIds !== own) patch = { ...patch, labelIds };
  const extra = arrivalRules(list, { ...card, ...patch });
  if (Object.keys(extra).length) patch = { ...patch, ...extra };
  if (list && extra.dueDate) tagRule(card.id, list.id, "due");
  if (list && extra.assignees) tagRule(card.id, list.id, "assigned");
  if (patch.progress !== undefined) return patch;
  const p = list?.autoProgress;
  // Applying a bucket's rules to the cards already there doesn't reopen finished ones.
  if (p && (moving || card.progress !== "completed" || p === "completed")) {
    if (p === card.progress) return patch;
    tagRule(card.id, list!.id, "progress");
    return { ...patch, progress: p };
  }
  // Dragged back out of a "Done" bucket: it's open again (instead of vanishing under "Show completed").
  if (moving && card.progress === "completed" && d.lists[card.listId]?.autoProgress === "completed") return { ...patch, progress: "notStarted" };
  return patch;
}

/** A card arriving in a bucket takes on its rules: a progress (e.g. "Done" completes it), labels, dates, people. */
function arrive(d: AppData, id: ID, patch: Partial<Card>): Partial<Card> {
  const card = d.cards[id];
  if (!card || card.skipRules || !patch.listId || patch.listId === card.listId) return patch;
  return bucketRules(d, card, d.lists[patch.listId], patch, true);
}

/** Moving a card to the end of another bucket on its board, if that bucket is still there. */
function moveInto(d: AppData, cards: Record<ID, Card>, c: Card, toId: ID | null | undefined): Partial<Card> {
  const to = toId ? d.lists[toId] : undefined;
  if (!to || to.archived || to.boardId !== c.boardId || to.id === c.listId) return {};
  return { listId: to.id, order: Math.max(-1, ...Object.values(cards).filter((x) => x.listId === to.id).map((x) => x.order)) + 1 };
}

/** A bucket's "every checklist item ticked" rule for a card whose checklist is all ticked: complete it and/or move it on. */
function checklistPatch(d: AppData, cards: Record<ID, Card>, c: Card): Partial<Card> {
  const list = d.lists[c.listId];
  if (!list || c.skipRules || !allTicked(c)) return {};
  const patch: Partial<Card> = {};
  if (list.checkedComplete && c.progress !== "completed") {
    patch.progress = "completed";
    tagRule(c.id, list.id, "progress");
  }
  const move = moveInto(d, cards, c, list.checkedMoveTo);
  if (move.listId) {
    Object.assign(patch, move);
    tagRule(c.id, list.id, "moved");
  }
  return patch;
}

/** A bucket's "past its due date" rule for an open, late card: move it on and/or change its priority. */
function latePatch(d: AppData, cards: Record<ID, Card>, c: Card): Partial<Card> {
  const list = d.lists[c.listId];
  if (!list || c.skipRules || c.archived || c.progress === "completed" || !isLate(c)) return {};
  const patch: Partial<Card> = {};
  if (list.latePriority && c.priority !== list.latePriority) {
    patch.priority = list.latePriority;
    tagRule(c.id, list.id, "priority");
  }
  const move = moveInto(d, cards, c, list.lateMoveTo);
  if (move.listId) {
    Object.assign(patch, move);
    tagRule(c.id, list.id, "moved");
  }
  return patch;
}

const newCard = (boardId: ID, listId: ID, title: string, order: number, extra: Partial<Card> = {}): Card => ({
  id: uid(),
  boardId,
  listId,
  title,
  description: "",
  labelIds: [],
  priority: "medium",
  progress: "notStarted",
  startDate: null,
  dueDate: null,
  checklist: [],
  attachments: [],
  comments: [],
  assignees: [],
  links: [],
  recurrence: null,
  cover: null,
  coverImage: null,
  coverSize: "strip",
  activity: [],
  time: [],
  estimate: null,
  reminder: null,
  fields: {},
  order,
  archived: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  completedAt: null,
  ...extra,
});

function sampleData(): AppData {
  // The tutorial board: each card shows one thing worth knowing.
  const board = newBoard("Getting started", PALETTE[6], 0);
  board.description = "A tour of Zomello. Each card shows one feature; delete this board when you're done with it.";
  const lists = defaultBuckets(board.id);
  const [todo, doing, done] = lists;
  const d = (n: number) => toISO(addDays(new Date(), n));
  const [, feature, design, research] = board.labels;
  const cards = [
    newCard(board.id, todo.id, "Open me: how cards work", 0, {
      description:
        "A card is one task. Everything on it saves as you type.\n\n- **Mark complete** is at the top\n- Checklists, dates, people, labels, files and notes are below\n- Close with **Esc** or by clicking outside",
      labelIds: [feature.id],
      checklist: [
        { id: uid(), text: "Open this card", done: true },
        { id: uid(), text: "Tick this item", done: false },
        { id: uid(), text: "Add a due date on the right", done: false },
      ],
    }),
    newCard(board.id, todo.id, "Drag me to In progress", 1, {
      description:
        "Drag cards between buckets (and buckets by their title). Dropping a card in **In progress** or **Done** updates its progress for you. Each bucket's ⋯ menu decides what it does.",
      dueDate: d(2),
      priority: "important",
    }),
    newCard(board.id, todo.id, isPhoneOrTablet ? "Press and hold me" : "Right-click me", 2, {
      description: isPhoneOrTablet
        ? "Cards, buckets and boards all have a menu with their options: press and hold them. (On a computer, right-click.)"
        : "Cards, buckets and boards all have a right-click menu with their options. On a phone or tablet, press and hold instead.",
      labelIds: [design.id],
    }),
    newCard(board.id, todo.id, isPhoneOrTablet ? "Tap + to add a task from anywhere" : "Press N to add a task from anywhere", 3, {
      description: isPhoneOrTablet
        ? "Quick add (the **+** at the top) puts a task on any board without leaving what you're doing. **Undo** on the message that pops up brings back anything, even a delete."
        : "Quick add puts a task on any board without leaving what you're doing. **Ctrl+Z** undoes anything, even a delete.",
      labelIds: [research.id],
    }),
    newCard(board.id, doing.id, "Try the Calendar and Timeline views", 0, {
      description: "The view tabs at the top show this board as a list, a calendar, a timeline or charts. Nothing changes but the view.",
      progress: "inProgress",
      startDate: d(-2),
      dueDate: d(4),
    }),
    newCard(board.id, doing.id, isPhoneOrTablet ? "Tap the magnifier to search everything" : "Press Ctrl+K to search everything", 1, {
      description: "Search finds cards on every board, including their checklists and notes. This card is late on purpose: see how it shows up on Home.",
      progress: "inProgress",
      dueDate: d(-1),
      priority: "urgent",
    }),
    newCard(board.id, done.id, "Install Zomello", 0, { progress: "completed", completedAt: Date.now() }),
  ];
  return {
    version: 1,
    boards: { [board.id]: board },
    lists: Object.fromEntries(lists.map((l) => [l.id, l])),
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    savedFilters: [],
    templates: [],
    boardTemplates: [],
    ui: {},
    settings: defaultSettings(),
  };
}

/** Fill in any fields missing from older / hand-edited / imported files. */
export function normalize(raw: unknown): AppData {
  const d = (raw ?? {}) as Partial<AppData>;
  if (typeof d !== "object" || !d.boards || !d.lists || !d.cards) throw new Error("Not a Zomello data file");
  const boards: AppData["boards"] = {};
  for (const b of Object.values(d.boards)) {
    const display = { ...defaultDisplay(), ...b.display };
    // Older files stored badges as on/off booleans.
    const badges = { ...defaultDisplay().badges };
    for (const [k, v] of Object.entries(b.display?.badges ?? {}) as [string, unknown][])
      badges[k as keyof typeof badges] = v === true ? "icon" : v === false ? "off" : (v as BadgeMode);
    display.badges = badges;
    boards[b.id] = { ...newBoard("", PALETTE[6], 0), ...b, id: b.id, display };
  }
  const lists: AppData["lists"] = {};
  // Buckets without their board can't be shown anywhere: drop them.
  for (const l of Object.values(d.lists)) if (boards[l.boardId]) lists[l.id] = { ...newList(l.boardId, "", 0), ...l };
  const cards: AppData["cards"] = {};
  for (const c of Object.values(d.cards)) {
    if (!boards[c.boardId]) continue;
    let listId = c.listId;
    // A card whose bucket is gone goes to its board's first bucket (a new "Recovered" one if it has none).
    if (!lists[listId] || lists[listId].boardId !== c.boardId) {
      const first = Object.values(lists).filter((l) => l.boardId === c.boardId).sort(byOrder)[0];
      if (first) listId = first.id;
      else {
        const rescue = newList(c.boardId, "Recovered", 0);
        lists[rescue.id] = rescue;
        listId = rescue.id;
      }
    }
    cards[c.id] = { ...newCard(c.boardId, listId, "", 0), ...c, listId };
  }
  // Repair linked checklist items whose copied title went stale (before renames were synced).
  for (const c of Object.values(cards))
    if (c.checklist.some((i) => i.cardId && cards[i.cardId] && cards[i.cardId].title !== i.text))
      cards[c.id] = { ...c, checklist: c.checklist.map((i) => (i.cardId && cards[i.cardId] ? { ...i, text: cards[i.cardId].title } : i)) };
  const ui: AppData["ui"] = {};
  for (const [k, v] of Object.entries(d.ui ?? {})) ui[k] = { ...defaultUi(), ...v, filter: { ...emptyFilter(), ...v.filter } };
  return {
    version: 1,
    boards,
    lists,
    cards,
    savedFilters: d.savedFilters ?? [],
    templates: d.templates ?? [],
    boardTemplates: d.boardTemplates ?? [],
    ui,
    settings: {
      ...defaultSettings(),
      ...d.settings,
      reminders: { ...defaultSettings().reminders, ...d.settings?.reminders },
      a11y: { ...defaultSettings().a11y, ...d.settings?.a11y },
      // Files from before the welcome guide existed belong to people who are already set up; a new
      // account on a Zomello Server hasn't seen it yet.
      onboarded: d.settings?.onboarded ?? !isServer,
      unlockedStyles: d.settings?.unlockedStyles ?? [],
    },
  };
}

export const defaultUi = (view: BoardUi["view"] = "board"): BoardUi => ({
  view,
  groupBy: "bucket",
  filter: emptyFilter(),
  showCompleted: [],
});

/** What the AI tools window was opened for. */
export interface AiDialogState {
  tab: "ask" | "export" | "apply";
  /** "Ask AI": add cards to a bucket, or build a whole new board. */
  mode?: "cards" | "board";
  boardId?: ID;
  listId?: ID;
  /** Export just these cards (e.g. one card from its menu). */
  cardIds?: ID[];
}

export interface CardTrailStep {
  cardId: ID;
  /** How we left this card: through a checklist link, a linked task, or a "checklist item in" parent link. */
  via: "checklist" | "link" | "parent";
}

export interface Toast {
  id: ID;
  text: string;
  /** Show an Undo button that reverts the change. */
  undo?: boolean;
  key?: string;
  /** An extra button, e.g. "Show" for a saved file. */
  action?: { label: string; run: () => void };
}

interface State {
  data: AppData;
  loaded: boolean;
  loadError: string | null;
  saveError: string | null;
  route: Route;
  openCardId: ID | null;
  cardTrail: CardTrailStep[];
  /** Direction of the last card navigation, for the slide animation. */
  cardNavDir: "forward" | "back" | null;
  searchOpen: boolean;
  quickAddOpen: boolean;
  helpOpen: boolean;
  welcomeOpen: boolean;
  customizeBoardId: ID | null;
  /** Zomello Server: the board whose Share window is open. */
  shareBoardId: ID | null;
  toasts: Toast[];
  focus: FocusTimer | null;
  importOpen: boolean;
  /** Home > Start from a template. */
  templatesOpen: boolean;
  /** Quick add opened with something already in it (text shared to Zomello from another app). */
  quickAddPrefill: { title: string; description: string } | null;
  aiDialog: AiDialogState | null;
  /** "Paste cards" window: where the cards go. */
  pasteCards: { boardId: ID; listId?: ID; text?: string } | null;
  /** Cards picked with Ctrl+click on the board (for bulk actions like handing them to an AI). */
  selected: ID[];
  toggleSelected(id: ID): void;
  /** Adds these cards to the selection. */
  selectCards(ids: ID[]): void;
  clearSelected(): void;

  load(): Promise<void>;
  undo(): boolean;
  redo(): boolean;
  /** `key`: a new toast with the same key replaces the old one (e.g. zoom level). */
  toast(text: string, opts?: { undo?: boolean; key?: string; action?: Toast["action"] }): void;
  dismissToast(id: ID): void;
  setOverlay(
    patch: Partial<Pick<State, "quickAddOpen" | "helpOpen" | "welcomeOpen" | "customizeBoardId" | "shareBoardId" | "searchOpen" | "importOpen" | "templatesOpen" | "quickAddPrefill" | "aiDialog" | "pasteCards">>,
  ): void;

  startFocus(minutes: number, cardId?: ID | null, label?: string): void;
  pauseFocus(): void;
  resumeFocus(): void;
  extendFocus(minutes: number): void;
  /** Ends the countdown; `completed` = it ran out (vs. cancelled). */
  endFocus(completed: boolean): void;
  replaceData(data: AppData): void;
  /** Adopt data another window just saved. */
  applyRemoteData(json: string): void;
  /** Zomello Server: merge other people's changes. */
  applyServerOps(ops: Ops): void;
  /** Zomello Server: your own settings/view changed in another tab. */
  applyServerUserDoc(doc: Pick<AppData, "settings" | "ui" | "templates" | "savedFilters"> & Partial<Pick<AppData, "boardTemplates">>): void;
  /** Zomello Server: load everything again (after sharing changes, or reconnecting). */
  reloadFromServer(json: string): void;
  navigate(route: Route): void;
  /**
   * Open a card. With `via` set, the current card is kept on a trail so the user can step back
   * (used when following a linked task / checklist link from inside a card).
   */
  openCard(id: ID | null, opts?: { via?: CardTrailStep["via"] }): void;
  /** Return to the card we came from (or to an earlier step of the trail). */
  cardBack(toIndex?: number): void;
  setSearchOpen(open: boolean): void;

  createBoard(title: string, color?: string): ID;
  updateBoard(id: ID, patch: Partial<Board>): void;
  deleteBoard(id: ID): void;
  /** Save the sidebar order (ids in display order). */
  reorderBoards(ids: ID[]): void;
  /** Copy a board; without cards it's a "new board from template". */
  duplicateBoard(id: ID, opts?: { title?: string; withCards?: boolean }): ID;

  createList(boardId: ID, title: string): ID;
  updateList(id: ID, patch: Partial<List>): void;
  deleteList(id: ID): void;
  reorderLists(ids: ID[]): void;

  createCard(listId: ID, title: string, extra?: Partial<Card>): ID;
  updateCard(id: ID, patch: Partial<Card>): void;
  deleteCard(id: ID): void;
  duplicateCard(id: ID): ID;
  moveCardToBoard(id: ID, boardId: ID, listId: ID): void;
  /** Move to another bucket, appended to the end of its custom order. */
  moveCardToList(id: ID, listId: ID): void;
  resetTime(cardId: ID): void;
  importBoard(b: ImportedBoard, opts: { addPeople: boolean }): ID;
  /** Phone app: edits made on your computer to this phone's boards (applied here, then saved). */
  applyLinkOps(ops: Ops): void;
  /** This computer's window onto a phone: the phone went away (or came back). */
  deviceOffline: boolean;
  /** Add a board that arrives complete (a .zomello board file), with its people. */
  addBoardBundle(x: { board: Board; lists: List[]; cards: Card[]; people: string[] }): void;
  /**
   * Cards sent from another device into board `into`: each goes to the bucket with the same name (else the
   * first), labels and custom fields match by name (missing labels are added). Returns how many arrived.
   */
  addArrivedCards(x: { board: Board; lists: List[]; cards: Card[]; people: string[] }, into: ID): number;
  /** Boards from a backup, as they were (same ids); ones already here are left alone. Returns how many were added. */
  restoreBoards(part: Pick<AppData, "boards" | "lists" | "cards"> & { ui?: AppData["ui"] }): number;
  /** Set `order` by position for `ids` and apply `patch` to the moved card. */
  applyCardOrder(ids: ID[], movedId: ID, patch: Partial<Card>): void;
  linkCards(a: ID, b: ID, type: LinkType): void;
  unlinkCards(a: ID, b: ID): void;
  /** Point a checklist item at a card (or detach it with null). */
  linkChecklistItem(cardId: ID, itemId: ID, target: ID | null): void;
  /** Create a card from a checklist item and keep the item linked to it. */
  spinOffChecklistItem(cardId: ID, itemId: ID, listId: ID): ID;
  /** Toggle a checklist item; linked items toggle the linked card instead. */
  toggleChecklistItem(cardId: ID, itemId: ID): void;
  /** Make `childId` a sub-task of `parentId` (adds a linked item to the parent's checklist). */
  addToParent(parentId: ID, childId: ID): void;
  removeFromParent(parentId: ID, childId: ID): void;

  startTimer(cardId: ID): void;
  stopTimer(): void;
  addTime(cardId: ID, minutes: number): void;
  deleteTimeEntry(cardId: ID, entryId: ID): void;

  saveTemplate(cardId: ID, name: string): void;
  updateTemplate(id: ID, patch: Partial<CardTemplate>): void;
  deleteTemplate(id: ID): void;
  /** Board menu > Save as template: the board's buckets, labels and open cards, for new boards. */
  saveBoardTemplate(boardId: ID, name: string): void;
  renameBoardTemplate(id: string, name: string): void;
  deleteBoardTemplate(id: string): void;
  createFromTemplate(templateId: ID, listId: ID, extra?: Partial<Card>): ID;
  /**
   * The bucket rules that run on a clock: archive completed cards after N days, and move or reprioritize
   * late cards. Returns how many cards changed.
   */
  sweepRules(now?: number): number;
  /** Apply a bucket's "moved or made here", checklist and late rules to the cards already in it. Returns how many changed. */
  applyBucketRules(listId: ID): number;

  setBoardUi(boardId: ID, patch: Partial<BoardUi>): void;
  setFilter(boardId: ID, patch: Partial<Filter>): void;
  saveFilter(boardId: ID, name: string, filter: Filter): void;
  deleteSavedFilter(id: ID): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Rename someone everywhere: the people list, "Me", and every card they're assigned to. */
  renamePerson(from: string, to: string): void;
  /** Put a board in a category (null = none). */
  setBoardCategory(boardId: ID, category: string | null): void;
  /** Rename a category on every board in it (merges into an existing one of that name). */
  renameCategory(from: string, to: string): void;
  /** Take every board out of a category; the boards themselves stay. */
  removeCategory(name: string): void;
  toggleCategoryCollapsed(name: string): void;
  /** Make a category on its own (a "section"), even before any board is in it. */
  addCategory(name: string): void;
}

const progressPatch = (prev: Card, patch: Partial<Card>): Partial<Card> => {
  if (!patch.progress || patch.progress === prev.progress) return patch;
  return { ...patch, completedAt: patch.progress === "completed" ? Date.now() : null };
};

/** The next instance of a recurring card, or null when the rule has run out. */
function nextOccurrence(c: Card): Card | null {
  if (!c.recurrence) return null;
  const due = nextRecurrenceDate(c.recurrence, c.dueDate ?? todayISO());
  if (!due) return null;
  const startDate =
    c.startDate && c.dueDate
      ? toISO(addDays(fromISO(due), differenceInCalendarDays(fromISO(c.startDate), fromISO(c.dueDate))))
      : null;
  return {
    ...structuredClone(c),
    id: uid(),
    dueDate: due,
    startDate,
    progress: "notStarted",
    completedAt: null,
    archived: false,
    checklist: c.checklist.map((i) => ({ ...i, id: uid(), done: i.cardId ? i.done : false })),
    comments: [],
    links: [],
    time: [],
    activity: [{ at: Date.now(), kind: "created" }],
    order: c.order - 0.5,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Apply a patch to one card inside a cards map. Handles completedAt and, when a
 * recurring card gets completed, spawns its next occurrence (the completed one
 * stops recurring so re-toggling it can't spawn duplicates).
 */
const MAX_ACTIVITY = 200;
const DAY_MS = 86_400_000;

/** Activity entries describing what changed between two versions of a card. */
function diffActivity(prev: Card, next: Card): Activity[] {
  const at = Date.now();
  const out: Activity[] = [];
  if (prev.boardId !== next.boardId) out.push({ at, kind: "board", from: prev.boardId, to: next.boardId });
  else if (prev.listId !== next.listId) out.push({ at, kind: "moved", from: prev.listId, to: next.listId });
  if (prev.progress !== next.progress) out.push({ at, kind: "progress", from: prev.progress, to: next.progress });
  if (prev.priority !== next.priority) out.push({ at, kind: "priority", from: prev.priority, to: next.priority });
  if (prev.dueDate !== next.dueDate) out.push({ at, kind: "due", from: prev.dueDate, to: next.dueDate });
  if (prev.archived !== next.archived) out.push({ at, kind: next.archived ? "archived" : "restored" });
  if (prev.title !== next.title) out.push({ at, kind: "renamed", from: prev.title, to: next.title });
  for (const a of next.assignees) if (!prev.assignees.includes(a)) out.push({ at, kind: "assigned", to: a });
  for (const a of prev.assignees) if (!next.assignees.includes(a)) out.push({ at, kind: "unassigned", from: a });
  return out;
}

/** Cards that were waiting on `id` and aren't blocked by anything any more. */
function freedBy(id: ID, before: Record<ID, Card>, after: Record<ID, Card>): Card[] {
  const waiting = (after[id]?.links ?? []).filter((l) => l.type === "blocks").map((l) => after[l.cardId]);
  return waiting.filter((c) => c && c.progress !== "completed" && isBlocked(before[c.id] ?? c, before) && !isBlocked(c, after));
}

const allTicked = (c: Card | undefined) => !!c && c.checklist.length > 0 && c.checklist.every((i) => i.done);

/**
 * "When every checklist item is ticked" bucket rules: cards whose checklist just became all ticked get
 * completed and/or moved on. Completing one can tick it off a parent's checklist, so this repeats a few
 * times to let that settle.
 */
function checklistRules(d: AppData, before: Record<ID, Card>, after: Record<ID, Card>): Record<ID, Card> {
  let prev = before;
  let cards = after;
  for (let round = 0; round < 4; round++) {
    const start = cards;
    for (const c of Object.values(start)) {
      if (c === prev[c.id] || c.archived || allTicked(prev[c.id])) continue;
      const patch = checklistPatch(d, cards, c);
      if (Object.keys(patch).length) cards = patchCard(cards, c.id, arrive({ ...d, cards }, c.id, patch));
    }
    if (cards === start) break;
    prev = start;
  }
  return cards;
}

function patchCard(cards: Record<ID, Card>, id: ID, patch: Partial<Card>): Record<ID, Card> {
  const prev = cards[id];
  const tag = ruleTag?.id === id ? ruleTag.kinds : undefined;
  ruleTag = null;
  if (!prev) return cards;
  let next: Card = { ...prev, ...progressPatch(prev, patch), updatedAt: Date.now() };
  const changes = diffActivity(prev, next).map((a) => (tag?.[a.kind] ? { ...a, rule: tag[a.kind] } : a));
  if (changes.length) next.activity = [...next.activity, ...changes].slice(-MAX_ACTIVITY);
  const out = { ...cards };
  // Linked checklist items keep a copy of the task's title — keep it current when the task is renamed.
  if (next.title !== prev.title) {
    for (const c of Object.values(out)) {
      if (c.id !== id && c.checklist.some((i) => i.cardId === id && i.text !== next.title))
        out[c.id] = { ...c, checklist: c.checklist.map((i) => (i.cardId === id ? { ...i, text: next.title } : i)) };
    }
  }
  if (next.progress === "completed" && prev.progress !== "completed" && next.recurrence) {
    const spawn = nextOccurrence(next);
    if (spawn) out[spawn.id] = spawn;
    next = { ...next, recurrence: null };
  }
  out[id] = next;
  // Keep checklist items that point at this card in sync with its completion.
  if (next.progress !== prev.progress) {
    const done = next.progress === "completed";
    for (const c of Object.values(out)) {
      if (c.checklist.some((i) => i.cardId === id && i.done !== done))
        out[c.id] = { ...c, checklist: c.checklist.map((i) => (i.cardId === id ? { ...i, done } : i)) };
    }
  }
  return out;
}

/** Remove links / checklist references pointing at deleted cards. */
function pruneRefs(cards: Record<ID, Card>): Record<ID, Card> {
  const out: Record<ID, Card> = {};
  for (const [id, c] of Object.entries(cards)) {
    const links = c.links.filter((l) => cards[l.cardId]);
    const dangling = c.checklist.some((i) => i.cardId && !cards[i.cardId]);
    out[id] =
      links.length === c.links.length && !dangling
        ? c
        : {
            ...c,
            links,
            checklist: c.checklist.map((i) => (i.cardId && !cards[i.cardId] ? { ...i, cardId: null } : i)),
          };
  }
  return out;
}

// ---- Focus timer survives reloads (per device) ----
const FOCUS_KEY = "zomello-focus";
function loadFocus(): FocusTimer | null {
  try {
    return JSON.parse(localStorage.getItem(FOCUS_KEY) ?? "null");
  } catch {
    return null;
  }
}

// ---- Undo / redo: snapshots of `data` (view state like filters is not undoable) ----
const HISTORY_LIMIT = 150;
/** Changes closer together than this are merged into one undo step (e.g. typing). */
const COALESCE_MS = 700;
let past: AppData[] = [];
/** True while adopting another window's data (so it isn't saved straight back). */
let applyingRemote = false;
let future: AppData[] = [];
let lastChange = 0;
/** View preferences (zoom, sidebar) change too often to be worth an undo step. */
const VIEW_PREFS = ["zoom", "sidebarCollapsed", "collapsedCategories"] as const;
const settingsChanged = (a: Settings, b: Settings) =>
  a !== b &&
  (Object.keys(a) as (keyof Settings)[]).some(
    (k) => !(VIEW_PREFS as readonly string[]).includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
/**
 * Does a change touch a board that's view-only for this account? The server would refuse it anyway
 * (sync.rs); catching it here keeps the screen honest instead of snapping back after a round trip.
 */
function touchesViewOnly(prev: AppData, next: AppData): boolean {
  if (!isServer || prev === next) return false;
  const ro = new Set(Object.values(prev.boards).filter((b) => !canEditBoard(b)).map((b) => b.id));
  if (!ro.size) return false;
  if (prev.boards !== next.boards) for (const id of ro) if (prev.boards[id] !== next.boards[id]) return true;
  for (const k of ["lists", "cards"] as const) {
    if (prev[k] === next[k]) continue;
    const a = prev[k] as Record<ID, { boardId: ID }>;
    const b = next[k] as Record<ID, { boardId: ID }>;
    for (const id in b) if (a[id] !== b[id] && (ro.has(b[id].boardId) || (a[id] && ro.has(a[id].boardId)))) return true;
    for (const id in a) if (!(id in b) && ro.has(a[id].boardId)) return true;
  }
  return false;
}

const undoable = (a: AppData, b: AppData) =>
  a.boards !== b.boards || a.lists !== b.lists || a.cards !== b.cards ||
  a.savedFilters !== b.savedFilters || a.templates !== b.templates || a.boardTemplates !== b.boardTemplates || settingsChanged(a.settings, b.settings);

export const useStore = create<State>((set, get) => {
  /** Apply an immutable update to `data`, recording undo history. */
  /** True while createFromTemplate runs, so a bucket's "start from a template" rule doesn't apply twice. */
  let fromTemplate = false;
  /** A template's contents as a new card's fields. Labels match by name; any the board lacks are added to it. */
  const templateCard = (t: CardTemplate, boardId: ID): Partial<Card> => {
    const board = get().data.boards[boardId];
    const labels = [...board.labels];
    const labelIds = t.labels.map((tl) => {
      const found = labels.find((l) => l.name.toLowerCase() === tl.name.toLowerCase());
      if (found) return found.id;
      const nl = { id: uid(), ...tl };
      labels.push(nl);
      return nl.id;
    });
    if (labels.length !== board.labels.length) get().updateBoard(board.id, { labels });
    return {
      description: t.description,
      checklist: t.checklist.map((text) => ({ id: uid(), text, done: false })),
      labelIds,
      priority: t.priority,
      assignees: t.assignees,
      recurrence: t.recurrence,
      cover: t.cover,
      estimate: t.estimate,
      ...(t.recurrence ? { dueDate: todayISO() } : {}),
    };
  };

  const mut = (fn: (d: AppData) => AppData) =>
    set((s) => {
      const next = fn(s.data);
      if (touchesViewOnly(s.data, next)) {
        setTimeout(() => get().toast("This board is view-only for you", { key: "view-only" }));
        return {};
      }
      if (s.loaded && next !== s.data && undoable(next, s.data)) {
        const now = Date.now();
        if (now - lastChange > COALESCE_MS) {
          past.push(s.data);
          if (past.length > HISTORY_LIMIT) past.shift();
        }
        lastChange = now;
        future = [];
      }
      return { data: next };
    });

  return {
    data: sampleData(),
    loaded: false,
    loadError: null,
    saveError: null,
    route: { page: "home" },
    openCardId: null,
    cardTrail: [],
    cardNavDir: null,
    searchOpen: false,
    quickAddOpen: false,
    helpOpen: false,
    welcomeOpen: false,
    customizeBoardId: null,
    shareBoardId: null,
    toasts: [],
    focus: loadFocus(),
    importOpen: false,
    templatesOpen: false,
    quickAddPrefill: null,
    aiDialog: null,
    pasteCards: null,
    selected: [],
    toggleSelected(id) {
      set((s) => ({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] }));
    },
    selectCards(ids) {
      set((s) => ({ selected: [...new Set([...s.selected, ...ids])] }));
    },
    clearSelected() {
      if (get().selected.length) set({ selected: [] });
    },

    undo() {
      const prev = past.pop();
      if (!prev) return false;
      future.push(get().data);
      lastChange = 0;
      set((s) => ({ data: { ...prev, ui: s.data.ui } }));
      return true;
    },
    redo() {
      const next = future.pop();
      if (!next) return false;
      past.push(get().data);
      lastChange = 0;
      set((s) => ({ data: { ...next, ui: s.data.ui } }));
      return true;
    },
    toast(text, opts) {
      const t: Toast = { id: uid(), text, undo: opts?.undo, key: opts?.key, action: opts?.action };
      set((s) => ({ toasts: [...s.toasts.filter((x) => !t.key || x.key !== t.key).slice(-3), t] }));
      setTimeout(() => get().dismissToast(t.id), t.action ? 12000 : 6000);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    setOverlay(patch) {
      set(patch);
    },

    async load() {
      try {
        const raw = await loadRaw();
        lastJson = raw;
        await loadDeviceLook();
        let data = raw ? normalize(JSON.parse(raw)) : isDemo ? demoData(sampleData(), { newBoard, newList, newCard }) : sampleData();
        if (isServer) {
          setBase(data);
          // A brand-new account starts with the tutorial board (it's theirs, so it gets saved).
          if (!data.settings.onboarded && Object.keys(data.boards).length === 0) {
            const sample = sampleData();
            data = { ...data, boards: sample.boards, lists: sample.lists, cards: sample.cards };
          }
        }
        // Your computer's boards in the phone app: shown with the phone's own look.
        data = withDeviceLook(data);
        if (isDeviceWindow) setDeviceBase(data);
        const first = Object.values(data.boards).filter((b) => !b.archived).sort(byOrder)[0];
        const route: Route =
          windowBoardId && data.boards[windowBoardId]
            ? { page: "board", boardId: windowBoardId }
            : raw
              ? { page: "home" }
              : first
                ? { page: "board", boardId: first.id }
                : { page: "home" };
        set({ data, loaded: true, route });
      } catch (e) {
        // Never overwrite a file we failed to parse: stay unloaded so autosave is disabled.
        set({ loadError: String(e) });
      }
    },

    applyServerOps(ops) {
      // Fill in anything missing, the same as when loading a file (never trust the shape of incoming data).
      ops = {
        ...ops,
        upserts: {
          boards: (ops.upserts.boards ?? []).map((b) => {
            const board = b as Board;
            return { ...newBoard("", PALETTE[6], 0), ...board, id: board.id, display: { ...defaultDisplay(), ...board.display } };
          }),
          lists: (ops.upserts.lists ?? []).map((l) => ({ ...newList((l as List).boardId, "", 0), ...(l as List) })),
          cards: (ops.upserts.cards ?? []).map((c) => ({ ...newCard((c as Card).boardId, (c as Card).listId, "", 0), ...(c as Card) })),
        },
      };
      applyingRemote = true;
      try {
        set((s) => ({ data: mergeOps(s.data, ops) }));
        // Keep undo from bringing back someone else's old version of a card.
        past = past.map((p) => rebaseSnapshot(p, ops));
        future = future.map((p) => rebaseSnapshot(p, ops));
      } finally {
        applyingRemote = false;
      }
      const st = get();
      if (st.openCardId && !st.data.cards[st.openCardId]) set({ openCardId: null });
      if (st.route.page === "board" && !st.data.boards[st.route.boardId]) set({ route: { page: "home" } });
    },
    applyServerUserDoc(doc) {
      applyingRemote = true;
      try {
        set((s) => ({
          data: withDeviceLook({ ...s.data, ...doc, settings: { ...s.data.settings, ...doc.settings, me: s.data.settings.me, people: s.data.settings.people } }),
        }));
      } finally {
        applyingRemote = false;
      }
    },
    reloadFromServer(json) {
      let data: AppData;
      try {
        data = normalize(JSON.parse(json));
      } catch {
        return;
      }
      setBase(data);
      data = withDeviceLook(data);
      past = [];
      future = [];
      applyingRemote = true;
      try {
        set({ data });
      } finally {
        applyingRemote = false;
      }
      const st = get();
      if (st.openCardId && !data.cards[st.openCardId]) set({ openCardId: null });
      if (st.route.page === "board" && !data.boards[st.route.boardId]) set({ route: { page: "home" } });
    },

    applyRemoteData(json) {
      // Nothing new, or we have edits of our own on the way out (they win; everyone gets them next).
      if (json === lastJson || pending || saving) return;
      lastJson = json;
      let data: AppData;
      try {
        data = withDeviceLook(normalize(JSON.parse(json)));
      } catch {
        return;
      }
      // Another window saved: adopt its data (keeping this window's own view state) without saving it
      // back, and drop undo history — it no longer matches what's on screen.
      past = [];
      future = [];
      applyingRemote = true;
      try {
        set((s) => ({ data: { ...data, ui: s.data.ui } }));
        if (isDeviceWindow) setDeviceBase(get().data);
      } finally {
        applyingRemote = false;
      }
    },

    replaceData(data) {
      past.push(get().data);
      future = [];
      set({ data, route: { page: "home" }, openCardId: null });
    },

    navigate(route) {
      set({ route, openCardId: null, cardTrail: [], cardNavDir: null, selected: [] });
    },
    openCard(id, opts) {
      const { openCardId, cardTrail } = get();
      if (id && opts?.via && openCardId && openCardId !== id)
        set({ openCardId: id, cardTrail: [...cardTrail, { cardId: openCardId, via: opts.via }], cardNavDir: "forward" });
      else set({ openCardId: id, cardTrail: [], cardNavDir: null });
    },
    cardBack(toIndex) {
      const { cardTrail, data } = get();
      if (!cardTrail.length) return;
      const i = toIndex ?? cardTrail.length - 1;
      const step = cardTrail[i];
      // Skip back past cards that were deleted meanwhile.
      if (!data.cards[step.cardId]) return set({ cardTrail: cardTrail.slice(0, i) });
      set({ openCardId: step.cardId, cardTrail: cardTrail.slice(0, i), cardNavDir: "back" });
    },
    setSearchOpen(open) {
      set({ searchOpen: open });
    },

    createBoard(title, color) {
      const order = Math.max(-1, ...Object.values(get().data.boards).map((b) => b.order)) + 1;
      const board = newBoard(title, color ?? PALETTE[order % PALETTE.length], order);
      const lists = defaultBuckets(board.id);
      mut((d) => ({
        ...d,
        boards: { ...d.boards, [board.id]: board },
        lists: { ...d.lists, ...Object.fromEntries(lists.map((l) => [l.id, l])) },
        ui: { ...d.ui, [board.id]: defaultUi(d.settings.defaultView) },
      }));
      return board.id;
    },
    updateBoard(id, patch) {
      mut((d) => ({ ...d, boards: { ...d.boards, [id]: { ...d.boards[id], ...patch } } }));
    },
    reorderBoards(ids) {
      mut((d) => {
        const boards = { ...d.boards };
        ids.forEach((id, i) => {
          if (boards[id] && boards[id].order !== i) boards[id] = { ...boards[id], order: i };
        });
        return { ...d, boards };
      });
    },
    deleteBoard(id) {
      mut((d) => {
        const { [id]: _, ...boards } = d.boards;
        const { [id]: __, ...ui } = d.ui;
        return {
          ...d,
          boards,
          ui,
          lists: Object.fromEntries(Object.entries(d.lists).filter(([, l]) => l.boardId !== id)),
          cards: pruneRefs(Object.fromEntries(Object.entries(d.cards).filter(([, c]) => c.boardId !== id))),
          savedFilters: d.savedFilters.filter((f) => f.boardId !== id),
        };
      });
      const r = get().route;
      if (r.page === "board" && r.boardId === id) set({ route: { page: "home" } });
    },
    duplicateBoard(id, opts) {
      const d = get().data;
      const src = d.boards[id];
      const order = Math.max(...Object.values(d.boards).map((b) => b.order)) + 1;
      const labelMap = new Map(src.labels.map((l) => [l.id, uid()]));
      const board: Board = {
        ...src,
        id: uid(),
        title: opts?.title ?? `${src.title} (copy)`,
        order,
        starred: false,
        archived: false,
        createdAt: Date.now(),
        labels: src.labels.map((l) => ({ ...l, id: labelMap.get(l.id)! })),
      };
      const listMap = new Map<ID, ID>();
      const lists = Object.values(d.lists)
        .filter((l) => l.boardId === id && !l.archived)
        .map((l) => {
          const relabel = (ids?: ID[]) => ids?.map((x) => labelMap.get(x)).filter((x): x is ID => !!x);
          const nl = { ...l, id: uid(), boardId: board.id, arriveLabelIds: relabel(l.arriveLabelIds), newLabelIds: relabel(l.newLabelIds) };
          listMap.set(l.id, nl.id);
          return nl;
        });
      for (const l of lists) {
        if (l.checkedMoveTo) l.checkedMoveTo = listMap.get(l.checkedMoveTo) ?? null;
        if (l.lateMoveTo) l.lateMoveTo = listMap.get(l.lateMoveTo) ?? null;
      }
      const srcCards = Object.values(d.cards).filter((c) => opts?.withCards !== false && c.boardId === id && listMap.has(c.listId));
      const cardMap = new Map(srcCards.map((c) => [c.id, uid()]));
      // Sub-tasks and links between cards of this board point at the copies; links to other boards stay.
      const remap = (cid: ID) => cardMap.get(cid) ?? cid;
      const cards = srcCards.map((c) => ({
        ...structuredClone(c),
        id: cardMap.get(c.id)!,
        boardId: board.id,
        listId: listMap.get(c.listId)!,
        labelIds: c.labelIds.map((l) => labelMap.get(l)).filter((x): x is ID => !!x),
        checklist: c.checklist.map((i) => ({ ...i, id: uid(), cardId: i.cardId ? remap(i.cardId) : i.cardId })),
        links: c.links.filter((l) => cardMap.has(l.cardId)).map((l) => ({ ...l, cardId: remap(l.cardId) })),
        time: [],
        reminder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
      mut((d) => ({
        ...d,
        boards: { ...d.boards, [board.id]: board },
        lists: { ...d.lists, ...Object.fromEntries(lists.map((l) => [l.id, l])) },
        cards: { ...d.cards, ...Object.fromEntries(cards.map((c) => [c.id, c])) },
      }));
      return board.id;
    },

    createList(boardId, title) {
      const siblings = Object.values(get().data.lists).filter((l) => l.boardId === boardId);
      const list = newList(boardId, title, Math.max(-1, ...siblings.map((l) => l.order)) + 1);
      mut((d) => ({ ...d, lists: { ...d.lists, [list.id]: list } }));
      return list.id;
    },
    updateList(id, patch) {
      mut((d) => ({ ...d, lists: { ...d.lists, [id]: { ...d.lists[id], ...patch } } }));
    },
    deleteList(id) {
      mut((d) => {
        const { [id]: _, ...lists } = d.lists;
        return { ...d, lists, cards: pruneRefs(Object.fromEntries(Object.entries(d.cards).filter(([, c]) => c.listId !== id))) };
      });
    },
    reorderLists(ids) {
      mut((d) => {
        const lists = { ...d.lists };
        ids.forEach((id, i) => (lists[id] = { ...lists[id], order: i }));
        return { ...d, lists };
      });
    },

    createCard(listId, title, extra) {
      let d = get().data;
      const list = d.lists[listId];
      const siblings = Object.values(d.cards).filter((c) => c.listId === listId);
      // A bucket rule can start every new card from a template (unless this card already comes from one).
      const template = !fromTemplate && list.newTemplateId ? d.templates.find((t) => t.id === list.newTemplateId) : undefined;
      const fromT = template ? templateCard(template, list.boardId) : {};
      d = get().data;
      const card = newCard(list.boardId, listId, title.trim() || template?.title || title, Math.max(-1, ...siblings.map((c) => c.order)) + 1, {
        activity: [{ at: Date.now(), kind: "created" }],
        ...fromT,
        ...(list.autoProgress ? { progress: list.autoProgress } : {}),
        ...(list.newPriority ? { priority: list.newPriority } : {}),
        ...extra,
      });
      Object.assign(card, arrivalRules(list, card));
      card.labelIds = withLabels(d, list.boardId, card.labelIds, [...(list.newLabelIds ?? []), ...(list.arriveLabelIds ?? [])]);
      if (card.progress === "completed") card.completedAt = Date.now();
      mut((d) => ({ ...d, cards: { ...d.cards, [card.id]: card } }));
      return card.id;
    },
    updateCard(id, patch) {
      const before = get().data.cards;
      mut((d) => ({ ...d, cards: checklistRules(d, d.cards, patchCard(d.cards, id, arrive(d, id, patch))) }));
      // Finishing a card that others wait on: say which ones can start now.
      const after = get().data.cards;
      if (before[id]?.progress !== "completed" && after[id]?.progress === "completed") {
        const freed = freedBy(id, before, after);
        if (freed.length)
          get().toast(freed.length === 1 ? `No longer blocked: ${freed[0].title}` : `${freed.length} tasks are no longer blocked`, { key: "unblocked" });
      }
    },
    deleteCard(id) {
      mut((d) => {
        const { [id]: _, ...cards } = d.cards;
        return { ...d, cards: pruneRefs(cards) };
      });
      if (get().openCardId === id) set({ openCardId: null });
    },
    duplicateCard(id) {
      const src = get().data.cards[id];
      const card: Card = {
        ...structuredClone(src),
        id: uid(),
        title: `${src.title} (copy)`,
        order: src.order + 0.5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checklist: src.checklist.map((i) => ({ ...i, id: uid() })),
        links: [],
        time: [],
        reminder: null,
        activity: [{ at: Date.now(), kind: "created" }],
      };
      mut((d) => ({ ...d, cards: { ...d.cards, [card.id]: card } }));
      return card.id;
    },
    moveCardToBoard(id, boardId, listId) {
      mut((d) => {
        const c = d.cards[id];
        // Carry labels across by matching name; drop ones the target board lacks.
        const srcLabels = d.boards[c.boardId].labels;
        const dstLabels = d.boards[boardId].labels;
        const labelIds = c.labelIds
          .map((lid) => srcLabels.find((l) => l.id === lid)?.name)
          .map((name) => dstLabels.find((l) => l.name === name)?.id)
          .filter((x): x is ID => !!x);
        const order = Math.max(-1, ...Object.values(d.cards).filter((x) => x.listId === listId).map((x) => x.order)) + 1;
        // Custom fields carry over when the target board has a field with the same name and type.
        const fields: Card["fields"] = {};
        for (const f of d.boards[c.boardId].fields) {
          const match = d.boards[boardId].fields.find((g) => g.name === f.name && g.type === f.type);
          if (!match || c.fields[f.id] == null) continue;
          let v = c.fields[f.id];
          if (f.type === "select") v = match.options.find((o) => o.label === f.options.find((x) => x.id === v)?.label)?.id ?? null;
          fields[match.id] = v;
        }
        return { ...d, cards: patchCard(d.cards, id, arrive(d, id, { boardId, listId, labelIds, order, fields })) };
      });
    },
    moveCardToList(id, listId) {
      const d = get().data;
      if (d.cards[id].listId === listId) return;
      const order = Math.max(-1, ...Object.values(d.cards).filter((x) => x.listId === listId).map((x) => x.order)) + 1;
      get().updateCard(id, { listId, order });
    },
    resetTime(cardId) {
      get().updateCard(cardId, { time: [] });
    },
    applyLinkOps(ops) {
      // Like any change made here (so it's saved, and Undo works), on top of whatever is on screen.
      mut((d) => rebaseSnapshot(d, ops));
      const st = get();
      if (st.openCardId && !st.data.cards[st.openCardId]) set({ openCardId: null });
      if (st.route.page === "board" && !st.data.boards[st.route.boardId]) set({ route: { page: "home" } });
    },
    deviceOffline: false,
    addBoardBundle({ board, lists, cards, people }) {
      mut((d) => ({
        ...d,
        boards: { ...d.boards, [board.id]: board },
        lists: { ...d.lists, ...Object.fromEntries(lists.map((l) => [l.id, l])) },
        cards: { ...d.cards, ...Object.fromEntries(cards.map((c) => [c.id, c])) },
        settings: { ...d.settings, people: [...new Set([...d.settings.people, ...people])] },
      }));
    },
    addArrivedCards({ board: src, lists: srcLists, cards, people }, into) {
      let n = 0;
      mut((d) => {
        const dst = d.boards[into];
        const dstLists = Object.values(d.lists).filter((l) => l.boardId === into && !l.archived).sort(byOrder);
        if (!dst || !dstLists.length) return d;
        const labels = [...dst.labels];
        const labelFor = (lid: ID) => {
          const l = src.labels.find((x) => x.id === lid);
          if (!l) return null;
          let m = labels.find((x) => x.name === l.name);
          if (!m) labels.push((m = { id: uid(), name: l.name, color: l.color }));
          return m.id;
        };
        const listFor = (lid: ID) => {
          const name = srcLists.find((l) => l.id === lid)?.title;
          return (dstLists.find((l) => l.title === name) ?? dstLists[0]).id;
        };
        const fieldsFor = (c: Card) => {
          const out: Card["fields"] = {};
          for (const f of src.fields ?? []) {
            const match = dst.fields.find((g) => g.name === f.name && g.type === f.type);
            if (!match || c.fields[f.id] == null) continue;
            let v = c.fields[f.id];
            if (f.type === "select") v = match.options.find((o) => o.label === f.options.find((x) => x.id === v)?.label)?.id ?? null;
            out[match.id] = v;
          }
          return out;
        };
        const next: Record<ID, Card> = {};
        const top = (listId: ID) =>
          Math.max(-1, ...Object.values(d.cards).filter((x) => x.listId === listId).map((x) => x.order), ...Object.values(next).filter((x) => x.listId === listId).map((x) => x.order));
        for (const c of [...cards].sort(byOrder)) {
          const listId = listFor(c.listId);
          next[c.id] = {
            ...c,
            boardId: into,
            listId,
            order: top(listId) + 1,
            labelIds: c.labelIds.map(labelFor).filter((x): x is ID => !!x),
            fields: fieldsFor(c),
          };
        }
        n = cards.length;
        return {
          ...d,
          boards: { ...d.boards, [into]: { ...dst, labels } },
          cards: { ...d.cards, ...next },
          settings: { ...d.settings, people: [...new Set([...d.settings.people, ...people])] },
        };
      });
      return n;
    },
    restoreBoards(part) {
      let n = 0;
      mut((d) => {
        const add = Object.values(part.boards ?? {}).filter((b) => !d.boards[b.id]);
        n = add.length;
        if (!n) return d;
        const ids = new Set(add.map((b) => b.id));
        const pick = <T extends { boardId: ID }>(m: Record<ID, T> | undefined) =>
          Object.fromEntries(Object.entries(m ?? {}).filter(([, x]) => ids.has(x.boardId)));
        return {
          ...d,
          boards: { ...d.boards, ...Object.fromEntries(add.map((b) => [b.id, b])) },
          lists: { ...d.lists, ...pick(part.lists) },
          cards: { ...d.cards, ...pick(part.cards) },
          ui: { ...d.ui, ...Object.fromEntries(Object.entries(part.ui ?? {}).filter(([id]) => ids.has(id))) },
        };
      });
      return n;
    },
    importBoard(b, opts) {
      const st = get();
      const order = Math.max(-1, ...Object.values(st.data.boards).map((x) => x.order)) + 1;
      const board = newBoard(b.title, b.color ?? PALETTE[order % PALETTE.length], order);
      board.labels = b.labels.map((l) => ({ id: uid(), name: l.name, color: l.color }));
      const labelId = (name: string) => board.labels.find((l) => l.name === name)?.id;
      const lists = b.lists.map((l, i) => ({ ...newList(board.id, l.name, i), archived: !!l.archived }));
      const cards: Card[] = [];
      b.lists.forEach((l, li) =>
        l.cards.forEach((c, ci) => {
          const card = newCard(board.id, lists[li].id, c.title, ci, {
            description: c.description ?? "",
            labelIds: (c.labels ?? []).map(labelId).filter((x): x is ID => !!x),
            priority: c.priority ?? "medium",
            progress: c.progress ?? "notStarted",
            startDate: c.startDate ?? null,
            dueDate: c.dueDate ?? null,
            assignees: c.assignees ?? [],
            archived: !!c.archived,
            checklist: (c.checklist ?? []).map((i) => ({ id: uid(), text: i.text, done: i.done })),
            comments: (c.comments ?? []).map((n) => ({ id: uid(), text: n.text, createdAt: n.at })),
            attachments: (c.links ?? []).map((a) => ({ id: uid(), name: a.name, url: a.url, addedAt: Date.now() })),
            cover: c.cover ?? null,
            activity: [{ at: Date.now(), kind: "created" }],
          });
          if (card.progress === "completed") card.completedAt = c.completedAt ?? Date.now();
          cards.push(card);
        }),
      );
      const people = opts.addPeople
        ? [...st.data.settings.people, ...b.people.filter((p) => !st.data.settings.people.includes(p))]
        : st.data.settings.people;
      mut((d) => ({
        ...d,
        boards: { ...d.boards, [board.id]: board },
        lists: { ...d.lists, ...Object.fromEntries(lists.map((l) => [l.id, l])) },
        cards: { ...d.cards, ...Object.fromEntries(cards.map((c) => [c.id, c])) },
        settings: { ...d.settings, people },
      }));
      return board.id;
    },

    startFocus(minutes, cardId = null, label) {
      const durationMs = Math.round(minutes * 60_000);
      const card = cardId ? get().data.cards[cardId] : undefined;
      set({ focus: { cardId, label: label ?? card?.title ?? "Focus", durationMs, endsAt: Date.now() + durationMs, remainingMs: durationMs } });
      if (cardId && !card?.time.some((t) => t.end === null)) get().startTimer(cardId);
    },
    pauseFocus() {
      const f = get().focus;
      if (!f?.endsAt) return;
      set({ focus: { ...f, endsAt: null, remainingMs: Math.max(0, f.endsAt - Date.now()) } });
      if (f.cardId) get().stopTimer();
    },
    resumeFocus() {
      const f = get().focus;
      if (!f || f.endsAt) return;
      set({ focus: { ...f, endsAt: Date.now() + f.remainingMs } });
      if (f.cardId && get().data.cards[f.cardId]) get().startTimer(f.cardId);
    },
    extendFocus(minutes) {
      const f = get().focus;
      if (!f) return;
      const add = minutes * 60_000;
      set({
        focus: { ...f, durationMs: f.durationMs + add, ...(f.endsAt ? { endsAt: f.endsAt + add } : { remainingMs: f.remainingMs + add }) },
      });
    },
    endFocus(completed) {
      const f = get().focus;
      if (!f) return;
      set({ focus: null });
      if (f.cardId && get().data.cards[f.cardId]?.time.some((t) => t.end === null)) get().stopTimer();
      if (completed) get().toast(`Time's up: ${f.label}`);
    },
    applyCardOrder(ids, movedId, patch) {
      mut((d) => {
        const cards = { ...d.cards };
        ids.forEach((id, i) => {
          if (cards[id].order !== i) cards[id] = { ...cards[id], order: i };
        });
        return { ...d, cards: patchCard(cards, movedId, arrive(d, movedId, patch)) };
      });
    },
    linkCards(a, b, type) {
      if (a === b) return;
      const loop = blockLoopReason(a, b, type, get().data.cards);
      if (loop) return get().toast(`Can't link: ${loop}.`);
      mut((d) => {
        const ca = d.cards[a], cb = d.cards[b];
        if (!ca || !cb) return d;
        return {
          ...d,
          cards: {
            ...d.cards,
            [a]: { ...ca, links: [...ca.links.filter((l) => l.cardId !== b), { cardId: b, type }] },
            [b]: { ...cb, links: [...cb.links.filter((l) => l.cardId !== a), { cardId: a, type: inverseLink(type) }] },
          },
        };
      });
    },
    unlinkCards(a, b) {
      mut((d) => {
        const cards = { ...d.cards };
        if (cards[a]) cards[a] = { ...cards[a], links: cards[a].links.filter((l) => l.cardId !== b) };
        if (cards[b]) cards[b] = { ...cards[b], links: cards[b].links.filter((l) => l.cardId !== a) };
        return { ...d, cards };
      });
    },
    linkChecklistItem(cardId, itemId, target) {
      const c = get().data.cards[cardId];
      if (target) {
        const loop = subtaskLoopReason(cardId, target, get().data.cards);
        if (loop) return get().toast(`Can't link: ${loop}.`);
      }
      const t = target ? get().data.cards[target] : null;
      get().updateCard(cardId, {
        checklist: c.checklist.map((i) =>
          i.id === itemId ? { ...i, cardId: target, text: t ? t.title : i.text, done: t ? t.progress === "completed" : i.done } : i,
        ),
      });
    },
    spinOffChecklistItem(cardId, itemId, listId) {
      const c = get().data.cards[cardId];
      const item = c.checklist.find((i) => i.id === itemId)!;
      // Carry the item's labels over (matched by name if the new task is on another board).
      const d = get().data;
      const srcLabels = d.boards[c.boardId].labels;
      const dst = d.boards[d.lists[listId].boardId];
      const labelIds = (item.labelIds ?? [])
        .map((id) => srcLabels.find((l) => l.id === id)?.name)
        .map((name) => dst.labels.find((l) => l.name === name)?.id)
        .filter((x): x is ID => !!x);
      const newId = get().createCard(listId, item.text, { labelIds, ...(item.done ? { progress: "completed" } : {}) });
      get().linkChecklistItem(cardId, itemId, newId);
      return newId;
    },
    addToParent(parentId, childId) {
      const d = get().data;
      const loop = subtaskLoopReason(parentId, childId, d.cards);
      if (loop) return get().toast(`Can't add: ${loop}.`);
      const child = d.cards[childId];
      get().updateCard(parentId, {
        checklist: [
          ...d.cards[parentId].checklist,
          { id: uid(), text: child.title, cardId: childId, done: child.progress === "completed" },
        ],
      });
    },
    removeFromParent(parentId, childId) {
      const p = get().data.cards[parentId];
      if (p) get().updateCard(parentId, { checklist: p.checklist.filter((i) => i.cardId !== childId) });
    },
    toggleChecklistItem(cardId, itemId) {
      const d = get().data;
      const item = d.cards[cardId].checklist.find((i) => i.id === itemId);
      if (!item) return;
      const target = item.cardId ? d.cards[item.cardId] : null;
      if (target) get().updateCard(target.id, { progress: target.progress === "completed" ? "notStarted" : "completed" });
      else
        get().updateCard(cardId, {
          checklist: d.cards[cardId].checklist.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
        });
    },

    startTimer(cardId) {
      const now = Date.now();
      mut((d) => {
        const cards = { ...d.cards };
        // Only one timer runs at a time.
        for (const c of Object.values(cards))
          if (c.time.some((t) => t.end === null))
            cards[c.id] = { ...c, time: c.time.map((t) => (t.end === null ? { ...t, end: now } : t)) };
        const c = cards[cardId];
        const starts = c.progress === "notStarted";
        cards[cardId] = {
          ...c,
          time: [...c.time, { id: uid(), start: now, end: null }],
          progress: starts ? "inProgress" : c.progress,
          activity: starts ? [...c.activity, { at: now, kind: "progress", from: c.progress, to: "inProgress" }] : c.activity,
        };
        return { ...d, cards };
      });
    },
    stopTimer() {
      const now = Date.now();
      mut((d) => {
        const cards = { ...d.cards };
        for (const c of Object.values(cards))
          if (c.time.some((t) => t.end === null))
            cards[c.id] = { ...c, time: c.time.map((t) => (t.end === null ? { ...t, end: now } : t)) };
        return { ...d, cards };
      });
    },
    addTime(cardId, minutes) {
      const end = Date.now();
      const c = get().data.cards[cardId];
      get().updateCard(cardId, { time: [...c.time, { id: uid(), start: end - minutes * 60_000, end }] });
    },
    deleteTimeEntry(cardId, entryId) {
      const c = get().data.cards[cardId];
      get().updateCard(cardId, { time: c.time.filter((t) => t.id !== entryId) });
    },

    saveTemplate(cardId, name) {
      const d = get().data;
      const c = d.cards[cardId];
      const labels = d.boards[c.boardId].labels.filter((l) => c.labelIds.includes(l.id));
      const t: CardTemplate = {
        id: uid(),
        name,
        createdAt: Date.now(),
        title: c.title,
        description: c.description,
        checklist: c.checklist.map((i) => i.text),
        labels: labels.map(({ name, color }) => ({ name, color })),
        priority: c.priority,
        assignees: c.assignees,
        recurrence: c.recurrence,
        cover: c.cover,
        estimate: c.estimate,
      };
      mut((d) => ({ ...d, templates: [...d.templates, t] }));
    },
    updateTemplate(id, patch) {
      mut((d) => ({ ...d, templates: d.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    },
    deleteTemplate(id) {
      mut((d) => ({ ...d, templates: d.templates.filter((t) => t.id !== id) }));
    },
    saveBoardTemplate(boardId, name) {
      const t = boardAsTemplate(get().data, boardId, name);
      mut((d) => ({ ...d, boardTemplates: [...d.boardTemplates, t] }));
    },
    renameBoardTemplate(id, name) {
      mut((d) => ({ ...d, boardTemplates: d.boardTemplates.map((t) => (t.id === id ? { ...t, name } : t)) }));
    },
    deleteBoardTemplate(id) {
      mut((d) => ({ ...d, boardTemplates: d.boardTemplates.filter((t) => t.id !== id) }));
    },
    sweepRules(now = Date.now()) {
      const d = get().data;
      let cards = d.cards;
      let n = 0;
      for (const c of Object.values(d.cards)) {
        if (c.archived || c.skipRules) continue;
        const list = d.lists[c.listId];
        const days = list?.archiveAfterDays;
        if (list && days != null && c.progress === "completed" && now - (c.completedAt ?? c.updatedAt) >= days * DAY_MS) {
          tagRule(c.id, list.id, "archived");
          cards = patchCard(cards, c.id, { archived: true });
          n++;
          continue;
        }
        const late = latePatch(d, cards, c);
        if (Object.keys(late).length) {
          cards = patchCard(cards, c.id, arrive({ ...d, cards }, c.id, late));
          n++;
        }
      }
      // Housekeeping, not something you did: saved, but not an Undo step.
      if (n) set({ data: { ...d, cards } });
      return n;
    },
    applyBucketRules(listId) {
      let n = 0;
      mut((d) => {
        const list = d.lists[listId];
        if (!list) return d;
        let cards = d.cards;
        for (const c of Object.values(d.cards)) {
          if (c.listId !== listId || c.archived || c.skipRules) continue;
          let patch = bucketRules({ ...d, cards }, c, list, {}, false);
          patch = { ...patch, ...checklistPatch(d, cards, { ...c, ...patch }) };
          if (!patch.listId) patch = { ...patch, ...latePatch(d, cards, { ...c, ...patch }) };
          if (!Object.keys(patch).length) continue;
          cards = patchCard(cards, c.id, arrive({ ...d, cards }, c.id, patch));
          n++;
        }
        return n ? { ...d, cards: checklistRules(d, d.cards, cards) } : d;
      });
      return n;
    },
    createFromTemplate(templateId, listId, extra) {
      const t = get().data.templates.find((x) => x.id === templateId)!;
      fromTemplate = true;
      try {
        return get().createCard(listId, t.title, { ...templateCard(t, get().data.lists[listId].boardId), ...extra });
      } finally {
        fromTemplate = false;
      }
    },

    setBoardUi(boardId, patch) {
      mut((d) => ({ ...d, ui: { ...d.ui, [boardId]: { ...(d.ui[boardId] ?? defaultUi(d.settings.defaultView)), ...patch } } }));
    },
    setFilter(boardId, patch) {
      const cur = get().data.ui[boardId] ?? defaultUi();
      get().setBoardUi(boardId, { filter: { ...cur.filter, ...patch } });
    },
    saveFilter(boardId, name, filter) {
      mut((d) => ({ ...d, savedFilters: [...d.savedFilters, { id: uid(), name, boardId, filter }] }));
    },
    deleteSavedFilter(id) {
      mut((d) => ({ ...d, savedFilters: d.savedFilters.filter((f) => f.id !== id) }));
    },
    updateSettings(patch) {
      // On your computer's boards in the phone app, the look you change is the phone's.
      noteLookPatch(patch, get().data.settings);
      mut((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    },
    setBoardCategory(boardId, category) {
      const c = category?.trim() || null;
      mut((d) => (d.boards[boardId] ? { ...d, boards: { ...d.boards, [boardId]: { ...d.boards[boardId], category: c } } } : d));
    },
    renameCategory(from, to) {
      to = to.trim();
      if (!to || to === from) return;
      mut((d) => {
        const boards = { ...d.boards };
        for (const b of Object.values(boards)) if (b.category === from) boards[b.id] = { ...b, category: to };
        const collapsed = d.settings.collapsedCategories.map((x) => (x === from ? to : x));
        const sections = (d.settings.sections ?? []).map((x) => (x === from ? to : x));
        return { ...d, boards, settings: { ...d.settings, collapsedCategories: [...new Set(collapsed)], sections: [...new Set(sections)] } };
      });
    },
    removeCategory(name) {
      mut((d) => {
        const boards = { ...d.boards };
        for (const b of Object.values(boards)) if (b.category === name) boards[b.id] = { ...b, category: null };
        return {
          ...d,
          boards,
          settings: {
            ...d.settings,
            collapsedCategories: d.settings.collapsedCategories.filter((x) => x !== name),
            sections: (d.settings.sections ?? []).filter((x) => x !== name),
          },
        };
      });
    },
    addCategory(name) {
      const n = name.trim();
      const cur = get().data.settings.sections ?? [];
      if (n && !cur.includes(n)) get().updateSettings({ sections: [...cur, n] });
    },
    toggleCategoryCollapsed(name) {
      const cur = get().data.settings.collapsedCategories;
      get().updateSettings({ collapsedCategories: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] });
    },
    renamePerson(from, to) {
      to = to.trim();
      if (!to || to === from) return;
      mut((d) => {
        const cards = { ...d.cards };
        for (const c of Object.values(cards))
          if (c.assignees.includes(from))
            cards[c.id] = { ...c, assignees: [...new Set(c.assignees.map((a) => (a === from ? to : a)))] };
        const people = [...new Set(d.settings.people.map((p) => (p === from ? to : p)))];
        return { ...d, cards, settings: { ...d.settings, people, me: d.settings.me === from ? to : d.settings.me } };
      });
    },
  };
});

// ---- Autosave: debounce writes whenever `data` changes after the initial load ----
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: AppData | null = null;
let saving = false;
/** The data as last loaded, saved or adopted from elsewhere. */
let lastJson: string | null = null;

async function flush() {
  if (!pending) return;
  if (saving) {
    // A save is in flight: go again once it's done.
    clearTimeout(timer);
    timer = setTimeout(flush, 200);
    return;
  }
  const snapshot = pending;
  pending = null;
  saving = true;
  try {
    if (isDeviceWindow) {
      // A phone's boards on this computer: what changed goes to the phone.
      await sendDeviceChanges(snapshot);
    } else if (isServer) {
      // Only what changed goes to the server (with its own look, not the phone's).
      await pushChanges(withPlaceLook(snapshot));
    } else {
      const json = JSON.stringify(withPlaceLook(snapshot));
      await saveRaw(json);
      lastJson = json;
      void broadcastData(json);
    }
    if (useStore.getState().saveError) useStore.setState({ saveError: null });
  } catch (e) {
    useStore.setState({ saveError: String(e) });
    // Keep it and try again (e.g. a phone that briefly lost Wi‑Fi), unless something newer is queued.
    pending ??= snapshot;
    clearTimeout(timer);
    timer = setTimeout(flush, 3000);
  } finally {
    saving = false;
  }
}

useStore.subscribe((s, prev) => {
  if (applyingRemote) return;
  if (!s.loaded || s.data === prev.data || !prev.loaded) {
    // The very first load also counts as a change worth saving (writes the sample board).
    if (s.loaded && !prev.loaded && !isExtraWindow && !isRemote) {
      pending = s.data;
      void flush();
    }
    return;
  }
  pending = s.data;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
});

/** Save right away and wait for it (before leaving the page on purpose). */
export async function saveNow(): Promise<void> {
  clearTimeout(timer);
  for (let i = 0; i < 100 && (pending || saving); i++) {
    if (saving) await new Promise((r) => setTimeout(r, 100));
    else await flush();
  }
  if (useStore.getState().saveError) throw new Error(useStore.getState().saveError!);
}

window.addEventListener("beforeunload", () => void flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush();
});

// ---- Selectors ----
export const useBoardUi = (boardId: ID) => {
  const ui = useStore((s) => s.data.ui[boardId]);
  const view = useStore((s) => s.data.settings.defaultView);
  return ui ?? defaultUi(view);
};

/** The card whose timer is running, if any. */
export const runningTimer = (cards: Record<ID, Card>) => {
  for (const c of Object.values(cards)) {
    const t = c.time.find((e) => e.end === null);
    if (t) return { card: c, entry: t };
  }
  return null;
};

useStore.subscribe((s, prev) => {
  if (s.focus === prev.focus) return;
  try {
    if (s.focus) localStorage.setItem(FOCUS_KEY, JSON.stringify(s.focus));
    else localStorage.removeItem(FOCUS_KEY);
  } catch {
    /* not critical */
  }
});
