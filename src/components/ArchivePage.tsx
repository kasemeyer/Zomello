import { useState } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { plural, timeAgo } from "../utils";
import { Empty } from "./ui";
import { deleteBoard, deleteCard, deleteList } from "../actions";

type Tab = "cards" | "lists" | "boards";

export function ArchivePage() {
  const data = useStore((s) => s.data);
  const { updateBoard, updateList, updateCard, openCard, toast } = useStore.getState();
  const [tab, setTab] = useState<Tab>("cards");

  const boards = Object.values(data.boards).filter((b) => b.archived);
  const lists = Object.values(data.lists).filter((l) => l.archived && data.boards[l.boardId]);
  const cards = Object.values(data.cards)
    .filter((c) => c.archived && data.boards[c.boardId])
    .sort((a, b) => b.updatedAt - a.updatedAt);


  return (
    <div className="page">
      <h1>Archive</h1>
      <div className="seg">
        {(
          [
            ["cards", `Cards (${cards.length})`],
            ["lists", `Lists (${lists.length})`],
            ["boards", `Boards (${boards.length})`],
          ] as [Tab, string][]
        ).map(([id, name]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>

      <ul className="archive-list">
        {tab === "cards" &&
          cards.map((c) => (
            <li key={c.id}>
              <button className="link grow ellipsis" onClick={() => openCard(c.id)}>
                {c.title}
              </button>
              <span className="muted small">
                {data.boards[c.boardId].title} › {data.lists[c.listId]?.title} · {timeAgo(c.updatedAt)}
              </span>
              <button className="btn sm" onClick={() => (updateCard(c.id, { archived: false }), toast(`Restored “${c.title}”`))}>
                <ArchiveRestore size={14} /> Restore
              </button>
              <button className="icon-btn danger" title="Delete" onClick={() => void deleteCard(c)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        {tab === "lists" &&
          lists.map((l) => (
            <li key={l.id}>
              <span className="grow ellipsis">{l.title}</span>
              <span className="muted small">
                {data.boards[l.boardId].title} · {plural(Object.values(data.cards).filter((c) => c.listId === l.id).length, "card")}
              </span>
              <button className="btn sm" onClick={() => (updateList(l.id, { archived: false }), toast(`Restored “${l.title}”`))}>
                <ArchiveRestore size={14} /> Restore
              </button>
              <button
                className="icon-btn danger"
                title="Delete"
                onClick={() => void deleteList(l)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        {tab === "boards" &&
          boards.map((b) => (
            <li key={b.id}>
              <span className="board-dot" style={{ background: b.color }} />
              <span className="grow ellipsis">{b.title}</span>
              <button className="btn sm" onClick={() => (updateBoard(b.id, { archived: false }), toast(`Restored “${b.title}”`))}>
                <ArchiveRestore size={14} /> Restore
              </button>
              <button
                className="icon-btn danger"
                title="Delete"
                onClick={() => void deleteBoard(b)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
      </ul>
      {((tab === "cards" && !cards.length) || (tab === "lists" && !lists.length) || (tab === "boards" && !boards.length)) && (
        <Empty title="Nothing archived">Archived items show up here and can be restored any time.</Empty>
      )}
    </div>
  );
}
