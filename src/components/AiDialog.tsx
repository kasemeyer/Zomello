import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Bot, ClipboardCopy, Download, Sparkles, Wand2, X } from "lucide-react";
import { useStore, type AiDialogState } from "../store";
import type { Card, ID } from "../types";
import { byOrder, matchesFilter, plural } from "../utils";
import { exportFile } from "../storage";
import {
  applyReply, DELEGATE_TASKS, parseReply, promptAddCards, promptDelegate, promptNewBoard, summarizeReply, type AiReply,
  type DelegateTask,
} from "../ai";
import { copyText } from "./Markdown";
import { Modal } from "./ui";

/** AI hand-off: build prompts / exports to paste into any AI, and apply what it sends back. */
export function AiDialog({ init }: { init: AiDialogState }) {
  const close = () => useStore.getState().setOverlay({ aiDialog: null });
  const [tab, setTab] = useState(init.tab);
  return (
    <Modal onClose={close} width={760} className="ai-dialog">
      <header className="customize-head">
        <h2>
          <Bot size={20} /> AI tools
        </h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="ai-tabs seg">
        <button className={tab === "ask" ? "active" : ""} onClick={() => setTab("ask")}>
          <Sparkles size={14} /> Ask AI for cards
        </button>
        <button className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>
          <ClipboardCopy size={14} /> Export for AI
        </button>
        <button className={tab === "apply" ? "active" : ""} onClick={() => setTab("apply")}>
          <Wand2 size={14} /> Apply AI reply
        </button>
      </div>
      <div className="customize-body">
        {tab === "ask" && <AskTab init={init} onNext={() => setTab("apply")} />}
        {tab === "export" && <ExportTab init={init} onNext={() => setTab("apply")} />}
        {tab === "apply" && <ApplyTab init={init} onDone={close} />}
        <p className="muted small ai-note">
          TCI Boards doesn't connect to any AI. Copy the text into whichever assistant you like, then paste its reply under
          “Apply AI reply”. Nothing changes until you press Apply, and Ctrl+Z undoes it.
        </p>
      </div>
    </Modal>
  );
}

function useBoards() {
  const boards = useStore((s) => s.data.boards);
  return useMemo(() => Object.values(boards).filter((b) => !b.archived).sort(byOrder), [boards]);
}
function useLists(boardId: ID | undefined) {
  const lists = useStore((s) => s.data.lists);
  return useMemo(
    () => Object.values(lists).filter((l) => l.boardId === boardId && !l.archived).sort(byOrder),
    [lists, boardId],
  );
}

/** Read-only prompt box with Copy and Save buttons. */
function Output({ text, fileName, onNext }: { text: string; fileName: string; onNext?: () => void }) {
  return (
    <div className="ai-output">
      <textarea readOnly value={text} spellCheck={false} onFocus={(e) => e.target.select()} />
      <div className="row gap-sm wrap">
        <button className="btn primary" onClick={() => copyText(text)}>
          <ClipboardCopy size={14} /> Copy
        </button>
        <button
          className="btn"
          onClick={async () => {
            const path = await exportFile(text, fileName, (share) =>
              useStore.getState().toast("The file is ready.", { action: { label: "Share", run: share } }),
            );
            if (path) useStore.getState().toast(`Saved ${path}`);
          }}
        >
          <Download size={14} /> Save as file
        </button>
        <span className="muted small grow">
          {text.length.toLocaleString()} characters · ~{Math.ceil(text.length / 4).toLocaleString()} tokens
        </span>
        {onNext && (
          <button className="btn ghost" onClick={onNext}>
            Got a reply? Apply it →
          </button>
        )}
      </div>
    </div>
  );
}

