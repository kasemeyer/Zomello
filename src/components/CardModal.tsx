import { useEffect, useMemo, useRef, useState } from "react";
import { archiveCard, deleteCard as deleteCardAction } from "../actions";
import {
  Activity as ActivityIcon,
  AlignLeft,
  ArrowLeft,
  ChevronLeft,
  CornerDownRight,
  ChevronRight,
  Download,
  HardDrive,
  Archive,
  Ban,
  BookmarkPlus,
  FileText,
  ImageIcon,
  Pause,
  Play,
  SlidersHorizontal,
  Hourglass,
  RotateCcw,
  Timer,
  Users,
  Upload,
  ArchiveRestore,
  Copy,
  ExternalLink,
  Link2,
  Eye,
  MessageSquare,
  Plus,
  Tag,
  Trash2,
  X,
  CircleCheck,
} from "lucide-react";
import type { Activity, Attachment, Card, CardSection, FieldDef, ID, LinkType, Priority, Progress, Recurrence, RecurrenceFreq } from "../types";
import { attachToCard, isLocalPath, storeLinkedFile } from "../attachments";
import { canEditBoard } from "../server";
import { useStore } from "../store";
import {
  blockLoopReason, byOrder, subtaskLoopReason, describeRecurrence, fileSize, formatDuration, isImage, LINK_TYPES, parseDuration,
  prettyDate, priorityMeta, PRIORITIES, PROGRESS, progressMeta, timeAgo, todayISO, trackedMs, uid, WEEKDAYS,
} from "../utils";
import { format } from "date-fns";
import { fileUrlToPath, inTauri, isPhoneOrTablet, openExternal, openStored, storedSrc } from "../storage";
import { createPortal } from "react-dom";
import { Avatar, ColorPicker, CommitInput, InlineEdit, Modal, Popover, ProgressIcon, useSaveOnUnmount } from "./ui";
import { CardPicker, LabelPicker } from "./pickers";
import { Markdown, MarkdownEditor, MarkdownField } from "./Markdown";
import { ChecklistSection } from "./Checklist";
import { useNow } from "./useNow";
import { featureOn, sectionShown } from "../features";
import { setProgress, toggleDone } from "../blocked";

export function CardModal({ cardId }: { cardId: ID }) {
  const card = useStore((s) => s.data.cards[cardId]);
  const trail = useStore((s) => s.cardTrail);
  const dir = useStore((s) => s.cardNavDir);
  const close = () => useStore.getState().openCard(null);
  if (!card) return null;
  return (
    <Modal onClose={close} width={920} className="card-modal">
      {trail.length > 0 && <TrailBar cardId={card.id} />}
      <div key={card.id} className={`card-slide ${dir ?? ""}`}>
        <CardDetail card={card} onClose={close} />
      </div>
    </Modal>
  );
}

