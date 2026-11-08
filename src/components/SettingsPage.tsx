import { useEffect, useRef, useState } from "react";
import { openWhatsNew } from "./WhatsNew";
import { format } from "date-fns";
import { Accessibility, Bell, Blocks, CalendarPlus, Download, FileUp, Minus, Plus, Eraser, LayoutTemplate, MessageSquare, Repeat, RotateCcw, Trash2, Upload, UserPlus, X } from "lucide-react";
import { sendFeedback } from "../feedback";
import { clearLog, readLog } from "../logs";
import { copyText } from "./Markdown";
import { exportCalendarFile } from "../icsExport";
import type { AppStyle, Settings, ViewMode } from "../types";
import { normalize, useStore } from "../store";
import {
  cleanupStoredFiles, dataLocation, deviceWord, exportFile, inTauri, isDesktopApp, isMobileApp, isPhoneOrTablet, listBackups, notify, openExternal, readBackup, type BackupInfo,
} from "../storage";
import { PALETTE } from "../utils";
import { SHORTCUTS } from "../shortcuts";
import { setZoom, ZOOM_MAX, ZOOM_MIN } from "../zoom";
import type { A11ySettings } from "../types";
import { ask, Avatar, InlineEdit } from "./ui";
import { DevicesPanel } from "./DevicesPanel";
import { ServersPanel } from "./ServersPanel";
import { DesktopPanel } from "./DesktopPanel";
import { AccountPanel } from "./AccountPanel";
import { isServer } from "../server";
import { LogoMark } from "./Logo";
import { padPressed, preloadPads, type Vowel } from "../partyCat";
import { isRemote } from "../remote";
import { currentPreset, FEATURES, featureOn, PRESETS, presetFeatures, viewShown, type Preset } from "../features";

const A11Y_OPTIONS: { key: keyof A11ySettings; name: string; hint: string }[] = [
  { key: "highContrast", name: "High contrast", hint: "Stronger borders and text; turns off card fading" },
  { key: "reduceMotion", name: "Reduce motion", hint: "No animations (also follows your system setting)" },
  { key: "strongFocus", name: "Strong focus outline", hint: "Thick ring around whatever the keyboard is on" },
  { key: "largerTargets", name: "Larger click targets", hint: "Bigger buttons, checkboxes and menu items" },
  { key: "readableSpacing", name: "Readable spacing", hint: "Extra letter, word and line spacing" },
  { key: "underlineLinks", name: "Underline links", hint: "Make every link stand out without color" },
];

const ACCENTS = ["#2580c3", "#ec6a3f", ...PALETTE.filter((c) => c !== "#0ea5e9")];

