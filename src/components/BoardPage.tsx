import { Fragment, useEffect, useMemo, useState } from "react";
import { exportBoard } from "../boardFile";
import { isMobileApp } from "../storage";
import { archiveBoard, deleteBoard as deleteBoardAction } from "../actions";
import { canEditBoard, isServer, leaveBoard, ownsBoard } from "../server";
import {
  Archive,
  BarChart3,
  Bookmark,
  CalendarDays,
  Copy,
  Filter as FilterIcon,
  GitFork,
  GanttChart,
  Kanban,
  MoreHorizontal,
  AppWindow,
  Bot,
  ClipboardCopy,
  LayoutTemplate,
  Palette,
  Plus,
  Rows3,
  Search,
  Star,
  Tag,
  Trash2,
  Users,
  LogOut,
  ArrowRightLeft,
  CircleDot,
  Eye,
  Flag,
  Sun,
  X, FileDown, ClipboardPaste, Zap, ZapOff, SlidersHorizontal, AlertTriangle, CalendarClock } from "lucide-react";
import type { Board, Card, DueFilter, FieldDef, FieldValue, Filter, GroupBy, ID, ViewMode } from "../types";
import { useBoardUi, useStore } from "../store";
import { addDays, format, nextMonday, parseISO } from "date-fns";
import { byOrder, emptyFilter, filterChoiceCount, filterIsActive, isLate, matchesFilter, todayISO, PALETTE, PRIORITIES, PROGRESS, relatedSet, toISO, uid } from "../utils";
import { ask, Avatar, ColorPicker, InlineEdit, MenuItem, Popover } from "./ui";
import { KanbanView } from "./views/KanbanView";
import { BucketPicker, LabelPicker } from "./pickers";
import { featureOn, useFeature, viewShown } from "../features";
import { ListView } from "./views/ListView";
import { CalendarView } from "./views/CalendarView";
import { TimelineView } from "./views/TimelineView";
import { ChartsView } from "./views/ChartsView";
import { copyText } from "./Markdown";
import { workOrder } from "../ai";
import { parsePastedCards } from "../cardClipboard";
import { isBoardWindow, openBoardWindow } from "../windows";
import { boardBackground } from "./BoardCustomize";
import { okToComplete } from "../blocked";

const VIEWS: { id: ViewMode; name: string; icon: React.ReactNode }[] = [
  { id: "board", name: "Board", icon: <Kanban size={15} /> },
  { id: "list", name: "List", icon: <Rows3 size={15} /> },
  { id: "calendar", name: "Calendar", icon: <CalendarDays size={15} /> },
  { id: "timeline", name: "Timeline", icon: <GanttChart size={15} /> },
  { id: "charts", name: "Charts", icon: <BarChart3 size={15} /> },
];
const GROUPS: { id: GroupBy; name: string }[] = [
  { id: "bucket", name: "Bucket" },
  { id: "progress", name: "Progress" },
  { id: "priority", name: "Priority" },
  { id: "assignee", name: "Assigned to" },
  { id: "label", name: "Label" },
  { id: "due", name: "Due date" },
];

