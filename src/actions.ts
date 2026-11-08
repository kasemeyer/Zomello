import type { Board, Card, List } from "./types";
import { sinkCard } from "./undead";
import { useStore } from "./store";
import { ask } from "./components/ui";

/**
 * Archive / delete, shared by every menu that offers them so they all behave the same: deleting asks
 * first (saying how much goes with it), and afterwards a toast offers Undo (Ctrl+Z works too).
 */

const cardsIn = (pred: (c: Card) => boolean) => Object.values(useStore.getState().data.cards).filter(pred).length;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function deleteBoard(board: Board) {
  const n = cardsIn((c) => c.boardId === board.id);
  const what = n ? ` and its ${plural(n, "card")}` : "";
  if (!(await ask(`Delete the board “${board.title}”${what}? You can undo this right after.`, { okText: "Delete board", danger: true })))
    return;
  const st = useStore.getState();
  st.deleteBoard(board.id);
  st.toast(`Deleted “${board.title}”`, { undo: true });
}

export function archiveBoard(board: Board) {
  const st = useStore.getState();
  st.updateBoard(board.id, { archived: true });
  const r = st.route;
  if (r.page === "board" && r.boardId === board.id) st.navigate({ page: "home" });
  st.toast(`Archived “${board.title}” (find it under Archive)`, { undo: true });
}

export async function deleteList(list: List) {
  const n = cardsIn((c) => c.listId === list.id);
  const what = n ? ` and its ${plural(n, "card")}` : "";
  if (!(await ask(`Delete the list “${list.title}”${what}? You can undo this right after.`, { okText: "Delete list", danger: true })))
    return;
  const st = useStore.getState();
  st.deleteList(list.id);
  st.toast(`Deleted “${list.title}”`, { undo: true });
}

export function archiveList(list: List) {
  const st = useStore.getState();
  st.updateList(list.id, { archived: true });
  st.toast(`Archived “${list.title}” (find it under Archive)`, { undo: true });
}

export async function deleteCard(card: Card) {
  if (!(await ask(`Delete “${card.title}”? You can undo this right after.`, { okText: "Delete", danger: true }))) return;
  const st = useStore.getState();
  st.deleteCard(card.id);
  st.toast(`Deleted “${card.title}”`, { undo: true });
}

export async function archiveCard(card: Card) {
  await sinkCard(card.id);
  const st = useStore.getState();
  st.updateCard(card.id, { archived: true });
  st.toast(`Archived “${card.title}”`, { undo: true });
}
