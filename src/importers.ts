import { unzipSync, strFromU8 } from "fflate";
import type { Priority, Progress } from "./types";

/** A board in a neutral shape, ready to be turned into TCI Boards data by `importBoard`. */
export interface ImportedBoard {
  source: "Trello" | "Planner" | "Template";
  title: string;
  color?: string;
  labels: { name: string; color: string }[];
  people: string[];
  lists: {
    name: string;
    archived?: boolean;
    cards: {
      title: string;
      description?: string;
      labels?: string[];
      priority?: Priority;
      progress?: Progress;
      startDate?: string | null;
      dueDate?: string | null;
      completedAt?: number;
      assignees?: string[];
      archived?: boolean;
      checklist?: { text: string; done: boolean }[];
      comments?: { text: string; at: number }[];
      links?: { name: string; url: string }[];
      cover?: string | null;
    }[];
  }[];
  warnings: string[];
}

export const importStats = (b: ImportedBoard) => ({
  lists: b.lists.length,
  cards: b.lists.reduce((n, l) => n + l.cards.length, 0),
  labels: b.labels.length,
  people: b.people.length,
});

/** Read whatever file the user picked. */
export async function parseImportFile(file: File): Promise<ImportedBoard> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return parseTrello(JSON.parse(await file.text()), file.name);
  if (name.endsWith(".xlsx")) return parsePlannerRows(readXlsx(new Uint8Array(await file.arrayBuffer())), file.name);
  if (name.endsWith(".csv")) return parsePlannerRows(parseCsv(await file.text()), file.name);
  throw new Error("Pick a Trello board export (.json) or a Planner export (.xlsx or .csv).");
}

// ------------------------------------------------------------------ Trello

const TRELLO_COLORS: Record<string, string> = {
  green: "#22c55e", yellow: "#eab308", orange: "#f97316", red: "#ef4444", purple: "#a855f7",
  blue: "#3b82f6", sky: "#0ea5e9", lime: "#84cc16", pink: "#ec4899", black: "#475569",
};
const trelloColor = (c?: string | null) => TRELLO_COLORS[(c ?? "").replace(/_(dark|light)$/, "")] ?? "#64748b";
const isoDate = (s?: string | null) => (s ? s.slice(0, 10) : null);

export function parseTrello(j: any, fileName = "Trello board"): ImportedBoard {
  if (!j || !Array.isArray(j.lists) || !Array.isArray(j.cards))
    throw new Error("That JSON isn't a Trello board export (Board menu → Print, export and share → Export as JSON).");
  const warnings: string[] = [];
  const members = new Map<string, string>((j.members ?? []).map((m: any) => [m.id, m.fullName || m.username]));
  const labels = new Map<string, { name: string; color: string }>();
  for (const l of j.labels ?? []) labels.set(l.id, { name: l.name || l.color || "Label", color: trelloColor(l.color) });
  const checklists = new Map<string, any>((j.checklists ?? []).map((c: any) => [c.id, c]));
  const comments = new Map<string, { text: string; at: number }[]>();
  for (const a of j.actions ?? []) {
    if (a.type !== "commentCard" || !a.data?.card?.id) continue;
    const who = a.memberCreator?.fullName ? `**${a.memberCreator.fullName}:** ` : "";
    const arr = comments.get(a.data.card.id) ?? [];
    arr.push({ text: who + a.data.text, at: Date.parse(a.date) || Date.now() });
    comments.set(a.data.card.id, arr);
  }
  if ((j.actions ?? []).length >= 1000) warnings.push("Trello only exports the latest 1000 actions, so some older comments may be missing.");

  const lists = [...j.lists]
    .sort((a: any, b: any) => a.pos - b.pos)
    .map((l: any) => ({
      name: l.name,
      archived: !!l.closed,
      cards: j.cards
        .filter((c: any) => c.idList === l.id)
        .sort((a: any, b: any) => a.pos - b.pos)
        .map((c: any) => {
          const items = (c.idChecklists ?? [])
            .map((id: string) => checklists.get(id))
            .filter(Boolean)
            .flatMap((cl: any, _i: number, all: any[]) =>
              [...cl.checkItems]
                .sort((a: any, b: any) => a.pos - b.pos)
                .map((it: any) => ({ text: all.length > 1 ? `${cl.name}: ${it.name}` : it.name, done: it.state === "complete" })),
            );
          return {
            title: c.name,
            description: c.desc ?? "",
            labels: (c.idLabels ?? []).map((id: string) => labels.get(id)?.name).filter(Boolean),
            progress: (c.dueComplete ? "completed" : "notStarted") as Progress,
            startDate: isoDate(c.start),
            dueDate: isoDate(c.due),
            assignees: (c.idMembers ?? []).map((id: string) => members.get(id)).filter(Boolean),
            archived: !!c.closed,
            checklist: items,
            comments: (comments.get(c.id) ?? []).sort((a, b) => b.at - a.at),
            links: (c.attachments ?? [])
              .filter((a: any) => a.url)
              .map((a: any) => ({ name: a.name || a.url, url: a.url })),
            cover: c.cover?.color ? trelloColor(c.cover.color) : null,
          };
        }),
    }));
  if (j.cards.some((c: any) => c.attachments?.some((a: any) => a.isUpload)))
    warnings.push("Files uploaded to Trello are imported as links (they still point at Trello).");
  return {
    source: "Trello",
    title: j.name || fileName.replace(/\.json$/i, ""),
    color: j.prefs?.backgroundColor ?? undefined,
    labels: [...new Map([...labels.values()].map((l) => [l.name, l])).values()],
    people: [...new Set(members.values())],
    lists,
    warnings,
  };
}