export function BoardPage({ boardId }: { boardId: ID }) {
  const board = useStore((s) => s.data.boards[boardId]);
  const allLists = useStore((s) => s.data.lists);
  const allCards = useStore((s) => s.data.cards);
  const people = useStore((s) => s.data.settings.people);
  const features = useStore((s) => s.data.settings.features);
  const ui = useBoardUi(boardId);

  // Pasting copied cards anywhere on the board (not into a text box) offers to add them.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const st = useStore.getState();
      if (st.openCardId || st.pasteCards) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      try {
        if (!parsePastedCards(text).length) return;
      } catch {
        return;
      }
      e.preventDefault();
      st.setOverlay({ pasteCards: { boardId, text } });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [boardId]);

  const lists = useMemo(
    () => Object.values(allLists).filter((l) => l.boardId === boardId && !l.archived).sort(byOrder),
    [allLists, boardId],
  );
  const cards = useMemo(() => {
    const live = new Set(lists.map((l) => l.id));
    const related = ui.filter.relatedTo ? relatedSet(ui.filter.relatedTo, allCards, ui.filter.relatedDeep) : null;
    return Object.values(allCards).filter(
      (c) =>
        c.boardId === boardId && !c.archived && live.has(c.listId) && matchesFilter(c, ui.filter, allCards) && (!related || related.has(c.id)),
    );
  }, [allCards, lists, boardId, ui.filter]);

  if (!board) return null;
  // A view whose feature group is off (Settings > Features) falls back to the board.
  const view = viewShown({ features }, ui.view) ? ui.view : "board";
  const shownUi = view === ui.view ? ui : { ...ui, view };

  return (
    <div
      className={`board-page ${board.background.type !== "none" ? "has-bg" : ""} cols-${board.display.columnWidth}`}
      style={{ "--board": board.color, "--board-bg": boardBackground(board) } as React.CSSProperties}
    >
      <BoardHeader board={board} view={view} />
      <Toolbar board={board} ui={shownUi} people={people} count={cards.length} />
      <div className="board-stage">
      {board.background.type !== "none" && (
        <div
          className="board-bg"
          aria-hidden="true"
          style={{
            filter: board.backgroundFx.blur ? `blur(${board.backgroundFx.blur}px)` : undefined,
            // Blurring softens the edges; scale up slightly so they stay off-screen.
            transform: board.backgroundFx.blur ? `scale(${1 + board.backgroundFx.blur / 200})` : undefined,
            "--dim": board.backgroundFx.dim / 100,
          } as React.CSSProperties}
        />
      )}
      <div
        className="board-content"
        onClick={(e) => {
          // A click on empty board space ends picking cards.
          const t = e.target as Element;
          if (useStore.getState().selected.length && !t.closest(".card-tile, button, a, input, select, textarea, label, [contenteditable], .popover, .ctx-menu, .modal"))
            useStore.getState().clearSelected();
        }}
      >
        {view === "board" && <KanbanView board={board} lists={lists} cards={cards} groupBy={ui.groupBy} />}
        {view === "list" && <ListView board={board} lists={lists} cards={cards} />}
        {view === "calendar" && <CalendarView board={board} lists={lists} cards={cards} />}
        {view === "timeline" && <TimelineView lists={lists} cards={cards} />}
        {view === "charts" && <ChartsView lists={lists} cards={cards} people={people} />}
      </div>
      </div>
      <SelectionBar boardId={boardId} />
    </div>
  );
}