export function SettingsPage() {
  const settings = useStore((s) => s.data.settings);
  const templates = useStore((s) => s.data.templates);
  const { updateSettings, replaceData, updateTemplate, deleteTemplate } = useStore.getState();
  const [person, setPerson] = useState("");
  /** Value shown while the zoom slider is being dragged (applied on release). */
  const [zoomDraft, setZoomDraft] = useState<number | null>(null);
  const [location, setLocation] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const setReminders = (patch: Partial<Settings["reminders"]>) =>
    updateSettings({ reminders: { ...settings.reminders, ...patch } });

  useEffect(() => {
    void dataLocation().then(setLocation);
    void listBackups().then(setBackups).catch(() => setBackups([]));
  }, []);

  const doExport = async () => {
    try {
      const json = JSON.stringify(useStore.getState().data, null, 2);
      const path = await exportFile(json, `zomello-export-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`, (share) =>
        useStore.getState().toast("Your export is ready.", { action: { label: "Share", run: share } }),
      );
      if (path) setMsg({ text: `Exported to ${path}` });
    } catch (e) {
      setMsg({ text: `Export failed: ${e}`, error: true });
    }
  };

  const importJson = async (json: string, source: string) => {
    try {
      const data = normalize(JSON.parse(json));
      const n = Object.keys(data.cards).length;
      if (!(await ask(`Replace ALL current data with ${source} (${Object.keys(data.boards).length} boards, ${n} cards)? You can undo this with Ctrl+Z.`, { okText: "Replace", danger: true })))
        return;
      replaceData(data);
      setMsg({ text: `Loaded ${source}.` });
    } catch (e) {
      setMsg({ text: `Could not import: ${e}`, error: true });
    }
  };

  const cleanup = async () => {
    const d = useStore.getState().data;
    const refs = new Set<string>();
    for (const c of Object.values(d.cards)) for (const a of c.attachments) if (a.stored) refs.add(a.url);
    for (const b of Object.values(d.boards)) if (b.background.type === "image") refs.add(b.background.value);
    try {
      const n = await cleanupStoredFiles(refs);
      setMsg({ text: n ? `Removed ${n} unused file${n === 1 ? "" : "s"}.` : "No unused files found." });
    } catch (e) {
      setMsg({ text: `Cleanup failed: ${e}`, error: true });
    }
  };

  const addPerson = () => {
    const p = person.trim();
    if (p && !settings.people.includes(p)) updateSettings({ people: [...settings.people, p] });
    setPerson("");
  };

  return (
    <div className="page settings">
      <h1>Settings</h1>
      <nav className="settings-nav" aria-label="Settings sections">
        {[
          ...(isServer ? [["account", "Account"]] : []),
          ["appearance", "Appearance"],
          ["features", "Features"],
          ["accessibility", "Accessibility"],
          ["people", "People"],
          ["reminders", "Reminders"],
          ["templates", "Templates"],
          ...(!isServer && !isRemote ? [["servers", "Servers"]] : []),
          ...(isDesktopApp ? [["desktop", "Desktop app"], ["devices", "Phones & tablets"]] : []),
          ["data", "Data & backups"],
          ["about", "About"],
          // Phones and tablets have no keyboard to use them with.
          ...(isPhoneOrTablet ? [] : [["shortcuts", "Shortcuts"]]),
        ].map(([id, name]) => (
          <button key={id} onClick={() => document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            {name}
          </button>
        ))}
      </nav>

      {isServer && <AccountPanel />}

      <section className="panel" id="set-appearance">
        <h3>Appearance</h3>
        <div className="field-row">
          <label>Theme</label>
          <div className="seg">
            {(["system", "light", "dark"] as const).map((t) => (
              <button key={t} className={settings.theme === t ? "active" : ""} onClick={() => updateSettings({ theme: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {settings.unlockedStyles.length > 0 && (
          <div className="field-row">
            <label>Style</label>
            <div className="seg">
              <button className={settings.style === "classic" ? "active" : ""} onClick={() => updateSettings({ style: "classic" })}>
                Classic
              </button>
              {settings.unlockedStyles.includes("bassdrop") && (
                <button className={settings.style === "bassdrop" ? "active" : ""} onClick={() => updateSettings({ style: "bassdrop" })}>
                  🎧 Bass Drop
                </button>
              )}
              {settings.unlockedStyles.includes("partycat") && (
                <button className={settings.style === "partycat" ? "active" : ""} onClick={() => updateSettings({ style: "partycat" })}>
                  🐱 Party Cat
                </button>
              )}
              {settings.unlockedStyles.includes("undead") && (
                <button className={settings.style === "undead" ? "active" : ""} onClick={() => updateSettings({ style: "undead" })}>
                  🧟 Undead
                </button>
              )}
            </div>
            <button
              className="btn ghost sm"
              title="Put the found styles back into hiding (they can be found again)"
              onClick={async () => {
                if (!(await ask("Hide the styles you've found? TCI Boards goes back to classic, and they can be found again the same way.", { okText: "Hide them" })))
                  return;
                updateSettings({ unlockedStyles: [], style: "classic", appIcon: "classic" });
                useStore.getState().toast("Hidden again.");
              }}
            >
              Hide found styles
            </button>
          </div>
        )}
        {settings.unlockedStyles.some((s) => s !== "undead") && inTauri && (
          <div className="field-row">
            <label>App icon</label>
            <div className="seg">
              {/* Undead has no app icon (yet). */}
              {(["classic", ...settings.unlockedStyles.filter((s) => s !== "undead")] as AppStyle[]).map((s) => (
                <button key={s} className={(settings.appIcon ?? "classic") === s ? "active" : ""} onClick={() => updateSettings({ appIcon: s })}>
                  {s === "classic" ? "Classic" : s === "bassdrop" ? "Bass Drop" : "Party Cat"}
                </button>
              ))}
            </div>
            <small className="muted">
              {isMobileApp ? `The icon on this ${deviceWord}'s home screen.` : "The icon on TCI Boards's windows and in the tray while it runs."}
            </small>
          </div>
        )}
        {settings.style === "partycat" && (
          <label className="check-row">
            <input type="checkbox" checked={settings.catSings !== false} onChange={(e) => updateSettings({ catSings: e.target.checked })} />
            Let the cat sing (now and then, and when you click it)
          </label>
        )}
        <div className="field-row">
          <label>Accent</label>
          <div className="swatches">
            <button
              className={`swatch none ${settings.accent === null ? "sel" : ""}`}
              title={{ classic: "TCI Boards blue", bassdrop: "Bass Drop pink", partycat: "Party Cat teal", undead: "Undead slime green" }[settings.style] + " (default)"}
              style={{
                background: {
                  classic: "linear-gradient(135deg, #2580c3, #4fb0ec)",
                  bassdrop: "linear-gradient(135deg, #ff3fa4, #22e1ff)",
                  partycat: "linear-gradient(135deg, #3dd6d0, #ff5e7e)",
                  undead: "linear-gradient(135deg, #8fd14f, #b3261e)",
                }[settings.style],
              }}
              onClick={() => updateSettings({ accent: null })}
            />
            {ACCENTS.map((c) => (
              <button
                key={c}
                className={`swatch ${settings.accent === c ? "sel" : ""}`}
                style={{ background: c }}
                onClick={() => updateSettings({ accent: c })}
              />
            ))}
            <label className="swatch custom" title="Any color">
              <input type="color" value={settings.accent ?? "#2580c3"} onChange={(e) => updateSettings({ accent: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="field-row">
          <label>Density</label>
          <div className="seg">
            {(["compact", "normal", "comfortable"] as const).map((d) => (
              <button key={d} className={settings.density === d ? "active" : ""} onClick={() => updateSettings({ density: d })}>
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <label>Week starts on</label>
          <div className="seg">
            <button className={settings.weekStartsOn === 0 ? "active" : ""} onClick={() => updateSettings({ weekStartsOn: 0 })}>
              Sunday
            </button>
            <button className={settings.weekStartsOn === 1 ? "active" : ""} onClick={() => updateSettings({ weekStartsOn: 1 })}>
              Monday
            </button>
          </div>
        </div>
        <div className="field-row">
          <label>New boards open in</label>
          <select value={settings.defaultView} onChange={(e) => updateSettings({ defaultView: e.target.value as ViewMode })}>
            <option value="board">Board view</option>
            {viewShown(settings, "list") && <option value="list">List view</option>}
            <option value="calendar">Calendar view</option>
            {viewShown(settings, "timeline") && <option value="timeline">Timeline view</option>}
          </select>
        </div>
        <p className="muted small">Each board also has its own look: open a board and press Customize (or B).</p>
      </section>

      <FeaturesPanel />

      <section className="panel" id="set-accessibility">
        <h3>
          <Accessibility size={15} /> Accessibility
        </h3>
        {!isRemote && (
        <>
        <div className="field-row">
          <label>Zoom</label>
          <div className="zoom-control">
            <button className="icon-btn" title="Zoom out (Ctrl −)" onClick={() => setZoom(settings.zoom - 0.1)}>
              <Minus size={15} />
            </button>
            <ZoomSlider zoom={settings.zoom} onPreview={setZoomDraft} />
            <button className="icon-btn" title="Zoom in (Ctrl +)" onClick={() => setZoom(settings.zoom + 0.1)}>
              <Plus size={15} />
            </button>
            <span className="zoom-value">{Math.round((zoomDraft ?? settings.zoom) * 100)}%</span>
            {settings.zoom !== 1 && (
              <button className="btn sm ghost" onClick={() => setZoom(1)}>
                Reset
              </button>
            )}
          </div>
        </div>
        <p className="muted small">Hold Ctrl and scroll, or use Ctrl + / Ctrl − / Ctrl 0, anywhere in the app.</p>
        </>
        )}
        <div className="a11y-grid">
          {A11Y_OPTIONS.map((o) => (
            <label key={o.key} className="check-row">
              <input
                type="checkbox"
                checked={settings.a11y[o.key]}
                onChange={(e) => updateSettings({ a11y: { ...settings.a11y, [o.key]: e.target.checked } })}
              />
              <span>
                {o.name}
                <small className="muted">{o.hint}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel" id="set-people">
        <h3>People</h3>
        <p className="muted small">
          {isServer
            ? "Everyone on this server can be assigned tasks. You can also add names of people who don't have an account."
            : 'People you can assign tasks to. Click a name to rename it everywhere. "Me" is you: it drives My Tasks, Home and reminders.'}
        </p>
        {!isServer && (
        <div className="field-row">
          <label>Me</label>
          <select value={settings.me} onChange={(e) => updateSettings({ me: e.target.value })}>
            <option value="">(nobody)</option>
            {settings.people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        )}
        <div className="row wrap gap-sm">
          {settings.people.map((p) => (
            <span key={p} className="chip">
              <Avatar name={p} size={18} />
              <InlineEdit value={p} onSave={(name) => useStore.getState().renamePerson(p, name)} />
              <button
                className="icon-btn tiny"
                onClick={() => updateSettings({ people: settings.people.filter((x) => x !== p), me: settings.me === p ? "" : settings.me })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="row gap-sm" style={{ marginTop: 10 }}>
          <input placeholder="Add a person…" value={person} onChange={(e) => setPerson(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPerson()} />
          <button className="btn sm" onClick={addPerson}>
            <UserPlus size={14} /> Add
          </button>
        </div>
      </section>

      <section className="panel" id="set-reminders">
        <h3>
          <Bell size={15} /> Reminders
        </h3>
        <label className="check-row">
          <input type="checkbox" checked={settings.reminders.enabled} onChange={(e) => setReminders({ enabled: e.target.checked })} />
          {isPhoneOrTablet ? "Notifications" : "Desktop notifications"}
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.reminders.digest}
            disabled={!settings.reminders.enabled}
            onChange={(e) => setReminders({ digest: e.target.checked })}
          />
          Daily summary of late and due-today tasks at
          <input
            type="time"
            value={settings.reminders.digestTime}
            disabled={!settings.reminders.enabled || !settings.reminders.digest}
            onChange={(e) => e.target.value && setReminders({ digestTime: e.target.value })}
          />
        </label>
        <p className="muted small">
          {isMobileApp
            ? `Set a reminder on any card (card → Reminder, or press and hold → Remind me). They arrive even when TCI Boards is closed; the daily summary counts your cards as they were when you last opened TCI Boards.`
            : "Set a reminder on any card (card → Reminder, or right-click → Remind me). Notifications appear while TCI Boards is running."}
        </p>
        <button className="btn sm" onClick={() => void notify("TCI Boards", "Notifications are working.")}>
          Send a test notification
        </button>
      </section>

      <section className="panel" id="set-adding">
        <h3>
          <Repeat size={15} /> Adding tasks
        </h3>
        <label className="check-row">
          <input type="checkbox" checked={settings.titleRepeats !== false} onChange={(e) => updateSettings({ titleRepeats: e.target.checked })} />
          Read repeats in titles
        </label>
        <p className="muted small">
          End a new task's title with a repeat and TCI Boards sets it: “Water plants every monday”, “Rent monthly on the 1st”, “Standup daily at 9:30 until Dec 20”.
          Dates and times (“tomorrow 3pm”) are always read. Under the title, × keeps the words as typed.
        </p>
      </section>

      <section className="panel" id="set-templates">
        <h3>
          <LayoutTemplate size={15} /> Card templates
        </h3>
        {templates.length === 0 ? (
          <p className="muted small">Open a card and choose “Save as template”. Templates appear under “+ Add card” and in Quick add.</p>
        ) : (
          <ul className="archive-list">
            {templates.map((t) => (
              <li key={t.id}>
                <LayoutTemplate size={15} className="muted" />
                <InlineEdit className="grow" value={t.name} onSave={(name) => updateTemplate(t.id, { name })} />
                <span className="muted small">
                  {t.checklist.length} checklist items · {t.labels.length} labels
                </span>
                <button className="icon-btn danger" title="Delete template" onClick={() => deleteTemplate(t.id)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isServer && !isRemote && <ServersPanel />}
      {isDesktopApp && <DesktopPanel />}
      {isDesktopApp && <DevicesPanel />}

      <section className="panel" id="set-data">
        <h3>Data</h3>
        <p className="muted small">
          Everything is stored locally at <code>{location}</code>. Attached files live in an <code>attachments</code>{" "}
          folder next to it.
        </p>
        <div className="row gap-sm wrap">
          <button className="btn" onClick={doExport}>
            <Download size={14} /> Export JSON
          </button>
          <button className="btn" onClick={() => void exportCalendarFile()} title="Every dated card (not private boards), for Google Calendar, Outlook or Apple Calendar">
            <CalendarPlus size={14} /> Calendar file (.ics)
          </button>
          {/* On a shared server a restore would replace other people's boards too. */}
          {!isServer && (
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Restore from TCI Boards JSON
            </button>
          )}
          <button className="btn" onClick={() => useStore.getState().setOverlay({ importOpen: true })}>
            <FileUp size={14} /> Import a board (file, Trello, Planner)
          </button>
          {inTauri && (
            <button className="btn" onClick={cleanup} title="Delete stored files no card or board uses any more">
              <Eraser size={14} /> Clean up unused files
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await importJson(await f.text(), f.name);
            }}
          />
        </div>
        {msg && <p className={`small ${msg.error ? "danger-text" : "ok-text"}`}>{msg.text}</p>}
      </section>

      {inTauri && (
        <section className="panel" id="set-backups">
          <h3>Automatic backups</h3>
          <p className="muted small">A snapshot is kept every 30 minutes while you work (last 30 kept).</p>
          {backups.length === 0 && <p className="muted small">No backups yet.</p>}
          <ul className="archive-list">
            {backups.map((b) => (
              <li key={b.timestamp}>
                <span className="grow">{format(b.timestamp * 1000, "EEE MMM d, yyyy · HH:mm")}</span>
                <span className="muted small">{(b.size / 1024).toFixed(1)} KB</span>
                <button
                  className="btn sm"
                  onClick={async () => importJson(await readBackup(b.timestamp), `backup from ${format(b.timestamp * 1000, "MMM d HH:mm")}`)}
                >
                  <RotateCcw size={14} /> Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AboutPanel />

      {!isPhoneOrTablet && (
        <section className="panel" id="set-shortcuts">
          <h3>Keyboard shortcuts</h3>
          <ShortcutList />
        </section>
      )}
    </div>
  );
}

export function ShortcutList() {
  return (
    <div className="shortcut-groups">
      {SHORTCUTS.map((g) => (
        <div key={g.group}>
          <h4>{g.group}</h4>
          <dl>
            {g.items.map(([k, v]) => (
              <div key={k}>
                <dt>
                  {k.split(/\s{2}or\s{2}/).map((combo, i) => (
                    <span key={i}>
                      {i > 0 && <span className="muted"> or </span>}
                      {combo.split(" ").map((part) => (
                        <kbd key={part}>{part}</kbd>
                      ))}
                    </span>
                  ))}
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * Zoom slider that only applies on release: dragging just previews the number (zooming the whole
 * window mid-drag would move the slider out from under the pointer). Arrow keys apply on key-up.
 */
function ZoomSlider({ zoom, onPreview }: { zoom: number; onPreview: (z: number | null) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? Math.round(zoom * 100);
  const commit = () => {
    if (draft !== null && draft / 100 !== zoom) setZoom(draft / 100);
    setDraft(null);
    onPreview(null);
  };
  return (
    <input
      type="range"
      min={ZOOM_MIN * 100}
      max={ZOOM_MAX * 100}
      step={10}
      value={value}
      aria-label="Zoom level"
      aria-valuetext={`${value}%`}
      onChange={(e) => {
        setDraft(+e.target.value);
        onPreview(+e.target.value / 100);
      }}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}

/** Version and credits, plus three little beat pads (they sing; there may be a song in them). */
/** About > Problem log: errors and crashes this device noted, to copy or save for a bug report. */
function LogRow() {
  const [lines, setLines] = useState<number | null>(null);
  useEffect(() => void readLog().then((t) => setLines(t.split("\n").filter(Boolean).length)), []);
  const { toast } = useStore.getState();
  const withLog = async (use: (text: string) => Promise<unknown>) => {
    const text = await readLog();
    if (!text) return toast("The log is empty: nothing has gone wrong on this device.");
    await use(`TCI Boards ${__APP_VERSION__} log\n\n${text}`);
  };
  return (
    <p className="muted small about-log">
      Problem log{lines !== null && `: ${lines} ${lines === 1 ? "line" : "lines"}`}, kept on this device only.{" "}
      <button className="btn ghost sm" onClick={() => void withLog((t) => copyText(t, "Log copied"))}>
        Copy
      </button>
      <button
        className="btn ghost sm"
        onClick={() =>
          void withLog(async (t) => {
            const saved = await exportFile(t, `zomello-log-${format(new Date(), "yyyy-MM-dd")}.txt`);
            if (saved) toast(`Saved ${saved}`);
          }).catch(() => toast("Couldn't save the log."))
        }
      >
        Save
      </button>
      {!!lines && (
        <button
          className="btn ghost sm"
          onClick={async () => {
            if (!(await ask("Clear the problem log?", { okText: "Clear", danger: true }))) return;
            await clearLog();
            setLines(0);
          }}
        >
          Clear
        </button>
      )}
    </p>
  );
}

function AboutPanel() {
  const [hit, setHit] = useState<Vowel | null>(null);
  const [bop, setBop] = useState(0);
  useEffect(() => void preloadPads(), []);
  const pads: { v: Vowel; title: string }[] = [
    { v: "O", title: "Pad 1" },
    { v: "I", title: "Pad 2" },
    { v: "A", title: "Pad 3" },
  ];
  return (
    <section className="panel" id="set-about">
      <h3>About TCI Boards</h3>
      <div className="about-row">
        {/* Bops along while the notes are right. */}
        <span key={bop} className={bop ? "about-logo bop" : "about-logo"}>
          <LogoMark size={44} />
        </span>
        <div>
          <p>
            <b>TCI Boards</b> {__APP_VERSION__}{" "}
            <button className="btn ghost sm" onClick={openWhatsNew}>
              What's new
            </button>
          </p>
          <p className="muted small">Boards, tasks &amp; planning for TCI Casing Specialties.</p>
          <p className="muted small">
            TCI's fork of Zomello by ZomBeatz Media — free and open source under the MIT license.{" "}
            <a href="https://github.com/kasemeyer/Zomello" onClick={(e) => (e.preventDefault(), void openExternal("https://github.com/kasemeyer/Zomello"))}>
              See the code
            </a>
          </p>
          <button className="btn sm about-feedback" onClick={() => void sendFeedback()}>
            <MessageSquare size={14} /> Send feedback
          </button>
          <LogRow />
        </div>
        <div className="beat-pads" aria-label="Beat pads">
          {pads.map((p) => (
            <button
              key={p.v}
              className={`beat-pad ${hit === p.v ? "hit" : ""}`}
              title={p.title}
              aria-label={`Beat pad: ${p.title}`}
              onClick={() => {
                setHit(p.v);
                setTimeout(() => setHit(null), 120);
                const r = padPressed(p.v);
                setBop(r.streak > 1 && !r.done ? (n) => n + 1 : 0);
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Settings > Features: start simple and turn on more as you need it. Nothing is deleted by turning a group off. */
function FeaturesPanel() {
  const settings = useStore((s) => s.data.settings);
  const { updateSettings } = useStore.getState();
  const preset = currentPreset(settings);
  return (
    <section className="panel" id="set-features">
      <h3>
        <Blocks size={15} /> Features
      </h3>
      <p className="muted small">
        Choose how much TCI Boards shows. Turning something off only hides its buttons and menus: nothing is deleted, and a card that
        already uses it still shows it.
      </p>
      <div className="seg feature-presets" role="group" aria-label="Feature presets">
        {(Object.keys(PRESETS) as Preset[]).map((p) => (
          <button key={p} className={preset === p ? "active" : ""} aria-pressed={preset === p} title={PRESETS[p].what} onClick={() => updateSettings({ features: presetFeatures(p) })}>
            {PRESETS[p].name}
          </button>
        ))}
        {!preset && <span className="muted small feature-custom">Your own mix</span>}
      </div>
      <p className="muted small">{preset ? PRESETS[preset].what : "Some groups on, some off."}</p>
      <div className="feature-list">
        {FEATURES.map((f) => (
          <label key={f.id} className="check-row feature-row">
            <input
              type="checkbox"
              checked={featureOn(settings, f.id)}
              onChange={(e) => updateSettings({ features: { ...settings.features, [f.id]: e.target.checked } })}
            />
            <span>
              <b>{f.name}</b>
              <small className="muted">{f.what}</small>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