// ------------------------------------------------------------------ Planner

/** Finds a column whose header matches any of the given names (case/space-insensitive). */
function column(header: string[], ...names: string[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z%]/g, "");
  const want = names.map(norm);
  return header.findIndex((h) => want.includes(norm(h ?? "")));
}

/** Planner/Excel dates: Excel serial numbers, ISO, or locale strings like 10/8/2026. */
function plannerDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((+s - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (us) {
    let [a, b] = [+us[1], +us[2]];
    const y = us[3].length === 2 ? 2000 + +us[3] : +us[3];
    if (a > 12) [a, b] = [b, a]; // day-first locale
    return `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

const PLANNER_LABEL_COLORS = ["#ec4899", "#ef4444", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#b45309", "#84cc16", "#14b8a6", "#64748b"];

export function parsePlannerRows(rows: string[][], fileName = "Planner plan"): ImportedBoard {
  const headerRow = rows.findIndex((r) => column(r, "Task Name", "Title", "Name") >= 0 && column(r, "Bucket Name", "Bucket") >= 0);
  if (headerRow < 0) throw new Error("Couldn't find Planner's columns (Task Name, Bucket Name…). Use Planner's “Export plan to Excel”.");
  const h = rows[headerRow];
  const col = {
    title: column(h, "Task Name", "Title", "Name"),
    bucket: column(h, "Bucket Name", "Bucket"),
    progress: column(h, "Progress", "Status", "% complete"),
    priority: column(h, "Priority"),
    assigned: column(h, "Assigned To", "Assigned to", "Assignments"),
    start: column(h, "Start Date", "Start date", "Start"),
    due: column(h, "Due Date", "Due date", "Due", "Finish"),
    completed: column(h, "Completed Date", "Completed date"),
    labels: column(h, "Labels", "Categories"),
    checklist: column(h, "Checklist Items", "Checklist"),
    doneItems: column(h, "Completed Checklist Items"),
    description: column(h, "Description", "Notes"),
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const split = (s: string) => s.split(/;|\n/).map((x) => x.trim()).filter(Boolean);

  // Plan name sits above the header in Planner's export ("Plan name | My plan").
  let title = fileName.replace(/\.(xlsx|csv)$/i, "");
  for (const r of rows.slice(0, headerRow)) if (/plan name/i.test(r[0] ?? "") && r[1]) title = r[1];

  const buckets = new Map<string, ImportedBoard["lists"][number]>();
  const labelNames = new Set<string>();
  const people = new Set<string>();
  for (const r of rows.slice(headerRow + 1)) {
    const name = get(r, col.title);
    if (!name) continue;
    const bucketName = get(r, col.bucket) || "Tasks";
    if (!buckets.has(bucketName)) buckets.set(bucketName, { name: bucketName, cards: [] });
    const prog = get(r, col.progress).toLowerCase();
    const pri = get(r, col.priority).toLowerCase();
    const assignees = split(get(r, col.assigned));
    assignees.forEach((a) => people.add(a));
    const labels = split(get(r, col.labels));
    labels.forEach((l) => labelNames.add(l));
    const done = new Set(split(get(r, col.doneItems)));
    const completedDate = plannerDate(get(r, col.completed));
    buckets.get(bucketName)!.cards.push({
      title: name,
      description: get(r, col.description),
      progress:
        prog.startsWith("complet") || prog === "100%"
          ? "completed"
          : prog.startsWith("in progress") || (/^\d+%$/.test(prog) && prog !== "0%")
            ? "inProgress"
            : "notStarted",
      priority: (["urgent", "important", "medium", "low"].find((p) => pri.startsWith(p)) as Priority) ?? "medium",
      assignees,
      labels,
      startDate: plannerDate(get(r, col.start)),
      dueDate: plannerDate(get(r, col.due)),
      completedAt: completedDate ? Date.parse(completedDate) : undefined,
      checklist: split(get(r, col.checklist)).map((text) => ({ text, done: done.has(text) })),
    });
  }
  if (!buckets.size) throw new Error("The file has Planner's columns but no tasks.");
  return {
    source: "Planner",
    title,
    labels: [...labelNames].map((name, i) => ({ name, color: PLANNER_LABEL_COLORS[i % PLANNER_LABEL_COLORS.length] })),
    people: [...people],
    lists: [...buckets.values()],
    warnings: col.description < 0 ? ["This export has no Description column, so card descriptions were not imported."] : [],
  };
}

// ------------------------------------------------------------------ file formats

/** Minimal .xlsx reader: first worksheet → rows of strings. */
export function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes);
  const xml = (path: string) => (files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), "application/xml") : null);
  const shared = xml("xl/sharedStrings.xml");
  const strings = shared ? [...shared.getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("")) : [];
  const sheetPath = Object.keys(files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort()[0];
  const sheet = sheetPath && xml(sheetPath);
  if (!sheet) throw new Error("No worksheet found in that .xlsx file.");
  const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [...sheet.getElementsByTagName("row")].map((row) => {
    const out: string[] = [];
    for (const c of row.getElementsByTagName("c")) {
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const t = c.getAttribute("t");
      const text =
        t === "s" ? strings[+v] ?? "" : t === "inlineStr" ? [...c.getElementsByTagName("t")].map((x) => x.textContent).join("") : v;
      out[colIndex(c.getAttribute("r") ?? "A")] = text;
    }
    return Array.from(out, (x) => x ?? "");
  });
}

/** RFC-4180-ish CSV (quotes, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}