function BoardHeader({ board, view }: { board: Board; view: ViewMode }) {
  const features = useStore((s) => s.data.settings.features);
  const ai = featureOn({ features }, "ai");
  const { updateBoard, duplicateBoard, navigate, setBoardUi } = useStore.getState();
  const canEdit = canEditBoard(board);
  return (
    <header className="board-header">
      {board.icon ? <span className="board-icon">{board.icon}</span> : <span className="board-swatch" style={{ background: board.color }} />}
      <span className="board-title-wrap" title={board.title}>
        {canEdit ? (
          <InlineEdit className="board-title" value={board.title} onSave={(title) => updateBoard(board.id, { title })} />
        ) : (
          <span className="board-title">{board.title}</span>
        )}
      </span>
      {!canEdit && (
        <span className="chip small" title="This board is shared with you to look at. Ask its owner for edit access.">
          <Eye size={12} /> View only
        </span>
      )}
      {canEdit && (
        <button
          className={`icon-btn ${board.starred ? "starred" : ""}`}
          title={board.starred ? "Unstar" : "Star"}
          onClick={() => updateBoard(board.id, { starred: !board.starred })}
        >
          <Star size={17} fill={board.starred ? "currentColor" : "none"} />
        </button>
      )}
      <nav className="view-tabs" aria-label="Board views">
        {VIEWS.map((v, i) => viewShown({ features }, v.id) && (
          <button
            key={v.id}
            className={view === v.id ? "active" : ""}
            onClick={() => setBoardUi(board.id, { view: v.id })}
            title={`${v.name} (${i + 1})`}
            aria-label={v.name}
            aria-pressed={view === v.id}
          >
            {v.icon}
            <span className="tab-label">{v.name}</span>
          </button>
        ))}
      </nav>
      <div className="grow" />
      <LabelManager board={board} />
      <button className="btn ghost sm" title="Customize (B)" aria-label="Customize" onClick={() => useStore.getState().setOverlay({ customizeBoardId: board.id })}>
        <Palette size={14} /> <span className="btn-label">Customize</span>
      </button>
      <Popover
        align="right"
        trigger={(_, toggle) => (
          <button className="icon-btn" onClick={toggle} title="Board menu">
            <MoreHorizontal size={18} />
          </button>
        )}
      >
        {(close) => (
          <div className="menu" style={{ width: 250 }}>
            <MenuItem
              icon={<Palette size={14} />}
              onClick={() => {
                close();
                useStore.getState().setOverlay({ customizeBoardId: board.id });
              }}
            >
              Customize board…
            </MenuItem>
            {isServer && (
              <MenuItem
                icon={<Users size={14} />}
                onClick={() => {
                  close();
                  useStore.getState().setOverlay({ shareBoardId: board.id });
                }}
              >
                {ownsBoard(board) ? "Share…" : "People on this board…"}
              </MenuItem>
            )}
            <MenuItem icon={<Copy size={14} />} onClick={() => (close(), navigate({ page: "board", boardId: duplicateBoard(board.id) }))}>
              Duplicate board
            </MenuItem>
            {!isBoardWindow && !isMobileApp && (
              <MenuItem
                icon={<AppWindow size={14} />}
                onClick={() => {
                  close();
                  void openBoardWindow(board.id, board.title);
                }}
              >
                Open in new window
              </MenuItem>
            )}
            {ai && (
              <>
                <MenuItem
                  icon={<Bot size={14} />}
                  onClick={() => {
                    close();
                    useStore.getState().setOverlay({ aiDialog: { tab: "ask", mode: "cards", boardId: board.id } });
                  }}
                >
                  AI tools (prompts & export)…
                </MenuItem>
                <MenuItem
                  icon={<ClipboardCopy size={14} />}
                  onClick={() => {
                    close();
                    const all = Object.values(useStore.getState().data.cards).filter((c) => c.boardId === board.id);
                    copyText(workOrder(board.id, all, `${board.title}: open items`));
                  }}
                >
                  Copy work order (all open cards)
                </MenuItem>
              </>
            )}
            <MenuItem
              icon={<ClipboardPaste size={14} />}
              onClick={() => {
                close();
                useStore.getState().setOverlay({ pasteCards: { boardId: board.id } });
              }}
            >
              Paste cards…
            </MenuItem>
            <MenuItem
              icon={<LayoutTemplate size={14} />}
              onClick={() => {
                close();
                navigate({
                  page: "board",
                  boardId: duplicateBoard(board.id, { title: `New ${board.title}`, withCards: false }),
                });
              }}
            >
              New board with this layout
            </MenuItem>
            <MenuItem
              icon={<FileDown size={14} />}
              onClick={() => {
                close();
                void exportBoard(board.id);
              }}
            >
              Save as board file…
            </MenuItem>
            {ownsBoard(board) ? (
              <>
                <MenuItem
                  icon={<Archive size={14} />}
                  onClick={() => {
                    close();
                    archiveBoard(board);
                  }}
                >
                  Archive board
                </MenuItem>
                <MenuItem
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    close();
                    void deleteBoardAction(board);
                  }}
                >
                  Delete board
                </MenuItem>
              </>
            ) : (
              <MenuItem
                danger
                icon={<LogOut size={14} />}
                onClick={() => {
                  close();
                  void leaveBoard(board.id).then(() => useStore.getState().toast(`You left “${board.title}”`));
                }}
              >
                Leave board
              </MenuItem>
            )}
          </div>
        )}
      </Popover>
    </header>
  );
}

