import { useState } from "react";
import { WHATS_NEW } from "./WhatsNew";
import {
  ArrowLeft, ArrowRight, FileUp, Keyboard, LayoutGrid, MousePointerClick, Move, Search, Sparkles, Undo2, Zap,
} from "lucide-react";
import { useStore } from "../store";
import { byOrder } from "../utils";
import { isServer, loadData, updateProfile } from "../server";
import { LogoMark } from "./Logo";
import { deviceWord, isDesktopApp, isMobileApp, isPhoneOrTablet } from "../storage";
import { Modal } from "./ui";
import { presetFeatures, PRESETS, type Preset } from "../features";

type Start = "explore" | "empty" | "import";

/**
 * First-run guide: who you are, how TCI Boards is organized, the handful of things worth knowing on day
 * one, and how to start. Shown once on a fresh install; Help → "Welcome guide" opens it again.
 */
export function WelcomeGuide({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.data.settings);
  const firstRun = !settings.onboarded;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.me === "Me" ? "" : settings.me);
  const [start, setStart] = useState<Start>("explore");
  const [boardName, setBoardName] = useState("");
  // New people start with less on screen; phones and tablets with the least.
  const [level, setLevel] = useState<Preset>(isPhoneOrTablet ? "simple" : "standard");
  const steps = firstRun ? 4 : 3;

  const finish = () => {
    const st = useStore.getState();
    const me = st.data.settings.me;
    if (isServer && name.trim() && name.trim() !== me) {
      // On a server your name belongs to your account.
      void updateProfile(name.trim()).then(async () => st.reloadFromServer(await loadData())).catch(() => {});
    } else if (name.trim() && name.trim() !== me) {
      if (me) st.renamePerson(me, name.trim());
      else st.updateSettings({ me: name.trim(), people: [...new Set([...st.data.settings.people, name.trim()])] });
    }
    // Someone new doesn't need to hear what's new.
    st.updateSettings({ onboarded: true, seenWhatsNew: WHATS_NEW.version, ...(firstRun ? { features: presetFeatures(level) } : {}) });
    onClose();
    if (!firstRun) return;
    if (start === "empty") {
      // The tutorial board goes away (Ctrl+Z brings it back) and a fresh one opens.
      const sample = Object.values(st.data.boards).find((b) => b.title === "Getting started");
      const id = st.createBoard(boardName.trim() || "My board");
      if (sample) st.deleteBoard(sample.id);
      st.navigate({ page: "board", boardId: id });
    } else if (start === "import") {
      st.setOverlay({ importOpen: true });
    } else {
      const first = Object.values(st.data.boards).filter((b) => !b.archived).sort(byOrder)[0];
      if (first) st.navigate({ page: "board", boardId: first.id });
    }
  };

  const skip = () => {
    useStore.getState().updateSettings({ onboarded: true, seenWhatsNew: WHATS_NEW.version });
    onClose();
  };

  return (
    <Modal onClose={skip} width={620} className="welcome">
      <div className="welcome-body">
        {step === 0 && (
          <section>
            <div className="welcome-hero">
              <LogoMark size={64} />
              <div>
                <h2>{firstRun ? "Welcome to TCI Boards" : "TCI Boards in a minute"}</h2>
                <p className="muted">
                  {isServer
                    ? "Boards like Trello and task details like Planner, on your own TCI Boards server. Make your own boards, or work on boards people share with you."
                    : `Boards like Trello, task details like Planner, and everything stays on this ${isMobileApp ? "device" : "computer"}. No account needed.`}
                </p>
              </div>
            </div>
            <label className="welcome-field">
              What's your name?
              <input
                autoFocus
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setStep(1)}
              />
              <span className="muted small">
                {isServer ? "This is how others see you on shared boards. " : ""}Tasks assigned to you show up on Home and in My Tasks.
              </span>
            </label>
            <div className="welcome-field">
              Look
              <div className="seg">
                {(["system", "light", "dark"] as const).map((t) => (
                  <button key={t} className={settings.theme === t ? "active" : ""} onClick={() => useStore.getState().updateSettings({ theme: t })}>
                    {t === "system" ? (isPhoneOrTablet ? `Match my ${deviceWord}` : "Match my computer") : t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h2>How it's organized</h2>
            <MiniBoard />
            <dl className="welcome-terms">
              <dt>Board</dt>
              <dd>A project or an area of life: “Home”, “Work”, “Garage build”.</dd>
              <dt>List</dt>
              <dd>A column on the board, usually a stage: To do, In progress, Done.</dd>
              <dt>Card</dt>
              <dd>One task. Open it for a checklist, dates, people, files, notes and more.</dd>
            </dl>
            <p className="muted small">
              Moving a card into <b>In progress</b> or <b>Done</b> updates it for you. When you complete a card in any other
              list, it tucks away under <b>Show completed</b> at the bottom of that list.
            </p>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>The essentials</h2>
            <ul className="welcome-tips">
              <li>
                <MousePointerClick size={18} />
                <span>
                  {isPhoneOrTablet ? (
                    <>
                      <b>Tap a card</b> to open it. The back button closes it; everything saves as you go.
                    </>
                  ) : (
                    <>
                      <b>Click a card</b> to open it. Esc or clicking outside closes it; everything saves as you go.
                    </>
                  )}
                </span>
              </li>
              <li>
                <Move size={18} />
                <span>
                  <b>Drag</b> cards between lists, and lists by their title.{isPhoneOrTablet ? " Swipe sideways to see the next list." : ""}
                </span>
              </li>
              <li>
                <LayoutGrid size={18} />
                <span>
                  {isPhoneOrTablet ? (
                    <>
                      <b>Press and hold</b> cards, lists and boards for their options.
                    </>
                  ) : (
                    <>
                      <b>Right-click</b> cards, lists and boards for their options. On a phone or tablet, press and hold.
                    </>
                  )}
                </span>
              </li>
              <li>
                <Zap size={18} />
                <span>
                  {isPhoneOrTablet ? (
                    <>
                      <b>+</b> at the top adds a task from anywhere (Quick add).
                    </>
                  ) : (
                    <>
                      <b>N</b> adds a task from anywhere (Quick add).
                    </>
                  )}
                </span>
              </li>
              <li>
                <Search size={18} />
                <span>
                  <b>{isPhoneOrTablet ? "The magnifier" : "Ctrl+K"}</b> searches every board, checklist and note.
                </span>
              </li>
              <li>
                <Undo2 size={18} />
                <span>
                  {isPhoneOrTablet ? (
                    <>
                      <b>Undo</b> on the message that pops up brings back anything, even a delete.
                    </>
                  ) : (
                    <>
                      <b>Ctrl+Z</b> undoes anything, even a delete.
                    </>
                  )}
                </span>
              </li>
            </ul>
            <p className="muted small">
              {isPhoneOrTablet ? (
                <>
                  Open <b>Help</b> in the menu (☰) to see this guide again.
                </>
              ) : (
                <>
                  <Keyboard size={13} className="inline-icon" /> Press <kbd>?</kbd> any time for every shortcut, or open
                  <b> Help</b> in the sidebar to see this guide again.
                </>
              )}
            </p>
          </section>
        )}

        {step === 3 && firstRun && (
          <section>
            <h2>How do you want to start?</h2>
            <div className="welcome-choices">
              <label className={`welcome-choice ${start === "explore" ? "on" : ""}`}>
                <input type="radio" name="start" checked={start === "explore"} onChange={() => setStart("explore")} />
                <Sparkles size={18} />
                <span>
                  <b>Explore the “Getting started” board</b>
                  <small className="muted">Each card there shows one feature. Delete the board when you're done with it.</small>
                </span>
              </label>
              <label className={`welcome-choice ${start === "empty" ? "on" : ""}`}>
                <input type="radio" name="start" checked={start === "empty"} onChange={() => setStart("empty")} />
                <LayoutGrid size={18} />
                <span>
                  <b>Start with an empty board</b>
                  <small className="muted">The tutorial board is removed.</small>
                  {start === "empty" && (
                    <input
                      className="welcome-board-name"
                      autoFocus
                      placeholder="Board name, e.g. Home"
                      value={boardName}
                      onChange={(e) => setBoardName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && finish()}
                    />
                  )}
                </span>
              </label>
              <label className={`welcome-choice ${start === "import" ? "on" : ""}`}>
                <input type="radio" name="start" checked={start === "import"} onChange={() => setStart("import")} />
                <FileUp size={18} />
                <span>
                  <b>Bring my boards from Trello or Planner</b>
                  <small className="muted">Opens the import window next.</small>
                </span>
              </label>
            </div>
            <h3 className="welcome-sub">How much should TCI Boards show?</h3>
            <div className="seg" role="group" aria-label="How much TCI Boards shows">
              {(Object.keys(PRESETS) as Preset[]).map((p) => (
                <button key={p} className={level === p ? "active" : ""} aria-pressed={level === p} onClick={() => setLevel(p)}>
                  {PRESETS[p].name}
                </button>
              ))}
            </div>
            <p className="muted small">{PRESETS[level].what}. Change it any time in Settings &gt; Features.</p>
            <p className="muted small">
              {isDesktopApp
                ? "Extras when you want them, in Settings: use it on your phone or tablet, TCI Boards servers, backups, AI helpers and more."
                : "Extras when you want them are in Settings: TCI Boards servers, backups, AI helpers and more."}
            </p>
          </section>
        )}
      </div>

      <footer className="welcome-foot">
        <div className="welcome-dots" aria-label={`Step ${step + 1} of ${steps}`}>
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={i === step ? "on" : ""} />
          ))}
        </div>
        <span className="grow" />
        {step === 0 ? (
          <button className="btn ghost" onClick={skip}>
            Skip
          </button>
        ) : (
          <button className="btn ghost" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={15} /> Back
          </button>
        )}
        {step < steps - 1 ? (
          <button className="btn primary" onClick={() => setStep(step + 1)}>
            Next <ArrowRight size={15} />
          </button>
        ) : (
          <button className="btn primary" onClick={finish}>
            {firstRun ? "Let's go" : "Done"}
          </button>
        )}
      </footer>
    </Modal>
  );
}

/** A tiny drawing of a board: three buckets with a few cards. */
function MiniBoard() {
  const cols = [
    { title: "To do", cards: 3 },
    { title: "In progress", cards: 2 },
    { title: "Done", cards: 1 },
  ];
  return (
    <div className="mini-board" aria-hidden="true">
      <div className="mini-board-title">Board</div>
      <div className="mini-cols">
        {cols.map((c, i) => (
          <div key={c.title} className="mini-col">
            <div className="mini-col-title">
              {c.title}
              {i === 0 && <span className="mini-tag">List</span>}
            </div>
            {Array.from({ length: c.cards }, (_, j) => (
              <div key={j} className={`mini-card ${i === 2 ? "done" : ""}`}>
                {i === 0 && j === 0 && <span className="mini-tag">Card</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
