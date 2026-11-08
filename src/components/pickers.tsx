import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Search } from "lucide-react";
import type { Board, ID } from "../types";
import { useStore } from "../store";
import { byOrder, cardText, PALETTE, uid } from "../utils";
import { ColorPicker, ProgressIcon } from "./ui";

/** Search any (non-archived) card across all boards. */
export function CardPicker({
  exclude,
  onPick,
  disabledReason,
}: {
  exclude: ID[];
  onPick: (id: ID) => void;
  /** Shown greyed out (with this reason) instead of pickable, e.g. would create a loop. */
  disabledReason?: (id: ID) => string | null;
}) {
  const data = useStore((s) => s.data);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    return Object.values(data.cards)
      .filter(
        (c) =>
          !exclude.includes(c.id) &&
          !c.archived &&
          data.boards[c.boardId] &&
          !data.boards[c.boardId].archived &&
          (!t || cardText(c).includes(t)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
  }, [q, data, exclude]);

  return (
    <div className="picker">
      <div className="picker-search">
        <Search size={14} />
        <input
          autoFocus
          placeholder="Search tasks on any board…" spellCheck={false}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(results.length - 1, s + 1));
            if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
            if (e.key === "Enter" && results[sel] && !disabledReason?.(results[sel].id)) onPick(results[sel].id);
          }}
        />
      </div>
      <ul className="picker-list">
        {results.map((c, i) => {
          const why = disabledReason?.(c.id) ?? null;
          return (
            <li
              key={c.id}
              className={`${i === sel ? "sel" : ""} ${why ? "disabled" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => !why && onPick(c.id)}
              title={why ?? undefined}
              aria-disabled={!!why}
            >
              <ProgressIcon progress={c.progress} size={14} />
              <div className="grow ellipsis">
                <div className="ellipsis">{c.title}</div>
                <div className="muted small ellipsis">
                  {why ? (
                    <span className="picker-why">{why}</span>
                  ) : (
                    <>
                      <span className="board-dot inline" style={{ background: data.boards[c.boardId].color }} />
                      {data.boards[c.boardId].title} › {data.lists[c.listId]?.title}
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {results.length === 0 && <li className="muted small">No tasks found.</li>}
      </ul>
    </div>
  );
}

/** Toggle, create and edit a board's labels. */
export function LabelPicker({
  board,
  selected,
  onToggle,
}: {
  board: Board;
  selected: ID[];
  onToggle: (labelId: ID, on: boolean) => void;
}) {
  const updateBoard = useStore((s) => s.updateBoard);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ID | null>(null);
  const [newColor, setNewColor] = useState(PALETTE[board.labels.length % PALETTE.length]);
  const t = q.trim().toLowerCase();
  const shown = board.labels.filter((l) => !t || l.name.toLowerCase().includes(t));
  const exact = board.labels.some((l) => l.name.toLowerCase() === t);

  const create = () => {
    if (!q.trim()) return;
    const id = uid();
    updateBoard(board.id, { labels: [...board.labels, { id, name: q.trim(), color: newColor }] });
    onToggle(id, true);
    setQ("");
    setNewColor(PALETTE[(board.labels.length + 1) % PALETTE.length]);
  };
  const setLabel = (id: ID, patch: { name?: string; color?: string }) =>
    updateBoard(board.id, { labels: board.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  return (
    <div className="picker label-picker">
      <div className="picker-search">
        <Search size={14} />
        <input
          autoFocus
          placeholder="Search or create a label…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (shown.length === 1 && !exact && t && shown[0].name.toLowerCase().startsWith(t)) {
                onToggle(shown[0].id, !selected.includes(shown[0].id));
                setQ("");
              } else if (exact) {
                const l = board.labels.find((x) => x.name.toLowerCase() === t)!;
                onToggle(l.id, !selected.includes(l.id));
                setQ("");
              } else create();
            }
          }}
        />
      </div>
      <ul className="picker-list">
        {shown.map((l) => {
          const on = selected.includes(l.id);
          return editing === l.id ? (
            <li key={l.id} className="label-editing">
              <input
                autoFocus
                value={l.name}
                placeholder="Label name"
                onChange={(e) => setLabel(l.id, { name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && setEditing(null)}
              />
              <ColorPicker value={l.color} onChange={(c) => c && setLabel(l.id, { color: c })} />
              <button className="btn sm" onClick={() => setEditing(null)}>
                Done
              </button>
            </li>
          ) : (
            <li key={l.id} onClick={() => onToggle(l.id, !on)}>
              <span className={`check ${on ? "on" : ""}`}>{on && <Check size={12} />}</span>
              <span className="label-pill" style={{ background: l.color }}>
                {l.name || "Unnamed"}
              </span>
              <span className="grow" />
              <button
                className="icon-btn tiny"
                title="Edit label"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(l.id);
                }}
              >
                <Pencil size={12} />
              </button>
            </li>
          );
        })}
      </ul>
      {t && !exact && (
        <div className="label-create">
          <ColorPicker value={newColor} onChange={(c) => c && setNewColor(c)} />
          <button className="btn primary sm" onClick={create}>
            <Plus size={13} /> Create “{q.trim()}”
          </button>
        </div>
      )}
      {!t && <p className="muted small picker-hint">Type to find or create a label.</p>}
    </div>
  );
}

/** Choose a board + bucket (used for spin-offs and moves). */
export function BucketPicker({
  defaultBoardId,
  defaultListId,
  action,
  onPick,
}: {
  defaultBoardId: ID;
  /** Bucket selected at first (if it belongs to the chosen board). */
  defaultListId?: ID;
  action: string;
  onPick: (listId: ID) => void;
}) {
  const boards = useStore((s) => s.data.boards);
  const lists = useStore((s) => s.data.lists);
  const [boardId, setBoardId] = useState(defaultBoardId);
  const boardLists = Object.values(lists)
    .filter((l) => l.boardId === boardId && !l.archived)
    .sort(byOrder);
  const [listId, setListId] = useState<ID>(defaultListId ?? boardLists[0]?.id ?? "");
  const effectiveList = boardLists.some((l) => l.id === listId) ? listId : boardLists[0]?.id;
  return (
    <div className="bucket-picker">
      <label>Board</label>
      <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
        {Object.values(boards)
          .filter((b) => !b.archived)
          .sort(byOrder)
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
      </select>
      <label>List</label>
      <select value={effectiveList} onChange={(e) => setListId(e.target.value)}>
        {boardLists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.title}
          </option>
        ))}
      </select>
      <button className="btn primary sm" disabled={!effectiveList} onClick={() => effectiveList && onPick(effectiveList)}>
        {action}
      </button>
    </div>
  );
}
