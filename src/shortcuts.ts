import { addDays } from "date-fns";
import { archiveCard } from "./actions";
import { useStore } from "./store";
import { cardsOnScreen, hoveredCardId } from "./components/CardTile";
import { featureOn, viewShown } from "./features";
import { toISO } from "./utils";
import type { ViewMode } from "./types";
import { toggleDone } from "./blocked";

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "Anywhere",
    items: [
      ["Ctrl K", "Search everything"],
      ["N  or  Ctrl N", "Quick-add a task"],
      ["Ctrl Z", "Undo"],
      ["Ctrl Shift Z  or  Ctrl Y", "Redo"],
      ["H", "Home"],
      ["M", "My Tasks"],
      ["D", "My Day"],
      ["[", "Collapse / expand the sidebar"],
      ["Ctrl Scroll", "Zoom in / out"],
      ["Ctrl +  or  Ctrl −", "Zoom in / out"],
      ["Ctrl 0", "Reset zoom"],
      ["?", "Help and these shortcuts"],
      ["Esc", "Close dialogs and menus"],
    ],
  },
  {
    group: "On a board",
    items: [
      ["1 to 5", "Board / List / Calendar / Timeline / Charts"],
      ["/", "Filter cards"],
      ["B", "Customize the board"],
    ],
  },
  {
    group: "Hovering a card",
    items: [
      ["Enter  or  E", "Open it"],
      ["C", "Complete / un-complete"],
      ["T", "Start / pause its timer"],
      ["F", "Start a focus countdown on it"],
      ["D", "Due today (again: tomorrow)"],
      ["A", "Archive"],
      ["Shift D", "Duplicate"],
      ["Right-click", "All card actions"],
      ["Ctrl click", "Select cards (then copy a work order / hand to AI)"],
      ["Shift Space", "Pick up a focused card / list, then arrows to move, Space to drop, Esc to cancel"],
    ],
  },
  {
    group: "In a card",
    items: [
      ["Alt ←", "Back to the card you came from"],
      ["Ctrl Enter", "Add the note you typed"],
      ["Esc", "Close"],
    ],
  },
];

const VIEWS: ViewMode[] = ["board", "list", "calendar", "timeline", "charts"];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable]");

export function handleShortcut(e: KeyboardEvent) {
  const st = useStore.getState();
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (ctrl && key === "k") {
    e.preventDefault();
    st.setOverlay({ searchOpen: !st.searchOpen });
    return;
  }
  if (ctrl && key === "n") {
    e.preventDefault();
    st.setOverlay({ quickAddOpen: true });
    return;
  }
  // Inside text fields, leave Ctrl+Z etc. to the browser's own text undo.
  if (isTyping(e.target)) return;

  // Back out of a card we reached through a link.
  if (e.altKey && e.key === "ArrowLeft" && st.openCardId && st.cardTrail.length) {
    e.preventDefault();
    return st.cardBack();
  }

  if (ctrl && (key === "z" || key === "y")) {
    e.preventDefault();
    const redo = key === "y" || e.shiftKey;
    const ok = redo ? st.redo() : st.undo();
    if (ok) st.toast(redo ? "Redone" : "Undone");
    return;
  }
  const modalOpen = !!document.querySelector(".modal-backdrop, .ctx-menu, .popover");
  // Select every card on screen, to change them all at once.
  if (ctrl && key === "a" && st.route.page === "board" && !modalOpen) {
    e.preventDefault();
    return st.selectCards(cardsOnScreen());
  }
  if (ctrl || e.altKey) return;
  if (modalOpen) return;

  if (e.key === "Escape" && st.selected.length) return st.clearSelected();

  // Hover actions on a card.
  const card = hoveredCardId ? st.data.cards[hoveredCardId] : undefined;
  if (card && document.querySelector(".card-tile:hover")) {
    switch (e.key) {
      case "Enter":
      case "e":
        e.preventDefault();
        return st.openCard(card.id);
      case "c":
        return void toggleDone(card);
      case "t":
        if (card.time.some((t) => t.end === null)) return st.stopTimer();
        return featureOn(st.data.settings, "time") ? st.startTimer(card.id) : undefined;
      case "f":
        return featureOn(st.data.settings, "time") ? st.startFocus(st.data.settings.focusMinutes, card.id) : undefined;
      case "d": {
        const today = toISO(new Date());
        return st.updateCard(card.id, { dueDate: card.dueDate === today ? toISO(addDays(new Date(), 1)) : today });
      }
      case "a":
        return archiveCard(card);
      case "D":
        st.duplicateCard(card.id);
        return st.toast("Duplicated card", { undo: true });
    }
  }

  if (e.key === "/" && e.shiftKey) return st.setOverlay({ helpOpen: true });

  switch (e.key) {
    case "n":
      e.preventDefault();
      return st.setOverlay({ quickAddOpen: true });
    case "?":
      return st.setOverlay({ helpOpen: true });
    case "h":
      return st.navigate({ page: "home" });
    case "m":
      return st.navigate({ page: "mytasks" });
    case "d":
      return st.navigate({ page: "myday" });
    case "[":
      return st.updateSettings({ sidebarCollapsed: !st.data.settings.sidebarCollapsed });
  }

  if (st.route.page === "board") {
    const boardId = st.route.boardId;
    if (e.key >= "1" && e.key <= "5") {
      const view = VIEWS[+e.key - 1];
      return viewShown(st.data.settings, view) ? st.setBoardUi(boardId, { view }) : undefined;
    }
    if (e.key === "/") {
      e.preventDefault();
      return document.querySelector<HTMLInputElement>(".search-box input")?.focus();
    }
    if (e.key === "b") return st.setOverlay({ customizeBoardId: boardId });
  }
}