function AskTab({ init, onNext }: { init: AiDialogState; onNext: () => void }) {
  const boards = useBoards();
  const [mode, setMode] = useState<"cards" | "board">(init.mode ?? (init.boardId ? "cards" : "board"));
  const [boardId, setBoardId] = useState<ID | undefined>(init.boardId ?? boards[0]?.id);
  const lists = useLists(boardId);
  const [listId, setListId] = useState<ID | undefined>(init.listId);
  const effList = lists.some((l) => l.id === listId) ? listId : lists[0]?.id;
  const [request, setRequest] = useState("");
  const data = useStore((s) => s.data);
  const prompt = useMemo(
    () => (mode === "board" ? promptNewBoard(request) : boardId && effList ? promptAddCards(boardId, effList, request) : ""),
    [mode, boardId, effList, request, data],
  );
  return (
    <>
      <div className="seg">
        <button className={mode === "cards" ? "active" : ""} onClick={() => setMode("cards")} disabled={!boards.length}>
          Add cards to a list
        </button>
        <button className={mode === "board" ? "active" : ""} onClick={() => setMode("board")}>
          Build a new board
        </button>
      </div>
      {mode === "cards" && (
        <div className="row gap wrap">
          <label className="field grow">
            <span className="cf-name">Board</span>
            <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span className="cf-name">List</span>
            <select value={effList} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label className="field">
        <span className="cf-name">{mode === "board" ? "What's the board for?" : "What do you need?"}</span>
        <textarea
          rows={3}
          placeholder={
            mode === "board"
              ? "e.g. Plan the launch of my new podcast: recording setup, first 5 episodes, artwork, publishing…"
              : "e.g. Cards for setting up a home media server with Jellyfin, including hardware and backups"
          }
          value={request}
          onChange={(e) => setRequest(e.target.value)}
        />
      </label>
      <Output text={prompt} fileName={`zomello-prompt-${format(new Date(), "yyyyMMdd-HHmm")}.md`} onNext={onNext} />
    </>
  );
}

function ExportTab({ init, onNext }: { init: AiDialogState; onNext: () => void }) {
  const boards = useBoards();
  const data = useStore((s) => s.data);
  const [boardId, setBoardId] = useState<ID | undefined>(init.boardId ?? boards[0]?.id);
  const lists = useLists(boardId);
  type Scope = "board" | "list" | "filtered" | "cards";
  const [scope, setScope] = useState<Scope>(init.cardIds?.length ? "cards" : init.listId ? "list" : "board");
  const [listId, setListId] = useState<ID | undefined>(init.listId);
  const effList = lists.some((l) => l.id === listId) ? listId : lists[0]?.id;
  const [task, setTask] = useState<DelegateTask>("workorder");
  const [custom, setCustom] = useState("");
  const [done, setDone] = useState(false);
  const filter = boardId ? data.ui[boardId]?.filter : undefined;

  const cards = useMemo((): Card[] => {
    if (!boardId) return [];
    const live = new Set(lists.map((l) => l.id));
    const all = Object.values(data.cards).filter((c) => c.boardId === boardId && !c.archived && live.has(c.listId));
    if (scope === "cards") return all.filter((c) => init.cardIds?.includes(c.id));
    if (scope === "list") return all.filter((c) => c.listId === effList);
    if (scope === "filtered" && filter) return all.filter((c) => matchesFilter(c, filter, data.cards));
    return all;
  }, [data, boardId, lists, scope, effList, filter, init.cardIds]);

  const scopeName =
    scope === "list"
      ? `List: ${data.lists[effList ?? ""]?.title ?? ""}`
      : scope === "cards"
        ? cards.length === 1
          ? `Card: ${cards[0].title}`
          : plural(cards.length, "card")
        : `${data.boards[boardId ?? ""]?.title ?? ""}${scope === "filtered" ? " (filtered)" : ""}`;
  const text = useMemo(
    () => (boardId ? promptDelegate(boardId, done ? cards : cards.filter((c) => c.progress !== "completed"), task, custom, scopeName) : ""),
    [boardId, cards, task, custom, scopeName, done],
  );

  return (
    <>
      <div className="row gap wrap">
        <label className="field grow">
          <span className="cf-name">Board</span>
          <select
            value={boardId}
            onChange={(e) => {
              setBoardId(e.target.value);
              if (scope === "cards") setScope("board");
            }}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span className="cf-name">What to export</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="board">The whole board</option>
            <option value="list">One list</option>
            <option value="filtered">Cards matching the board's current filter</option>
            {init.cardIds?.length ? <option value="cards">The selected card{init.cardIds.length > 1 ? "s" : ""}</option> : null}
          </select>
        </label>
        {scope === "list" && (
          <label className="field grow">
            <span className="cf-name">List</span>
            <select value={effList} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="row gap wrap">
        <label className="field grow">
          <span className="cf-name">Ask the AI to…</span>
          <select value={task} onChange={(e) => setTask(e.target.value as DelegateTask)}>
            {DELEGATE_TASKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Include completed cards
        </label>
      </div>
      {task === "custom" && (
        <textarea rows={2} placeholder="What should the AI do with these cards?" value={custom} onChange={(e) => setCustom(e.target.value)} />
      )}
      <p className="muted small">{cards.length} card{cards.length === 1 ? "" : "s"} included.</p>
      <Output
        text={text}
        fileName={`zomello-${(scopeName || "export").replace(/[^\w-]+/g, "-").toLowerCase()}-${format(new Date(), "yyyyMMdd")}.md`}
        onNext={DELEGATE_TASKS.find((t) => t.id === task)?.replies ? onNext : undefined}
      />
    </>
  );
}

function ApplyTab({ init, onDone }: { init: AiDialogState; onDone: () => void }) {
  const boards = useBoards();
  const [text, setText] = useState("");
  const [boardId, setBoardId] = useState<ID | undefined>(init.boardId ?? boards[0]?.id);
  const lists = useLists(boardId);
  const [listId, setListId] = useState<ID | undefined>(init.listId);
  const effList = lists.some((l) => l.id === listId) ? listId : lists[0]?.id;

  const parsed = useMemo((): { reply?: AiReply; error?: string } => {
    if (!text.trim()) return {};
    try {
      return { reply: parseReply(text) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);
  const sum = parsed.reply && summarizeReply(parsed.reply);
  const needsTarget = !!sum && (sum.cards > 0 || sum.updates > 0);

  const apply = () => {
    if (!parsed.reply) return;
    const st = useStore.getState();
    try {
      const res = applyReply(parsed.reply, { boardId: boardId ?? null, listId: effList ?? null });
      const parts = [res.created && `${res.created} card${res.created === 1 ? "" : "s"} added`, res.updated && `${res.updated} updated`].filter(Boolean);
      st.toast(`AI reply applied: ${parts.join(", ") || "nothing to change"}`, { undo: true });
      if (res.missing.length) st.toast(`Couldn't find card id${res.missing.length > 1 ? "s" : ""}: ${res.missing.join(", ")}`);
      if (res.boardId) st.navigate({ page: "board", boardId: res.boardId });
      else if (boardId) st.navigate({ page: "board", boardId });
      onDone();
    } catch (e) {
      st.toast(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <>
      <label className="field">
        <span className="cf-name">Paste the AI's reply</span>
        <textarea
          className="ai-paste"
          rows={9}
          spellCheck={false}
          placeholder={'Paste the whole reply. TCI Boards finds the ```json block. A plain bulleted list works too (indented bullets become checklist items).'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {parsed.error && (
        <p className="danger-text small">
          <AlertTriangle size={13} /> {parsed.error}
        </p>
      )}
      {sum && (
        <div className="ai-preview">
          <b>This will:</b>
          <ul>
            {sum.board && (
              <li>
                Create a new board “{sum.board.title}” with {sum.board.buckets} lists and {sum.board.cards} cards
              </li>
            )}
            {sum.cards > 0 && <li>Add {sum.cards} card{sum.cards === 1 ? "" : "s"} (sub-tasks included) to the list below</li>}
            {sum.updates > 0 && <li>Update {sum.updates} existing card{sum.updates === 1 ? "" : "s"} on the board below</li>}
            {!sum.board && !sum.cards && !sum.updates && <li>No cards or updates were found.</li>}
          </ul>
          {needsTarget && (
            <div className="row gap wrap">
              <label className="field grow">
                <span className="cf-name">Board</span>
                <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
              {sum.cards > 0 && (
                <label className="field grow">
                  <span className="cf-name">Add new cards to</span>
                  <select value={effList} onChange={(e) => setListId(e.target.value)}>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <div className="row end">
            <button className="btn primary" disabled={!sum.board && !sum.cards && !sum.updates} onClick={apply}>
              <Wand2 size={14} /> Apply
            </button>
          </div>
        </div>
      )}
    </>
  );
}