function LabelManager({ board }: { board: Board }) {
  const updateBoard = useStore((s) => s.updateBoard);
  const setLabels = (labels: Board["labels"]) => updateBoard(board.id, { labels });
  return (
    <Popover
      align="right"
      trigger={(_, toggle) => (
        <button className="btn ghost sm" onClick={toggle} title="Labels" aria-label="Labels">
          <Tag size={14} /> <span className="btn-label">Labels</span>
        </button>
      )}
    >
      {() => (
        <div className="menu label-manager">
          <span className="menu-heading">Board labels</span>
          {board.labels.map((l) => (
            <div key={l.id} className="label-edit-row">
              <Popover
                trigger={(_, toggle) => <button className="swatch" style={{ background: l.color }} onClick={toggle} />}
              >
                {(close) => (
                  <div className="menu">
                    <ColorPicker
                      value={l.color}
                      onChange={(color) => {
                        setLabels(board.labels.map((x) => (x.id === l.id ? { ...x, color: color! } : x)));
                        close();
                      }}
                    />
                  </div>
                )}
              </Popover>
              <input
                value={l.name}
                onChange={(e) => setLabels(board.labels.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))}
              />
              <button
                className="icon-btn tiny"
                title="Delete label"
                onClick={() => {
                  setLabels(board.labels.filter((x) => x.id !== l.id));
                  // Strip it from cards too.
                  const { data, updateCard } = useStore.getState();
                  Object.values(data.cards)
                    .filter((c) => c.boardId === board.id && c.labelIds.includes(l.id))
                    .forEach((c) => updateCard(c.id, { labelIds: c.labelIds.filter((x) => x !== l.id) }));
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            className="menu-item"
            onClick={() =>
              setLabels([...board.labels, { id: uid(), name: "", color: PALETTE[board.labels.length % PALETTE.length] }])
            }
          >
            <Plus size={14} /> <span>Add label</span>
          </button>
        </div>
      )}
    </Popover>
  );
}

function Toolbar({
  board,
  ui,
  people,
  count,
}: {
  board: Board;
  ui: ReturnType<typeof useBoardUi>;
  people: string[];
  count: number;
}) {
  const { setFilter, setBoardUi, saveFilter, deleteSavedFilter } = useStore.getState();
  const saved = useStore((s) => s.data.savedFilters).filter((f) => f.boardId === board.id);
  const f = ui.filter;
  const relatedTitle = useStore((s) => (f.relatedTo ? s.data.cards[f.relatedTo]?.title : undefined));
  const active = filterIsActive(f);
  const nActive = filterChoiceCount(f);
  const linking = useFeature("linking");
  const fieldsOn = useFeature("fields");
  const notLabels = f.notLabelIds ?? [];
  const fieldWant = f.fields ?? {};
  const toggleField = (id: ID, v: string) => {
    const cur = fieldWant[id] ?? [];
    const next = { ...fieldWant, [id]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    if (!next[id].length) delete next[id];
    setFilter(board.id, { fields: next });
  };
  // Boards that have custom fields, when the group is on (or this filter already uses them).
  const filterFields = board.fields.filter((fd) => fieldsOn || fieldWant[fd.id]?.length);
  const [saveName, setSaveName] = useState("");

  const toggle = <K extends keyof Filter>(key: K, v: Filter[K] extends (infer T)[] ? T : never) => {
    const arr = f[key] as unknown[];
    setFilter(board.id, { [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] } as Partial<Filter>);
  };

  return (
    <div className="toolbar">
      <div className="search-box">
        <Search size={15} />
        <input
          placeholder="Filter cards…" spellCheck={false}
          value={f.text}
          onChange={(e) => setFilter(board.id, { text: e.target.value })}
        />
        {f.text && (
          <button className="icon-btn tiny" title="Clear" aria-label="Clear" onClick={() => setFilter(board.id, { text: "" })}>
            <X size={13} />
          </button>
        )}
      </div>

      <DueChips board={board} due={f.due} />

      <Popover
        trigger={(_, t) => (
          <button className={`btn sm ${nActive ? "accent" : "ghost"}`} onClick={t}>
            <FilterIcon size={14} /> <span className="btn-label">Filter</span>{nActive ? ` (${nActive})` : ""}
          </button>
        )}
      >
        {(close) => (
          <div className="menu filter-menu">
            {(saved.length > 0 || active) && (
              <>
                <span className="menu-heading">Saved filters</span>
                {saved.map((s) => (
                  <div key={s.id} className="row">
                    <button
                      className="menu-item grow"
                      onClick={() => {
                        setBoardUi(board.id, { filter: { ...emptyFilter(), ...s.filter } });
                        close();
                      }}
                    >
                      <Bookmark size={14} /> <span>{s.name}</span>
                    </button>
                    <button className="icon-btn tiny" title="Delete this saved filter" onClick={() => deleteSavedFilter(s.id)}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {active && (
                  <form
                    className="row gap-sm pad-sm"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!saveName.trim()) return;
                      saveFilter(board.id, saveName.trim(), f);
                      setSaveName("");
                    }}
                  >
                    <input
                      className="grow"
                      placeholder="Save this filter as…"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                    />
                    <button className="btn sm" type="submit" disabled={!saveName.trim()}>
                      Save
                    </button>
                  </form>
                )}
              </>
            )}
            <span className="menu-heading">Due</span>
            <div className="seg wrap">
              {(
                [
                  ["any", "Any"],
                  ["overdue", "Late"],
                  ["today", "Today"],
                  ["week", "Next 7 days"],
                  ["none", "No date"],
                ] as [DueFilter, string][]
              ).map(([id, name]) => (
                <button key={id} className={f.due === id ? "active" : ""} onClick={() => setFilter(board.id, { due: id })}>
                  {name}
                </button>
              ))}
            </div>
            <span className="menu-heading">Progress</span>
            {PROGRESS.map((p) => (
              <label key={p.id} className="menu-item">
                <input type="checkbox" checked={f.progress.includes(p.id)} onChange={() => toggle("progress", p.id)} />
                <span className="dot" style={{ background: p.color }} />
                <span>{p.name}</span>
              </label>
            ))}
            <span className="menu-heading">Priority</span>
            {PRIORITIES.map((p) => (
              <label key={p.id} className="menu-item">
                <input type="checkbox" checked={f.priorities.includes(p.id)} onChange={() => toggle("priorities", p.id)} />
                <span className="dot" style={{ background: p.color }} />
                <span>{p.name}</span>
              </label>
            ))}
            {(linking || (f.blocked ?? "any") !== "any") && (
              <>
                <span className="menu-heading">Blocked</span>
                <div className="seg wrap">
                  {(
                    [
                      ["any", "Any"],
                      ["blocked", "Blocked"],
                      ["notBlocked", "Not blocked"],
                    ] as const
                  ).map(([id, name]) => (
                    <button key={id} className={(f.blocked ?? "any") === id ? "active" : ""} onClick={() => setFilter(board.id, { blocked: id })}>
                      {name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="menu-heading">Labels</span>
            <label className="menu-item">
              <input type="checkbox" checked={!!f.noLabels} onChange={(e) => setFilter(board.id, { noLabels: e.target.checked })} />
              <span>No labels</span>
            </label>
            {board.labels.map((l) => {
              const not = notLabels.includes(l.id);
              return (
                <div key={l.id} className="row filter-label-row">
                  <label className="menu-item grow">
                    <input type="checkbox" checked={f.labelIds.includes(l.id)} disabled={not} onChange={() => toggle("labelIds", l.id)} />
                    <span className={`label-pill ${not ? "excluded" : ""}`} style={{ background: l.color }}>
                      {l.name || "Unnamed"}
                    </span>
                  </label>
                  <button
                    className={`btn xs ${not ? "accent" : "ghost"}`}
                    title={not ? "Stop hiding cards with this label" : "Hide cards with this label"}
                    aria-pressed={not}
                    onClick={() =>
                      setFilter(board.id, {
                        notLabelIds: not ? notLabels.filter((x) => x !== l.id) : [...notLabels, l.id],
                        labelIds: f.labelIds.filter((x) => x !== l.id),
                      })
                    }
                  >
                    Not
                  </button>
                </div>
              );
            })}
            <span className="menu-heading">Assigned to</span>
            <label className="menu-item">
              <input type="checkbox" checked={f.assignees.includes("")} onChange={() => toggle("assignees", "")} />
              <span>Unassigned</span>
            </label>
            {people.map((p) => (
              <label key={p} className="menu-item">
                <input type="checkbox" checked={f.assignees.includes(p)} onChange={() => toggle("assignees", p)} />
                <Avatar name={p} size={18} />
                <span>{p}</span>
              </label>
            ))}
            {filterFields.map((fd) => {
              const choices: [string, string][] =
                fd.type === "select"
                  ? fd.options.map((o) => [o.id, o.label || "Unnamed"])
                  : fd.type === "checkbox"
                    ? [["yes", "Ticked"], ["no", "Not ticked"]]
                    : [["set", "Filled in"], ["empty", "Empty"]];
              return (
                <Fragment key={fd.id}>
                  <span className="menu-heading">{fd.name}</span>
                  {choices.map(([v, name]) => (
                    <label key={v} className="menu-item">
                      <input type="checkbox" checked={!!fieldWant[fd.id]?.includes(v)} onChange={() => toggleField(fd.id, v)} />
                      {fd.type === "select" && <span className="dot" style={{ background: fd.options.find((o) => o.id === v)?.color }} />}
                      <span>{name}</span>
                    </label>
                  ))}
                </Fragment>
              );
            })}
          </div>
        )}
      </Popover>

      {f.relatedTo && (
        <span className="related-chip" title="Showing only this card and the cards related to it">
          <GitFork size={13} />
          <span className="ellipsis">Related to “{relatedTitle ?? "deleted card"}”</span>
          <label className="check-row small" title="Follow the relations all the way (sub-tasks of sub-tasks, etc.)">
            <input type="checkbox" checked={f.relatedDeep} onChange={(e) => setFilter(board.id, { relatedDeep: e.target.checked })} />
            Whole chain
          </label>
          <button className="icon-btn tiny" title="Stop filtering by related tasks" onClick={() => setFilter(board.id, { relatedTo: null, relatedDeep: false })}>
            <X size={12} />
          </button>
        </span>
      )}
      {active && (
        <button className="btn ghost sm" onClick={() => setBoardUi(board.id, { filter: emptyFilter() })}>
          <X size={14} /> Clear
        </button>
      )}
      {active && <span className="muted small">{count} {count === 1 ? "match" : "matches"}</span>}

      <div className="grow" />
      {ui.view === "board" && (
        <label className="group-by">
          <span className="gb-label">Group by</span>
          <select value={ui.groupBy} onChange={(e) => setBoardUi(board.id, { groupBy: e.target.value as GroupBy })}>
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Shown while cards are picked (Ctrl+click, or Select on a card's menu): changes for all of them at once. */
/** "2 late" and "3 due today" next to the filter: what needs doing now, a click away from showing only those cards. */
function DueChips({ board, due }: { board: Board; due: DueFilter }) {
  const cards = useStore((s) => s.data.cards);
  const lists = useStore((s) => s.data.lists);
  const { late, today } = useMemo(() => {
    const t = todayISO();
    let late = 0;
    let today = 0;
    for (const c of Object.values(cards)) {
      if (c.boardId !== board.id || c.archived || c.progress === "completed" || !lists[c.listId] || lists[c.listId].archived) continue;
      if (isLate(c)) late++;
      else if (c.dueDate === t) today++;
    }
    return { late, today };
  }, [cards, lists, board.id]);
  const chip = (kind: "overdue" | "today", n: number, text: string) =>
    (n > 0 || due === kind) && (
      <button
        className={`btn sm due-chip ${kind} ${due === kind ? "on" : ""}`}
        aria-pressed={due === kind}
        title={due === kind ? "Show all cards again" : `Show only the cards ${kind === "today" ? "due today" : "past their due date"}`}
        onClick={() => useStore.getState().setFilter(board.id, { due: due === kind ? "any" : kind })}
      >
        {kind === "overdue" ? <AlertTriangle size={13} /> : <CalendarClock size={13} />} {n} {text}
      </button>
    );
  return (
    <>
      {chip("overdue", late, "late")}
      {chip("today", today, "due today")}
    </>
  );
}

/** One custom field in the selection bar: shows the value the picked cards share (if they do), and sets it on all of them. */
function SelectionField({ field: f, cards, onSet }: { field: FieldDef; cards: Card[]; onSet: (v: FieldValue) => void }) {
  const values = new Set(cards.map((c) => c.fields[f.id] ?? null));
  const shared = values.size === 1 ? [...values][0] : undefined;
  const [text, setText] = useState(shared == null ? "" : String(shared));
  const commit = () => {
    const raw = text.trim();
    onSet(raw === "" ? null : f.type === "number" ? Number(raw) : raw);
  };
  return (
    <label className="menu-item sel-field">
      <span className="grow">{f.name}</span>
      {f.type === "checkbox" ? (
        <select value={shared === undefined ? "" : shared ? "yes" : "no"} onChange={(e) => e.target.value && onSet(e.target.value === "yes")}>
          {shared === undefined && <option value="">(mixed)</option>}
          <option value="yes">Ticked</option>
          <option value="no">Not ticked</option>
        </select>
      ) : f.type === "select" ? (
        <select value={shared === undefined ? "" : (shared ?? "none") as string} onChange={(e) => e.target.value && onSet(e.target.value === "none" ? null : e.target.value)}>
          {shared === undefined && <option value="">(mixed)</option>}
          <option value="none">None</option>
          {f.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.type === "date" ? (
        <input type="date" value={typeof shared === "string" ? shared : ""} onChange={(e) => onSet(e.target.value || null)} />
      ) : (
        <input
          type={f.type === "number" ? "number" : "text"}
          value={text}
          placeholder={shared === undefined ? "(mixed)" : "Enter to set"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          onBlur={() => text !== (shared == null ? "" : String(shared)) && commit()}
        />
      )}
    </label>
  );
}

function SelectionBar({ boardId }: { boardId: ID }) {
  const selected = useStore((s) => s.selected);
  const cards = useStore((s) => s.data.cards);
  const board = useStore((s) => s.data.boards[boardId]);
  const ai = useFeature("ai");
  const automation = useFeature("automation");
  const fieldsOn = useFeature("fields");
  const { setOverlay, clearSelected, updateCard, toast } = useStore.getState();
  const picked = selected.map((id) => cards[id]).filter(Boolean);
  if (!picked.length || !board) return null;
  const n = picked.length;
  const plural = `${n} card${n === 1 ? "" : "s"}`;
  const each = (patch: (c: Card) => Partial<Card> | null, done: string) => {
    let changed = 0;
    for (const c of picked) {
      const p = patch(c);
      if (p) (updateCard(c.id, p), changed++);
    }
    toast(changed ? `${done} ${changed} card${changed === 1 ? "" : "s"}` : "Nothing to change", { undo: changed > 0 });
  };
  // Labels (and people) on every picked card show as ticked; ticking adds to all, unticking removes from all.
  const shared = board.labels.filter((l) => picked.every((c) => c.labelIds.includes(l.id))).map((l) => l.id);
  const people = useStore.getState().data.settings.people;
  const today = new Date();
  const due = (d: Date | null) => each(() => ({ dueDate: d ? toISO(d) : null }), d ? `Due ${format(d, "EEE MMM d")}:` : "Removed the due date from");
  // Pushes every date on a card back (start, due), keeping how long it runs; cards with no dates stay as they are.
  const later = (days: number) =>
    each(
      (c) =>
        c.dueDate || c.startDate
          ? {
              dueDate: c.dueDate && toISO(addDays(parseISO(c.dueDate), days)),
              startDate: c.startDate && toISO(addDays(parseISO(c.startDate), days)),
            }
          : null,
      `Moved ${days === 1 ? "a day" : "a week"} later:`,
    );
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected cards">
      <span className="sel-count">{n} selected</span>
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><CircleDot size={14} /> Progress</button>}>
        {(close) => (
          <div className="menu">
            {PROGRESS.map((p) => (
              <MenuItem key={p.id} icon={<span className="dot" style={{ background: p.color }} />} onClick={async () => {
                  close();
                  if (p.id === "completed" && !(await okToComplete(picked.map((c) => c.id)))) return;
                  each(() => ({ progress: p.id }), `Set to ${p.name}:`);
                }}>
                {p.name}
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><Flag size={14} /> Priority</button>}>
        {(close) => (
          <div className="menu">
            {PRIORITIES.map((p) => (
              <MenuItem key={p.id} icon={<span className="dot" style={{ background: p.color }} />} onClick={() => (each(() => ({ priority: p.id }), `Set to ${p.name}:`), close())}>
                {p.name}
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><Tag size={14} /> Labels</button>}>
        {() => (
          <LabelPicker
            board={board}
            selected={shared}
            onToggle={(id, on) =>
              each(
                (c) => (on ? (c.labelIds.includes(id) ? null : { labelIds: [...c.labelIds, id] }) : c.labelIds.includes(id) ? { labelIds: c.labelIds.filter((x) => x !== id) } : null),
                on ? "Labeled" : "Unlabeled",
              )
            }
          />
        )}
      </Popover>
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><CalendarDays size={14} /> Dates</button>}>
        {(close) => (
          <div className="menu">
            <MenuItem onClick={() => (due(today), close())}>Due today</MenuItem>
            <MenuItem onClick={() => (due(addDays(today, 1)), close())}>Due tomorrow</MenuItem>
            <MenuItem onClick={() => (due(nextMonday(today)), close())}>Due next Monday</MenuItem>
            <label className="menu-item">
              <span>Due on</span>
              <input type="date" className="sel-date" onChange={(e) => e.target.value && (due(parseISO(e.target.value)), close())} />
            </label>
            <div className="menu-sep" />
            <MenuItem onClick={() => (later(1), close())}>A day later</MenuItem>
            <MenuItem onClick={() => (later(7), close())}>A week later</MenuItem>
            <div className="menu-sep" />
            <MenuItem onClick={() => (due(null), close())}>Remove due date</MenuItem>
          </div>
        )}
      </Popover>
      {people.length > 0 && (
        <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><Users size={14} /> People</button>}>
          {() => (
            <div className="menu">
              {people.map((p) => {
                const all = picked.every((c) => c.assignees.includes(p));
                return (
                  <label key={p} className="menu-item">
                    <input
                      type="checkbox"
                      checked={all}
                      onChange={() =>
                        each(
                          (c) => (all ? { assignees: c.assignees.filter((x) => x !== p) } : c.assignees.includes(p) ? null : { assignees: [...c.assignees, p] }),
                          all ? `Unassigned ${p} from` : `Assigned ${p} to`,
                        )
                      }
                    />
                    <Avatar name={p} size={18} />
                    <span>{p}</span>
                  </label>
                );
              })}
            </div>
          )}
        </Popover>
      )}
      {(fieldsOn || board.fields.some((f) => picked.some((c) => c.fields[f.id] != null))) && board.fields.length > 0 && (
        <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><SlidersHorizontal size={14} /> Fields</button>}>
          {() => (
            <div className="menu sel-fields">
              {board.fields.map((f) => (
                <SelectionField
                  key={f.id}
                  field={f}
                  cards={picked}
                  onSet={(v) => each((c) => ((c.fields[f.id] ?? null) === v ? null : { fields: { ...c.fields, [f.id]: v } }), `Set ${f.name} on`)}
                />
              ))}
            </div>
          )}
        </Popover>
      )}
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><ArrowRightLeft size={14} /> Move</button>}>
        {(close) => (
          <BucketPicker
            defaultBoardId={boardId}
            defaultListId={picked[0].listId}
            action={`Move ${plural}`}
            onPick={(listId) => {
              const st = useStore.getState();
              const to = st.data.lists[listId];
              for (const c of picked) {
                if (to.boardId === c.boardId) st.moveCardToList(c.id, listId);
                else st.moveCardToBoard(c.id, to.boardId, listId);
              }
              toast(`Moved ${plural} to ${to.title}`, { undo: true });
              close();
              clearSelected();
            }}
          />
        )}
      </Popover>
      <button
        className="btn sm"
        onClick={() => {
          each(() => ({ archived: true }), "Archived");
          clearSelected();
        }}
      >
        <Archive size={14} /> Archive
      </button>
      <button
        className="btn sm danger"
        onClick={async () => {
          if (!(await ask(`Delete ${plural}? You can undo this right after.`, { okText: "Delete", danger: true }))) return;
          for (const c of picked) useStore.getState().deleteCard(c.id);
          toast(`Deleted ${plural}`, { undo: true });
          clearSelected();
        }}
      >
        <Trash2 size={14} /> Delete
      </button>
      <Popover align="right" trigger={(_, t) => <button className="icon-btn" title="More" aria-label="More" onClick={t}><MoreHorizontal size={15} /></button>}>
        {(close) => (
          <div className="menu">
            <MenuItem icon={<Sun size={14} />} onClick={() => (each(() => ({ myDay: toISO(today) }), "Added to My Day:"), close())}>
              Add to My Day
            </MenuItem>
            {(automation || picked.some((c) => c.skipRules)) &&
              (picked.every((c) => c.skipRules) ? (
                <MenuItem icon={<Zap size={14} />} onClick={() => (each(() => ({ skipRules: undefined }), "Bucket rules apply again to"), close())}>
                  Follow bucket rules
                </MenuItem>
              ) : (
                <MenuItem icon={<ZapOff size={14} />} onClick={() => (each((c) => (c.skipRules ? null : { skipRules: true }), "Bucket rules now skip"), close())}>
                  Skip bucket rules
                </MenuItem>
              ))}
            <MenuItem
              icon={<Copy size={14} />}
              onClick={() => {
                const st = useStore.getState();
                const copies = picked.map((c) => st.duplicateCard(c.id));
                toast(`Duplicated ${plural}`, { undo: true });
                close();
                // The copies are picked now, so they can be moved or changed straight away.
                clearSelected();
                st.selectCards(copies);
              }}
            >
              Duplicate
            </MenuItem>
            {ai && (
              <>
                <div className="menu-sep" />
                <MenuItem icon={<ClipboardCopy size={14} />} onClick={() => (copyText(workOrder(boardId, picked, `${n} selected cards`)), close())}>
                  Copy work order
                </MenuItem>
                <MenuItem icon={<Bot size={14} />} onClick={() => (setOverlay({ aiDialog: { tab: "export", boardId, cardIds: selected } }), close())}>
                  Hand to AI…
                </MenuItem>
              </>
            )}
          </div>
        )}
      </Popover>
      <button className="icon-btn" title="Clear selection (Esc)" aria-label="Clear selection" onClick={clearSelected}>
        <X size={15} />
      </button>
      <span className="muted small sel-hint">Click cards to add or remove, Shift+click for a range. Esc or a click on empty space clears.</span>
    </div>
  );
}