function CardDetail({ card, onClose }: { card: Card; onClose: () => void }) {
  const board = useStore((s) => s.data.boards[card.boardId]);
  const allLists = useStore((s) => s.data.lists);
  const allBoards = useStore((s) => s.data.boards);
  const people = useStore((s) => s.data.settings.people);
  const features = useStore((s) => s.data.settings.features);
  const allCards = useStore((s) => s.data.cards);
  const {
    updateCard, duplicateCard, moveCardToBoard, openCard,
    linkCards, unlinkCards,
  } = useStore.getState();
  const [newLinkType, setNewLinkType] = useState<LinkType>("relates");
  /** Cards that have this card as a linked checklist item. */
  const parents = useMemo(
    () => Object.values(allCards).filter((c) => c.checklist.some((i) => i.cardId === card.id)),
    [allCards, card.id],
  );
  const lists = useMemo(
    () => Object.values(allLists).filter((l) => l.boardId === card.boardId && !l.archived).sort(byOrder),
    [allLists, card.boardId],
  );
  const set = (patch: Partial<Card>) => updateCard(card.id, patch);
  const [comment, setComment] = useState("");
  // A note that was typed but not saved yet is kept when the card closes or another card opens.
  useSaveOnUnmount(() => {
    const text = comment.trim();
    const cur = useStore.getState().data.cards[card.id];
    if (text && cur) updateCard(card.id, { comments: [{ id: uid(), text, createdAt: Date.now() }, ...cur.comments] });
  });
  const coverImg = card.coverImage ? card.attachments.find((a) => a.id === card.coverImage) : undefined;

  const attachFiles = (files: FileList | File[]) => attachToCard(card.id, { files: Array.from(files), paths: [], links: [] });

  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  // Hidden by the board, or by a feature group the card doesn't use yet (Settings > Features).
  const show = (s: CardSection) => !board.hiddenSections.includes(s) && sectionShown({ features }, card, s);

  return (
    <div className="card-detail">
      {!canEditBoard(board) && (
        <p className="muted small view-only-note" style={{ margin: "8px 16px 0" }}>
          <Eye size={12} style={{ verticalAlign: "-2px" }} /> This board is view-only for you — changes won't stick. Ask its owner for edit
          access.
        </p>
      )}
      {coverImg ? (
        <img className="detail-cover image" src={storedSrc(coverImg.url)} alt="" />
      ) : (
        card.cover && <div className="detail-cover" style={{ background: card.cover }} />
      )}
      <button className="icon-btn close" onClick={onClose} title="Close (Esc)">
        <X size={18} />
      </button>
      {card.archived && (
        <div className="archived-banner">
          <Archive size={14} /> This card is archived.
          <button className="btn sm" onClick={() => set({ archived: false })}>
            <ArchiveRestore size={14} /> Restore
          </button>
        </div>
      )}
      <header className="detail-head">
        <InlineEdit className="detail-title" value={card.title} onSave={(title) => set({ title })} multiline />
        <div className="detail-meta">
          <button
            className={`btn sm complete-btn ${card.progress === "completed" ? "on" : ""}`}
            onClick={() => toggleDone(card)}
            title={card.progress === "completed" ? "Mark as not done" : "Mark complete"}
          >
            <CircleCheck size={14} /> {card.progress === "completed" ? "Completed" : "Mark complete"}
          </button>
          <span className="muted small">
            in <b>{board.title}</b> · created {timeAgo(card.createdAt)} · updated {timeAgo(card.updatedAt)}
          </span>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          {card.links.some((l) => l.type === "blockedBy" && allCards[l.cardId]?.progress !== "completed") && (
            <div className="blocked-banner">
              <Ban size={14} /> Blocked: waiting on linked tasks to be completed.
            </div>
          )}

          {show("assignees") && (
            <section>
              <h4>
                <Users size={15} /> Assigned to
              </h4>
                <div className="row wrap gap-sm">
                  {card.assignees.map((a) => (
                    <span key={a} className="chip">
                      <Avatar name={a} size={18} /> {a}
                      <button className="icon-btn tiny" title="Unassign" aria-label="Unassign" onClick={() => set({ assignees: card.assignees.filter((x) => x !== a) })}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <Popover
                    trigger={(_, toggle) => (
                      <button className="chip add" onClick={toggle}>
                        <Plus size={13} /> Assign
                      </button>
                    )}
                  >
                    {(closePop) => (
                      <div className="menu">
                        {people.length === 0 && <p className="muted small pad">Add people in Settings.</p>}
                        {people.map((p) => (
                          <label key={p} className="menu-item">
                            <input
                              type="checkbox"
                              checked={card.assignees.includes(p)}
                              onChange={() => set({ assignees: toggleIn(card.assignees, p) })}
                            />
                            <Avatar name={p} size={18} />
                            <span>{p}</span>
                          </label>
                        ))}
                        <button className="menu-item muted" onClick={closePop}>
                          Done
                        </button>
                      </div>
                    )}
                  </Popover>
                </div>
            </section>
          )}

          {/* Labels */}
          {show("labels") && (
          <section>
            <h4>
              <Tag size={15} /> Labels
            </h4>
            <div className="row wrap gap-sm">
              {board.labels
                .filter((l) => card.labelIds.includes(l.id))
                .map((l) => (
                  <span key={l.id} className="label-pill lg" style={{ background: l.color }}>
                    {l.name || "Unnamed"}
                    <button title="Remove label" onClick={() => set({ labelIds: card.labelIds.filter((x) => x !== l.id) })}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              <Popover
                trigger={(_, toggle) => (
                  <button className="label-toggle add" onClick={toggle}>
                    <Plus size={13} /> {card.labelIds.length ? "" : "Add label"}
                  </button>
                )}
              >
                {() => (
                  <LabelPicker
                    board={board}
                    selected={card.labelIds}
                    onToggle={(id, on) => {
                      const cur = useStore.getState().data.cards[card.id].labelIds;
                      set({ labelIds: on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
                    }}
                  />
                )}
              </Popover>
            </div>
          </section>
          )}

          {show("fields") && board.fields.length > 0 && (
            <section>
              <h4>
                <SlidersHorizontal size={15} /> Fields
              </h4>
              <CustomFields card={card} />
            </section>
          )}

          {/* Description */}
          {show("description") && (
          <section>
            <h4>
              <AlignLeft size={15} /> Description
            </h4>
            <MarkdownField
              value={card.description}
              placeholder="Add a more detailed description… (Markdown supported)"
              onSave={(description) => set({ description })}
            />
          </section>
          )}

          {/* Checklist */}
          {show("checklist") && <ChecklistSection card={card} />}

          {/* Linked tasks */}
          {show("links") && (
          <section>
            <h4>
              <Link2 size={15} /> Linked tasks
            </h4>
            <ul className="linked-list">
              {card.links.map((l) => {
                const c = allCards[l.cardId];
                if (!c) return null;
                return (
                  <li key={l.cardId}>
                    <select
                      className="link-type"
                      value={l.type}
                      onChange={(e) => linkCards(card.id, c.id, e.target.value as LinkType)}
                    >
                      {LINK_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <ProgressIcon progress={c.progress} size={14} />
                    <button className="linked-item grow" onClick={() => openCard(c.id, { via: "link" })}>
                      <span className="ellipsis">{c.title}</span>
                      <span className="muted small ellipsis">
                        <span className="board-dot inline" style={{ background: allBoards[c.boardId]?.color }} />
                        {allBoards[c.boardId]?.title} › {allLists[c.listId]?.title}
                      </span>
                    </button>
                    <button className="icon-btn tiny" title="Remove link" onClick={() => unlinkCards(card.id, c.id)}>
                      <X size={13} />
                    </button>
                  </li>
                );
              })}
              {parents.map((p) => (
                <li key={`parent-${p.id}`}>
                  <span className="link-type static parent-tag">
                    <CornerDownRight size={12} /> Sub-task of
                  </span>
                  <ProgressIcon progress={p.progress} size={14} />
                  <button className="linked-item grow" onClick={() => openCard(p.id, { via: "parent" })}>
                    <span className="ellipsis">{p.title}</span>
                    <span className="muted small ellipsis">
                      {allBoards[p.boardId]?.title} › {allLists[p.listId]?.title}
                    </span>
                  </button>
                  <button
                    className="icon-btn tiny"
                    title="Stop being a sub-task of this (removes it from that checklist)"
                    onClick={() => useStore.getState().removeFromParent(p.id, card.id)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <Popover
              trigger={(_, t) => (
                <button className="btn sm ghost" onClick={t}>
                  <Plus size={14} /> Link a task
                </button>
              )}
            >
              {(close) => (
                <div>
                  <div className="seg link-type-seg">
                    {LINK_TYPES.map((t) => (
                      <button key={t.id} className={newLinkType === t.id ? "active" : ""} onClick={() => setNewLinkType(t.id)}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <CardPicker
                    exclude={[card.id, ...card.links.map((l) => l.cardId)]}
                    disabledReason={(id) => blockLoopReason(card.id, id, newLinkType, useStore.getState().data.cards)}
                    onPick={(id) => {
                      linkCards(card.id, id, newLinkType);
                      close();
                    }}
                  />
                </div>
              )}
            </Popover>
            <Popover
              trigger={(_, t) => (
                <button className="btn sm ghost" onClick={t} title="Make this card a sub-task of another card">
                  <CornerDownRight size={14} /> Add to a parent task
                </button>
              )}
            >
              {(close) => (
                <div>
                  <span className="menu-heading">This card becomes a checklist item of…</span>
                  <CardPicker
                    exclude={[card.id, ...parents.map((p) => p.id)]}
                    disabledReason={(id) => subtaskLoopReason(id, card.id, useStore.getState().data.cards)}
                    onPick={(id) => {
                      useStore.getState().addToParent(id, card.id);
                      close();
                    }}
                  />
                </div>
              )}
            </Popover>
          </section>
          )}

          {/* Files & links */}
          {show("files") && <AttachmentsSection card={card} onFiles={attachFiles} />}

          {/* Notes / comments */}
          {show("notes") && (
          <section>
            <h4>
              <MessageSquare size={15} /> Notes
            </h4>
            <MarkdownEditor
              placeholder={isPhoneOrTablet ? "Write a note… (it's kept when you close the card)" : "Write a note… (Ctrl+Enter to add; it's also kept if you close the card)"}
              value={comment}
              onChange={setComment}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && comment.trim()) {
                  set({ comments: [{ id: uid(), text: comment.trim(), createdAt: Date.now() }, ...card.comments] });
                  setComment("");
                }
              }}
            />
            {comment.trim() && (
              <button
                className="btn primary sm"
                onClick={() => {
                  set({ comments: [{ id: uid(), text: comment.trim(), createdAt: Date.now() }, ...card.comments] });
                  setComment("");
                }}
              >
                Save note
              </button>
            )}
            <ul className="comments">
              {card.comments.map((c) => (
                <li key={c.id}>
                  <div className="row between">
                    <span className="muted small">{timeAgo(c.createdAt)}</span>
                    <button
                      className="icon-btn tiny"
                      onClick={() => set({ comments: card.comments.filter((x) => x.id !== c.id) })}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <Markdown text={c.text} />
                </li>
              ))}
            </ul>
          </section>
          )}

          {show("activity") && <ActivitySection card={card} />}
        </div>

        <aside className="detail-side">
          <Field label="Bucket">
            <select value={card.listId} onChange={(e) => set({ listId: e.target.value })}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Progress" hidden={!show("progress")}>
            <select value={card.progress} onChange={(e) => setProgress(card.id, e.target.value as Progress)}>
              {PROGRESS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority" hidden={!show("priority")}>
            <select value={card.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date" hidden={!show("startDate")}>
            <DateInput
              value={card.startDate}
              time={card.startTime ?? null}
              onChange={(startDate) => set({ startDate, ...(startDate ? {} : { startTime: null }) })}
              onTime={(startTime) => set({ startTime })}
            />
          </Field>
          <Field label="Due date" hidden={!show("dueDate")}>
            <DateInput
              value={card.dueDate}
              time={card.dueTime ?? null}
              onChange={(dueDate) => set({ dueDate, ...(dueDate ? {} : { dueTime: null }) })}
              onTime={(dueTime) => set({ dueTime })}
            />
          </Field>
          <Field label="Reminder" hidden={!show("reminder")}>
            <div className="row gap-sm">
              <input
                type="datetime-local"
                value={card.reminder ?? ""}
                onChange={(e) => set({ reminder: e.target.value || null })}
              />
              {card.reminder && (
                <button className="icon-btn tiny" title="Clear" onClick={() => set({ reminder: null })}>
                  <X size={13} />
                </button>
              )}
            </div>
          </Field>
          <Field label="Repeat" hidden={!show("repeat")}>
            <RecurrenceEditor card={card} onChange={(recurrence) => set({ recurrence, ...(recurrence && !card.dueDate ? { dueDate: todayISO() } : {}) })} />
          </Field>
          <Field label="Time" hidden={!show("time")}>
            <TimeTracker card={card} />
          </Field>
          <Field label="Cover" hidden={!show("cover")}>
            <CoverEditor card={card} />
          </Field>
          <Field label="Bucket rules" hidden={!featureOn({ features }, "automation") && !card.skipRules}>
            <div>
              <label className="check-row" title="Moving this card, ticking its checklist and Tidy up won't change it">
                <input type="checkbox" checked={!!card.skipRules} onChange={(e) => set({ skipRules: e.target.checked || undefined })} />
                Skip bucket rules for this card
              </label>
            </div>
          </Field>
          <Field label="Move to board" hidden={!show("moveBoard")}>
            <select
              value={card.boardId}
              onChange={(e) => {
                const target = e.target.value;
                const firstList = Object.values(allLists)
                  .filter((l) => l.boardId === target && !l.archived)
                  .sort(byOrder)[0];
                if (firstList) moveCardToBoard(card.id, target, firstList.id);
              }}
            >
              {Object.values(allBoards)
                .filter((b) => !b.archived)
                .sort(byOrder)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
            </select>
          </Field>

          <div className="side-actions">
            <button className="btn" onClick={() => openCard(duplicateCard(card.id))}>
              <Copy size={14} /> Duplicate
            </button>
            <Popover
              trigger={(_, t) => (
                <button className="btn" onClick={t}>
                  <BookmarkPlus size={14} /> Save as template
                </button>
              )}
            >
              {(close) => (
                <form
                  className="menu pad-sm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = new FormData(e.currentTarget).get("name")?.toString().trim();
                    if (!name) return;
                    useStore.getState().saveTemplate(card.id, name);
                    useStore.getState().toast(`Saved template "${name}"`);
                    close();
                  }}
                >
                  <span className="menu-heading">Template name</span>
                  <input name="name" autoFocus defaultValue={card.title} />
                  <button className="btn primary sm" style={{ marginTop: 8 }} type="submit">
                    Save template
                  </button>
                </form>
              )}
            </Popover>
            {card.archived ? (
              <button className="btn" onClick={() => set({ archived: false })}>
                <ArchiveRestore size={14} /> Restore
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => {
                  onClose();
                  archiveCard(card);
                }}
              >
                <Archive size={14} /> Archive
              </button>
            )}
            <button
              className="btn danger"
              onClick={() => void deleteCardAction(card)}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children, hidden }: { label: string; children: React.ReactNode; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

/** A date, and (once there's a date) an optional time: no time means all day. */
function DateInput({
  value,
  onChange,
  time,
  onTime,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  time?: string | null;
  onTime?: (t: string | null) => void;
}) {
  return (
    <div className="row gap-sm date-input">
      <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
      {value && onTime && (
        <input
          type="time"
          value={time ?? ""}
          title="Leave empty for all day"
          aria-label="Time (leave empty for all day)"
          onChange={(e) => onTime(e.target.value || null)}
        />
      )}
      {value && (
        <button className="icon-btn tiny" title="Clear" onClick={() => onChange(null)}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

const FREQS: { id: RecurrenceFreq; unit: string }[] = [
  { id: "daily", unit: "day" },
  { id: "weekly", unit: "week" },
  { id: "monthly", unit: "month" },
  { id: "yearly", unit: "year" },
];

function RecurrenceEditor({ card, onChange }: { card: Card; onChange: (r: Recurrence | null) => void }) {
  const r = card.recurrence;
  const update = (patch: Partial<Recurrence>) => r && onChange({ ...r, ...patch });
  return (
    <div className="recurrence">
      <select
        value={r?.freq ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? { freq: e.target.value as RecurrenceFreq, interval: r?.interval ?? 1, weekdays: [], until: r?.until ?? null } : null)
        }
      >
        <option value="">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
      {r && (
        <>
          <div className="row gap-sm">
            <span className="small muted">Every</span>
            <input
              type="number"
              min={1}
              className="interval"
              value={r.interval}
              onChange={(e) => update({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
            <span className="small muted">
              {FREQS.find((f) => f.id === r.freq)!.unit}
              {r.interval > 1 ? "s" : ""}
            </span>
          </div>
          {r.freq === "weekly" && (
            <div className="weekdays">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  className={r.weekdays.includes(i) ? "on" : ""}
                  onClick={() => update({ weekdays: r.weekdays.includes(i) ? r.weekdays.filter((x) => x !== i) : [...r.weekdays, i] })}
                >
                  {d[0]}
                </button>
              ))}
            </div>
          )}
          <div className="row gap-sm">
            <span className="small muted">Until</span>
            <input type="date" value={r.until ?? ""} onChange={(e) => update({ until: e.target.value || null })} />
          </div>
          <span className="small muted">{describeRecurrence(r)}. Completing it creates the next one.</span>
        </>
      )}
    </div>
  );
}

function AttachmentsSection({ card, onFiles }: { card: Card; onFiles: (f: FileList) => Promise<unknown> }) {
  const updateCard = useStore((s) => s.updateCard);
  const [link, setLink] = useState({ name: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ID | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const images = card.attachments.filter((a) => a.stored && isImage(a.name, a.mime));
  const others = card.attachments.filter((a) => !images.includes(a));
  const remove = (a: Attachment) =>
    updateCard(card.id, {
      attachments: card.attachments.filter((x) => x.id !== a.id),
      ...(card.coverImage === a.id ? { coverImage: null } : {}),
    });
  const open = (a: Attachment) => (a.stored ? openStored(a.url) : openExternal(a.url));
  const display = (a: Attachment) => (isLocalPath(a.url) && !a.stored ? fileUrlToPath(a.url) : a.url);

  return (
    <section>
      <h4>
        <Link2 size={15} /> Files & links
        <span className="grow" />
        <button className="btn sm ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> {busy ? "Attaching…" : "Attach files"}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={async (e) => {
            const files = e.target.files;
            if (!files?.length) return;
            setBusy(true);
            await onFiles(files);
            setBusy(false);
            e.target.value = "";
          }}
        />
      </h4>
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((a) => (
            <figure key={a.id} className={card.coverImage === a.id ? "is-cover" : ""}>
              <img src={storedSrc(a.url)} alt={a.name} onClick={() => setPreview(a.id)} title="Preview" />
              <figcaption>
                <span className="ellipsis" title={a.name}>{a.name}</span>
                <button
                  className="icon-btn tiny"
                  title={card.coverImage === a.id ? "Remove as cover" : "Use as cover"}
                  onClick={() => updateCard(card.id, { coverImage: card.coverImage === a.id ? null : a.id })}
                >
                  <ImageIcon size={13} />
                </button>
                <button className="icon-btn tiny" title="Remove" onClick={() => remove(a)}>
                  <X size={13} />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <ul className="attachments">
        {others.map((a) => {
          const local = !a.stored && isLocalPath(a.url);
          return (
            <li key={a.id}>
              <button className="link" onClick={() => open(a)} title={a.stored ? "Open file" : display(a)}>
                {a.stored ? <FileText size={13} /> : local ? <HardDrive size={13} /> : <ExternalLink size={13} />}{" "}
                {local || a.name.includes("%") ? decodeURIComponent(a.name) : a.name}
              </button>
              <span className="muted small ellipsis grow">{a.stored ? `${fileSize(a.size)} · stored in Zomello` : display(a)}</span>
              {local && inTauri && (
                <button className="btn sm ghost" title="Copy the file into Zomello so it keeps working if the original moves" onClick={() => storeLinkedFile(card.id, a.id)}>
                  <Download size={12} /> Copy in
                </button>
              )}
              <button className="icon-btn tiny" title="Remove" onClick={() => remove(a)}>
                <X size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="row gap-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const url = link.url.trim();
          if (!url) return;
          const name = link.name.trim() || decodeURIComponent(url.split(/[\\/]/).filter(Boolean).pop() || url);
          updateCard(card.id, { attachments: [...card.attachments, { id: uid(), name, url, addedAt: Date.now() }] });
          setLink({ name: "", url: "" });
        }}
      >
        <input
          className="add-input grow"
          placeholder="Paste a link (https://…) or a file path" spellCheck={false}
          value={link.url}
          onChange={(e) => setLink({ ...link, url: e.target.value })}
        />
        <input
          className="add-input"
          style={{ width: 140 }}
          placeholder="Name (optional)"
          value={link.name}
          onChange={(e) => setLink({ ...link, name: e.target.value })}
        />
        <button className="btn sm" type="submit">
          Add
        </button>
      </form>
      {!isPhoneOrTablet && (
        <p className="muted small drop-tip">
          <Upload size={11} /> Tip: drag files from your file manager anywhere onto this card.
        </p>
      )}
      {preview && (
        <Lightbox
          images={images}
          startId={preview}
          coverId={card.coverImage}
          onCover={(id) => updateCard(card.id, { coverImage: card.coverImage === id ? null : id })}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}

/** In-app image preview with arrow-key navigation. */
function Lightbox({
  images,
  startId,
  coverId,
  onCover,
  onClose,
}: {
  images: Attachment[];
  startId: ID;
  coverId: ID | null;
  onCover: (id: ID) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(Math.max(0, images.findIndex((a) => a.id === startId)));
  const a = images[i];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((x) => (x + 1) % images.length);
      else if (e.key === "ArrowLeft") setI((x) => (x - 1 + images.length) % images.length);
      else if (e.key === "Escape") {
        e.stopImmediatePropagation(); // close only the preview, not the card
        onClose();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [images.length, onClose]);
  if (!a) return null;
  return createPortal(
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <img src={storedSrc(a.url)} alt={a.name} />
      <div className="lightbox-bar">
        <span className="ellipsis grow">
          {a.name} <span className="muted">· {fileSize(a.size)}{images.length > 1 ? ` · ${i + 1} of ${images.length}` : ""}</span>
        </span>
        <button className="btn sm" onClick={() => onCover(a.id)}>
          <ImageIcon size={13} /> {coverId === a.id ? "Remove as cover" : "Use as cover"}
        </button>
        <button className="btn sm" onClick={() => openStored(a.url)}>
          <ExternalLink size={13} /> Open in app
        </button>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      {images.length > 1 && (
        <>
          <button className="lightbox-nav prev" onClick={() => setI((i - 1 + images.length) % images.length)} title="Previous (←)">
            <ChevronLeft size={28} />
          </button>
          <button className="lightbox-nav next" onClick={() => setI((i + 1) % images.length)} title="Next (→)">
            <ChevronRight size={28} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

function ActivitySection({ card }: { card: Card }) {
  const lists = useStore((s) => s.data.lists);
  const boards = useStore((s) => s.data.boards);
  const [all, setAll] = useState(false);
  const items = [...card.activity].reverse();
  const shown = all ? items : items.slice(0, 6);
  const listName = (id?: string | null) => (id && lists[id]?.title) || "a deleted bucket";
  const boardName = (id?: string | null) => (id && boards[id]?.title) || "a deleted board";
  const date = (v?: string | null) => (v ? prettyDate(v) : "none");

  const describe = (a: Activity): React.ReactNode => {
    switch (a.kind) {
      case "created": return "Created this task";
      case "moved": return <>Moved from <b>{listName(a.from)}</b> to <b>{listName(a.to)}</b></>;
      case "board": return <>Moved from board <b>{boardName(a.from)}</b> to <b>{boardName(a.to)}</b></>;
      case "progress":
        return a.to === "completed" ? <>Marked <b>complete</b></> : <>Progress set to <b>{progressMeta(a.to as Progress).name}</b></>;
      case "priority": return <>Priority changed to <b>{priorityMeta(a.to as Priority).name}</b></>;
      case "due": return a.to ? <>Due date set to <b>{date(a.to)}</b>{a.from ? <> (was {date(a.from)})</> : null}</> : "Removed the due date";
      case "archived": return "Archived";
      case "restored": return "Restored from the archive";
      case "assigned": return <>Assigned to <b>{a.to}</b></>;
      case "unassigned": return <>Unassigned <b>{a.from}</b></>;
      case "renamed": return <>Renamed from “{a.from}”</>;
    }
  };

  return (
    <section>
      <h4>
        <ActivityIcon size={15} /> Activity
      </h4>
      {items.length === 0 ? (
        <p className="muted small">Changes to this task will be recorded here.</p>
      ) : (
        <ul className="activity">
          {shown.map((a, i) => (
            <li key={i}>
              <span className="activity-dot" />
              <span className="grow">
                {describe(a)}
                {a.rule && <span className="muted"> · bucket rule in {listName(a.rule)}</span>}
              </span>
              <span className="muted small" title={format(a.at, "PPpp")}>
                {timeAgo(a.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.length > 6 && (
        <button className="btn ghost sm" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

function TimeTracker({ card }: { card: Card }) {
  const running = card.time.some((t) => t.end === null);
  const now = useNow(1000);
  const total = trackedMs(card, now);
  const focus = useStore((s) => s.focus);
  const focusMinutes = useStore((s) => s.data.settings.focusMinutes);
  const { startTimer, stopTimer, addTime, deleteTimeEntry, updateCard, resetTime, startFocus } = useStore.getState();
  const [manual, setManual] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [custom, setCustom] = useState("");
  const pct = card.estimate ? Math.min(100, (total / (card.estimate * 60_000)) * 100) : 0;
  const focusHere = focus?.cardId === card.id;

  return (
    <div className="time-tracker">
      <div className="row gap-sm">
        <span className={`time-total ${running ? "running" : ""}`} title="Total time tracked on this task">
          {formatDuration(total, true)}
        </span>
        {card.estimate ? <span className="muted small">/ {formatDuration(card.estimate * 60_000)}</span> : null}
        <span className="grow" />
        {running ? (
          <button className="btn sm" onClick={stopTimer} title="Pause (the time so far is kept)">
            <Pause size={13} /> Pause
          </button>
        ) : (
          <button className="btn sm primary" onClick={() => startTimer(card.id)}>
            <Play size={13} /> {total > 0 ? "Resume" : "Start"}
          </button>
        )}
      </div>
      {card.estimate ? (
        <div className={`progress-bar ${total > card.estimate * 60_000 ? "over" : ""}`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      <div className="focus-row">
        <span className="small muted">
          <Hourglass size={12} /> Focus
        </span>
        {focusHere ? (
          <span className="small">running in the sidebar</span>
        ) : (
          <>
            {[10, 15, 25, 30].map((m) => (
              <button key={m} className={`chip-btn ${m === focusMinutes ? "default" : ""}`} onClick={() => startFocus(m, card.id)}>
                {m}m
              </button>
            ))}
            <input
              className="focus-custom"
              placeholder="min"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                const m = parseDuration(custom);
                if (e.key === "Enter" && m) {
                  startFocus(m, card.id);
                  setCustom("");
                }
              }}
              title="Custom length, e.g. 45 or 1h, then Enter to start"
            />
          </>
        )}
      </div>

      <form
        className="row gap-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const m = parseDuration(manual);
          if (m) addTime(card.id, m);
          setManual("");
        }}
      >
        <input className="grow" placeholder="Log time: 1h30m, 45m…" value={manual} onChange={(e) => setManual(e.target.value)} />
      </form>
      <div className="row gap-sm">
        <Timer size={13} className="muted" />
        <span className="small muted">Estimate</span>
        <CommitInput
          className="grow"
          placeholder="e.g. 3h"
          value={card.estimate ? formatDuration(card.estimate * 60_000).replace(" ", "") : ""}
          onCommit={(v) => updateCard(card.id, { estimate: parseDuration(v) })}
        />
      </div>
      {card.time.length > 0 && (
        <div className="row gap-sm">
          <button className="btn ghost sm" onClick={() => setShowLog(!showLog)}>
            {showLog ? "Hide" : "Show"} log ({card.time.length})
          </button>
          <span className="grow" />
          <button
            className="btn ghost sm"
            title="Clear all tracked time on this task"
            onClick={() => {
              if (running) stopTimer();
              resetTime(card.id);
              useStore.getState().toast("Time reset", { undo: true });
            }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      )}
      {showLog && (
        <ul className="time-log">
          {[...card.time].reverse().map((t) => (
            <li key={t.id}>
              <span className="grow small">{format(t.start, "MMM d, HH:mm")}</span>
              <span className="small">{t.end ? formatDuration(t.end - t.start) : "running"}</span>
              <button className="icon-btn tiny" title="Delete this time entry" aria-label="Delete this time entry" onClick={() => deleteTimeEntry(card.id, t.id)}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CoverEditor({ card }: { card: Card }) {
  const updateCard = useStore((s) => s.updateCard);
  const images = card.attachments.filter((a) => a.stored && isImage(a.name, a.mime));
  const set = (patch: Partial<Card>) => updateCard(card.id, patch);
  return (
    <div className="cover-editor">
      <ColorPicker value={card.coverImage ? null : card.cover} onChange={(cover) => set({ cover, coverImage: null })} allowNone />
      {images.length > 0 && (
        <div className="cover-thumbs">
          {images.map((a) => (
            <button
              key={a.id}
              className={card.coverImage === a.id ? "sel" : ""}
              onClick={() => set({ coverImage: card.coverImage === a.id ? null : a.id })}
            >
              <img src={storedSrc(a.url)} alt={a.name} />
            </button>
          ))}
        </div>
      )}
      {(card.cover || card.coverImage) && (
        <div className="seg">
          {(["strip", "full"] as const).map((sz) => (
            <button key={sz} className={card.coverSize === sz ? "active" : ""} onClick={() => set({ coverSize: sz })}>
              {sz === "strip" ? "Strip" : "Full card"}
            </button>
          ))}
        </div>
      )}
      {images.length === 0 && <span className="muted small">Attach an image to use it as a cover.</span>}
    </div>
  );
}

const VIA_TEXT = {
  checklist: "Opened from a checklist item in",
  link: "Opened from a linked task in",
  parent: "Opened from a sub-task of",
} as const;

/** Shown when a card was opened by following a link from another card. */
function TrailBar({ cardId }: { cardId: ID }) {
  const trail = useStore((s) => s.cardTrail);
  const cards = useStore((s) => s.data.cards);
  const cardBack = useStore((s) => s.cardBack);
  const last = trail[trail.length - 1];
  const from = cards[last.cardId];
  return (
    <div className="trail-bar">
      <button className="btn sm trail-back" onClick={() => cardBack()} title="Back (Alt+←)">
        <ArrowLeft size={14} /> Back
      </button>
      <div className="trail-text">
        <span className="muted small">{VIA_TEXT[last.via]}</span>
        <nav className="crumbs" aria-label="Cards you came through">
          {trail.map((step, i) => (
            <span key={i} className="crumb">
              <button onClick={() => cardBack(i)}>{cards[step.cardId]?.title ?? "deleted card"}</button>
              <ChevronRight size={12} />
            </span>
          ))}
          <span className="crumb current" aria-current="page">
            {cards[cardId]?.title}
          </span>
        </nav>
      </div>
      <span className="grow" />
      {from && <span className="muted small hide-narrow">Alt+← to go back</span>}
    </div>
  );
}

function CustomFields({ card }: { card: Card }) {
  const board = useStore((s) => s.data.boards[card.boardId]);
  const updateCard = useStore((s) => s.updateCard);
  const setValue = (f: FieldDef, v: Card["fields"][string]) => updateCard(card.id, { fields: { ...card.fields, [f.id]: v } });
  return (
    <div className="custom-fields">
      {board.fields.map((f) => {
        const v = card.fields[f.id] ?? null;
        return (
          <label key={f.id} className="custom-field">
            <span className="cf-name">{f.name}</span>
            {f.type === "checkbox" ? (
              <input type="checkbox" checked={!!v} onChange={(e) => setValue(f, e.target.checked)} />
            ) : f.type === "select" ? (
              <select
                value={(v as string) ?? ""}
                onChange={(e) => setValue(f, e.target.value || null)}
                style={{ borderColor: f.options.find((o) => o.id === v)?.color }}
              >
                <option value="">None</option>
                {f.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "date" ? (
              <input type="date" value={(v as string) ?? ""} onChange={(e) => setValue(f, e.target.value || null)} />
            ) : (
              <span className="row gap-sm">
                <CommitInput
                  className="grow"
                  type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}
                  value={v == null ? "" : String(v)}
                  placeholder={f.type === "url" ? "https://…" : "—"}
                  spellCheck={false}
                  onCommit={(text) => {
                    const raw = text.trim();
                    const next = raw === "" ? null : f.type === "number" ? Number(raw) : raw;
                    if (next !== v) setValue(f, next);
                  }}
                />
                {f.type === "url" && v && (
                  <button type="button" className="icon-btn tiny" title="Open link" onClick={() => openExternal(String(v))}>
                    <ExternalLink size={13} />
                  </button>
                )}
              </span>
            )}
          </label>
        );
      })}
      <button className="btn sm ghost" onClick={() => useStore.getState().setOverlay({ customizeBoardId: card.boardId })}>
        <SlidersHorizontal size={13} /> Manage fields
      </button>
    </div>
  );
}
