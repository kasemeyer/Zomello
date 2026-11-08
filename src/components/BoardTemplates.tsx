import { LayoutTemplate, Trash2, X } from "lucide-react";
import { BOARD_TEMPLATES, templateBoard, type BoardTemplate } from "../boardTemplates";
import { useStore } from "../store";
import { InlineEdit, Modal } from "./ui";

/** Home > Start from a template: your own templates (board menu > Save as template) and ready-made boards. */
export function BoardTemplates() {
  const mine = useStore((s) => s.data.boardTemplates);
  const close = () => useStore.getState().setOverlay({ templatesOpen: false });
  const use = (t: BoardTemplate) => {
    const st = useStore.getState();
    const taken = Object.values(st.data.boards).map((b) => b.title);
    let title = t.name;
    for (let n = 2; taken.includes(title); n++) title = `${t.name} (${n})`;
    const id = st.importBoard({ ...templateBoard(t), title }, { addPeople: false });
    st.updateBoard(id, { icon: t.icon });
    close();
    st.navigate({ page: "board", boardId: id });
    st.toast(`Made “${title}” from a template. Rename it, or change anything you like.`, { undo: true });
  };
  const remove = (t: BoardTemplate) => {
    const st = useStore.getState();
    st.deleteBoardTemplate(t.id);
    st.toast(`Deleted the template “${t.name}”`, { undo: true });
  };
  const buckets = (t: BoardTemplate) => (
    <span className="template-buckets">
      {t.lists.map((l, i) => (
        <span key={i}>{l.name}</span>
      ))}
    </span>
  );
  return (
    <Modal onClose={close} width={760}>
      <header className="customize-head">
        <h2>
          <LayoutTemplate size={18} /> Start from a template
        </h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        {mine.length > 0 && (
          <>
            <h3 className="template-heading">Your templates</h3>
            <div className="template-grid">
              {mine.map((t) => {
                const cards = t.lists.reduce((n, l) => n + l.cards.length, 0);
                return (
                  <div key={t.id} className="template-tile mine" style={{ "--c": t.color } as React.CSSProperties}>
                    <span className="template-name">
                      <span aria-hidden>{t.icon}</span>
                      <InlineEdit className="grow" value={t.name} onSave={(name) => name.trim() && useStore.getState().renameBoardTemplate(t.id, name.trim())} />
                      <button className="icon-btn tiny" title="Delete template" aria-label={`Delete the template ${t.name}`} onClick={() => remove(t)}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                    <span className="muted small">
                      {t.about || `${t.lists.length} ${t.lists.length === 1 ? "list" : "lists"}, ${cards} ${cards === 1 ? "card" : "cards"}`}
                    </span>
                    {buckets(t)}
                    <button className="btn sm" onClick={() => use(t)}>
                      Make a board
                    </button>
                  </div>
                );
              })}
            </div>
            <h3 className="template-heading">Ready-made</h3>
          </>
        )}
        <div className="template-grid">
          {BOARD_TEMPLATES.map((t) => (
            <button key={t.id} className="template-tile" style={{ "--c": t.color } as React.CSSProperties} onClick={() => use(t)}>
              <span className="template-name">
                <span aria-hidden>{t.icon}</span> {t.name}
              </span>
              <span className="muted small">{t.about}</span>
              {buckets(t)}
            </button>
          ))}
        </div>
        {mine.length === 0 && <p className="muted small template-hint">To make your own, open a board's menu and choose Save as template.</p>}
      </div>
    </Modal>
  );
}
