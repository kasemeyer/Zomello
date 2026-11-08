import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import type { Board, Card, List, Priority } from "../../types";
import { useStore } from "../../store";
import { checklistStats, dueStatus, prettyDateTime, PRIORITIES, PROGRESS } from "../../utils";
import { Avatar, ProgressIcon } from "../ui";
import { openCardMenu } from "../ContextMenu";
import { useWhen, withWhen } from "../WhenChip";
import { setProgress, toggleDone } from "../../blocked";

type SortKey = "title" | "bucket" | "progress" | "priority" | "start" | "due" | "updated";
const PRI_RANK: Record<Priority, number> = { urgent: 0, important: 1, medium: 2, low: 3 };
const PROG_RANK = { notStarted: 0, inProgress: 1, waiting: 2, onHold: 3, completed: 4 };

export function ListView({ board, lists, cards }: { board: Board; lists: List[]; cards: Card[] }) {
  const openCard = useStore((s) => s.openCard);
  const updateCard = useStore((s) => s.updateCard);
  const createCard = useStore((s) => s.createCard);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "bucket", dir: 1 });
  const [newTitle, setNewTitle] = useState("");
  const { when, chip } = useWhen(newTitle);
  const listIdx = useMemo(() => Object.fromEntries(lists.map((l, i) => [l.id, i])), [lists]);
  const listName = useMemo(() => Object.fromEntries(lists.map((l) => [l.id, l.title])), [lists]);

  const rows = useMemo(() => {
    const val = (c: Card): string | number => {
      switch (sort.key) {
        case "title": return c.title.toLowerCase();
        case "bucket": return (listIdx[c.listId] ?? 999) * 1e6 + c.order;
        case "progress": return PROG_RANK[c.progress];
        case "priority": return PRI_RANK[c.priority];
        case "start": return c.startDate ?? "9999";
        case "due": return c.dueDate ?? "9999";
        case "updated": return -c.updatedAt;
      }
    };
    return [...cards].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [cards, sort, listIdx]);

  const Th = ({ k, children, w }: { k: SortKey; children: string; w?: number }) => (
    <th style={{ width: w }} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : 1 }))}>
      {children}
      {sort.key === k && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </th>
  );

  return (
    <div className="list-view">
      {lists.length > 0 && (
        <div className="list-add">
          <Plus size={16} />
          <input
            placeholder={`Add a task to "${lists[0].title}"… (Enter)`}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTitle.trim()) {
                const w = withWhen(newTitle, when);
                createCard(lists[0].id, w.title, w.extra);
                setNewTitle("");
              }
            }}
          />
          {chip}
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 36 }} />
            <Th k="title">Task</Th>
            <Th k="bucket" w={140}>List</Th>
            <Th k="progress" w={130}>Progress</Th>
            <Th k="priority" w={120}>Priority</Th>
            <Th k="start" w={100}>Start</Th>
            <Th k="due" w={100}>Due</Th>
            <th style={{ width: 90 }}>Assigned</th>
            <th style={{ width: 160 }}>Labels</th>
            <th style={{ width: 70 }}>Checklist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const cl = checklistStats(c);
            return (
              <tr key={c.id} onClick={() => openCard(c.id)} onContextMenu={(e) => openCardMenu(e, c.id)} className={c.progress === "completed" ? "done" : ""}>
                <td>
                  <button
                    className="progress-toggle"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDone(c);
                    }}
                  >
                    <ProgressIcon progress={c.progress} />
                  </button>
                </td>
                <td className="title-cell">{c.title}</td>
                <td>
                  <select
                    value={c.listId}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCard(c.id, { listId: e.target.value })}
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.title}</option>
                    ))}
                    {!listName[c.listId] && <option value={c.listId}>(archived)</option>}
                  </select>
                </td>
                <td>
                  <select
                    value={c.progress}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setProgress(c.id, e.target.value as Card["progress"])}
                  >
                    {PROGRESS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={c.priority}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCard(c.id, { priority: e.target.value as Priority })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
                <td className="muted">{c.startDate ? prettyDateTime(c.startDate, c.startTime) : ""}</td>
                <td className={`due-text due-${dueStatus(c)}`}>{c.dueDate ? prettyDateTime(c.dueDate, c.dueTime) : ""}</td>
                <td>
                  <span className="card-avatars">
                    {c.assignees.map((a) => (
                      <Avatar key={a} name={a} size={22} />
                    ))}
                  </span>
                </td>
                <td>
                  <div className="card-labels">
                    {board.labels
                      .filter((l) => c.labelIds.includes(l.id))
                      .map((l) => (
                        <span key={l.id} className="label-pill" style={{ background: l.color }}>{l.name}</span>
                      ))}
                  </div>
                </td>
                <td className="muted">{cl.total ? `${cl.done}/${cl.total}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted center pad">No tasks match.</p>}
    </div>
  );
}
