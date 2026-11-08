import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, X } from "lucide-react";
import { useStore } from "../store";
import { parsePastedCards, pasteCards, readClipboard } from "../cardClipboard";
import { byOrder, plural } from "../utils";
import { Modal } from "./ui";

/**
 * Paste cards: copied cards (from this or another device), an AI's reply, or any list. Fills in the
 * clipboard when the device allows it; otherwise press and hold in the box and choose Paste.
 */
export function PasteCardsDialog({ boardId, listId, text: initial = "" }: { boardId: string; listId?: string; text?: string }) {
  const close = () => useStore.getState().setOverlay({ pasteCards: null });
  const lists = useStore((s) => s.data.lists);
  const board = useStore((s) => s.data.boards[boardId]);
  const buckets = useMemo(() => Object.values(lists).filter((l) => l.boardId === boardId && !l.archived).sort(byOrder), [lists, boardId]);
  const [bucket, setBucket] = useState(listId ?? buckets[0]?.id ?? "");
  const [text, setText] = useState(initial);

  useEffect(() => {
    if (initial) return;
    void readClipboard().then((t) => {
      if (!t.trim()) return;
      try {
        parsePastedCards(t);
        setText((cur) => cur || t);
      } catch {
        /* the clipboard holds something else; leave the box empty */
      }
    });
  }, [initial]);

  let found: ReturnType<typeof parsePastedCards> = [];
  let problem = "";
  if (text.trim()) {
    try {
      found = parsePastedCards(text);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  const add = () => {
    const st = useStore.getState();
    // People on the pasted cards join this TCI Boards's people, so their cards stay assigned.
    const people = st.data.settings.people;
    const extra = [...new Set(found.flatMap((c) => c.assignees ?? []))].filter((p) => !people.includes(p));
    if (extra.length) st.updateSettings({ people: [...people, ...extra] });
    const n = pasteCards(found, boardId, bucket);
    close();
    st.toast(`Added ${plural(n, "card")} to ${lists[bucket]?.title ?? "the board"}`, { undo: true });
  };

  if (!board) return null;
  return (
    <Modal onClose={close} width={560} className="paste-cards">
      <header className="customize-head">
        <h2>Paste cards</h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        <label className="field">
          <span className="cf-name">Into</span>
          <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
            {buckets.map((l) => (
              <option key={l.id} value={l.id}>
                {board.title}: {l.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="cf-name">Cards</span>
          <textarea
            className="paste-box"
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Paste cards copied from TCI Boards here (press and hold, then Paste).\nA plain list works too: one card per line."}
            spellCheck={false}
          />
        </label>
        {problem && <p className="muted small">{problem}</p>}
        {found.length > 0 && (
          <p className="muted small paste-preview">
            {plural(found.length, "card")}: {found.slice(0, 6).map((c) => c.title).join(", ")}
            {found.length > 6 ? ", …" : ""}
          </p>
        )}
        <div className="row end gap">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!found.length || !bucket} onClick={add}>
            <ClipboardPaste size={15} /> {found.length ? `Add ${plural(found.length, "card")}` : "Add cards"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
