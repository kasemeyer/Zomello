import type { Card, List } from "../../types";
import { formatDuration, isLate, PRIORITIES, PROGRESS, trackedMs } from "../../utils";

/** Stacked segments: not started / in progress / completed, with late split out. */
const SEGMENTS = [
  { key: "late", name: "Late", color: "#ef4444", test: (c: Card) => isLate(c) },
  ...PROGRESS.map((p) => ({ key: p.id, name: p.name, color: p.color, test: (c: Card) => c.progress === p.id && !isLate(c) })),
];

function StackedRow({ label, cards, max }: { label: string; cards: Card[]; max: number }) {
  return (
    <div className="chart-row">
      <span className="chart-label" title={label}>{label}</span>
      <div className="chart-track">
        <div className="chart-stack" style={{ width: max ? `${(cards.length / max) * 100}%` : 0 }}>
          {SEGMENTS.map((s) => {
            const n = cards.filter(s.test).length;
            return n ? (
              <span
                key={s.key}
                className="chart-seg"
                style={{ flexGrow: n, background: s.color }}
                title={`${label} · ${s.name}: ${n} of ${cards.length}`}
              />
            ) : null;
          })}
        </div>
      </div>
      <span className="chart-value">{cards.length}</span>
    </div>
  );
}

function Panel({ title, rows }: { title: string; rows: { label: string; cards: Card[] }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.cards.length));
  return (
    <section className="panel">
      <h3>{title}</h3>
      {rows.map((r) => (
        <StackedRow key={r.label} label={r.label} cards={r.cards} max={max} />
      ))}
      {rows.length === 0 && <p className="muted small">Nothing yet.</p>}
    </section>
  );
}

export function ChartsView({ lists, cards, people }: { lists: List[]; cards: Card[]; people: string[] }) {
  const count = (t: (c: Card) => boolean) => cards.filter(t).length;
  const done = count((c) => c.progress === "completed");
  const pct = cards.length ? Math.round((done / cards.length) * 100) : 0;
  const assignees = Array.from(new Set([...people, ...cards.flatMap((c) => c.assignees)]));

  const tiles: { label: string; value: number; sub?: string; color?: string }[] = [
    { label: "Total tasks", value: cards.length },
    // Every status, skipping Waiting / On hold while nothing is in them.
    ...PROGRESS.filter((p) => p.id !== "completed")
      .map((p) => ({ label: p.name, value: count((c) => c.progress === p.id), color: p.color }))
      .filter((t, i) => i < 2 || t.value > 0),
    { label: "Completed", value: done, sub: `${pct}%`, color: PROGRESS.find((p) => p.id === "completed")!.color },
    { label: "Late", value: count(isLate), color: "#ef4444" },
  ];

  return (
    <div className="charts">
      <div className="stat-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="stat-tile">
            <span className="stat-label">
              {t.color && <span className="dot" style={{ background: t.color }} />}
              {t.label}
            </span>
            <span className="stat-value">
              {t.value}
              {t.sub && <small> {t.sub}</small>}
            </span>
          </div>
        ))}
      </div>

      <section className="panel">
        <h3>Overall progress</h3>
        <StackedRow label="All tasks" cards={cards} max={cards.length} />
        <div className="legend">
          {SEGMENTS.map((s) => (
            <span key={s.key}>
              <span className="dot" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      </section>

      <TimePanel lists={lists} cards={cards} />

      <div className="panel-grid">
        <Panel title="By list" rows={lists.map((l) => ({ label: l.title, cards: cards.filter((c) => c.listId === l.id) }))} />
        <Panel title="By priority" rows={PRIORITIES.map((p) => ({ label: p.name, cards: cards.filter((c) => c.priority === p.id) }))} />
        <Panel
          title="By assignee"
          rows={[
            { label: "Unassigned", cards: cards.filter((c) => c.assignees.length === 0) },
            ...assignees.map((a) => ({ label: a, cards: cards.filter((c) => c.assignees.includes(a)) })),
          ].filter((r) => r.cards.length > 0)}
        />
      </div>
    </div>
  );
}

function TimePanel({ lists, cards }: { lists: List[]; cards: Card[] }) {
  const total = cards.reduce((s, c) => s + trackedMs(c), 0);
  const estimated = cards.reduce((s, c) => s + (c.estimate ?? 0) * 60_000, 0);
  if (!total && !estimated) return null;
  const top = [...cards].filter((c) => trackedMs(c) > 0).sort((a, b) => trackedMs(b) - trackedMs(a)).slice(0, 8);
  const byList = lists
    .map((l) => ({ label: l.title, ms: cards.filter((c) => c.listId === l.id).reduce((s, c) => s + trackedMs(c), 0) }))
    .filter((r) => r.ms > 0);
  const max = Math.max(1, ...top.map(trackedMs), ...byList.map((r) => r.ms));
  const Bar = ({ label, ms, est }: { label: string; ms: number; est?: number | null }) => (
    <div className="chart-row">
      <span className="chart-label" title={label}>{label}</span>
      <div className="chart-track">
        <div className="chart-stack" style={{ width: `${(ms / max) * 100}%` }}>
          <span
            className="chart-seg"
            style={{ flexGrow: 1, background: est && ms > est * 60_000 ? "#ef4444" : "var(--accent)" }}
            title={`${label}: ${formatDuration(ms)}${est ? ` of ${formatDuration(est * 60_000)} estimated` : ""}`}
          />
        </div>
      </div>
      <span className="chart-value wide">{formatDuration(ms)}</span>
    </div>
  );
  return (
    <section className="panel">
      <h3>
        Time tracked <span className="muted small">{formatDuration(total)} total{estimated ? ` · ${formatDuration(estimated)} estimated` : ""}</span>
      </h3>
      <div className="panel-grid">
        <div>
          <h4>By list</h4>
          {byList.map((r) => <Bar key={r.label} label={r.label} ms={r.ms} />)}
        </div>
        <div>
          <h4>Top tasks</h4>
          {top.map((c) => <Bar key={c.id} label={c.title} ms={trackedMs(c)} est={c.estimate} />)}
        </div>
      </div>
    </section>
  );
}
