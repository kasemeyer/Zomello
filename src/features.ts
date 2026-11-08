import { useStore } from "./store";
import type { Card, CardSection, Settings, ViewMode } from "./types";

/**
 * Feature groups people can turn off in Settings > Features, so TCI Boards can start simple and grow.
 * Turning a group off only hides the buttons and menu items that start it. Nothing is deleted: a card
 * that already uses a hidden feature still shows it (see `sectionShown`), and turning the group back on
 * brings everything back.
 */
export type Feature = "planning" | "linking" | "time" | "fields" | "views" | "automation" | "looks" | "ai";

export const FEATURES: { id: Feature; name: string; what: string }[] = [
  { id: "planning", name: "Planning extras", what: "Start dates and repeating tasks" },
  { id: "linking", name: "Linking tasks", what: "Sub-tasks, tasks that block each other, related tasks" },
  { id: "views", name: "More views", what: "List, Timeline and Charts, next to Board and Calendar" },
  { id: "looks", name: "Board looks", what: "Backgrounds, card covers and what cards show" },
  { id: "time", name: "Time tracking", what: "Timers, focus countdowns, estimates and tracked time" },
  { id: "fields", name: "Custom fields", what: "Your own fields on cards: numbers, choices, links and more" },
  { id: "automation", name: "Bucket automation", what: "Bucket rules and work-in-progress limits" },
  { id: "ai", name: "AI tools", what: "Work orders and handing cards to an AI chat of your choice" },
];

export type Preset = "simple" | "standard" | "everything";

/** Which groups each preset turns on. Everything not listed is off. */
export const PRESETS: Record<Preset, { name: string; what: string; on: Feature[] }> = {
  simple: { name: "Simple", what: "Boards, cards, checklists, labels, due dates, reminders and the calendar", on: [] },
  standard: { name: "Standard", what: "Simple, plus planning extras, linked tasks, more views and board looks", on: ["planning", "linking", "views", "looks"] },
  everything: { name: "Everything", what: "Every feature TCI Boards has", on: FEATURES.map((f) => f.id) },
};

/** A group is on unless it was turned off, so people who never chose keep every feature they had. */
export const featureOn = (settings: Pick<Settings, "features">, f: Feature) => settings.features?.[f] !== false;

export function useFeature(f: Feature): boolean {
  return useStore((s) => featureOn(s.data.settings, f));
}

/** Board and Calendar are always there; List, Timeline and Charts come with "More views". */
export const viewShown = (settings: Pick<Settings, "features">, v: ViewMode) => v === "board" || v === "calendar" || featureOn(settings, "views");

/** The preset the current switches match, or null for a custom mix. */
export function currentPreset(settings: Pick<Settings, "features">): Preset | null {
  for (const [id, p] of Object.entries(PRESETS) as [Preset, (typeof PRESETS)[Preset]][])
    if (FEATURES.every((f) => featureOn(settings, f.id) === p.on.includes(f.id))) return id;
  return null;
}

export const presetFeatures = (p: Preset): Record<Feature, boolean> =>
  Object.fromEntries(FEATURES.map((f) => [f.id, PRESETS[p].on.includes(f.id)])) as Record<Feature, boolean>;

/** The group behind each part of the card window (parts not listed are always there). */
const SECTION_FEATURE: Partial<Record<CardSection, Feature>> = {
  startDate: "planning",
  repeat: "planning",
  links: "linking",
  time: "time",
  fields: "fields",
  cover: "looks",
};

/** Whether a card already uses this part, so it stays visible even with its group turned off. */
function sectionInUse(card: Card, s: CardSection): boolean {
  switch (s) {
    case "startDate":
      return !!card.startDate;
    case "repeat":
      return !!card.recurrence;
    case "links":
      return card.links.length > 0;
    case "time":
      return card.time.length > 0 || card.estimate != null;
    case "fields":
      return Object.values(card.fields).some((v) => v != null && v !== "");
    case "cover":
      return !!card.cover;
    default:
      return false;
  }
}

/** A part of the card window shows when its group is on, or when this card already uses it. */
export function sectionShown(settings: Pick<Settings, "features">, card: Card, s: CardSection): boolean {
  const f = SECTION_FEATURE[s];
  return !f || featureOn(settings, f) || sectionInUse(card, s);
}
