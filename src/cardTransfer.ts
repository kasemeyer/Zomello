import { invoke } from "@tauri-apps/api/core";
import { buildBoardFile } from "./boardFile";
import { linkedNow } from "./deviceWindow";
import { received } from "./phoneTransfer";
import { call, placesMode, placesNow, savePlaceList } from "./placeLists";
import { ensureLocalNetwork, goToPhone, goToPlace, LOCAL_NETWORK_HELP, reachable } from "./places";
import { isDesktopApp } from "./storage";
import { saveNow, useStore } from "./store";
import { destinations } from "./transfer";
import type { ID } from "./types";
import { isDeviceWindow } from "./windows";

/**
 * Moving (or copying) cards to a board on another device: your computer, this phone, or a TCI Boards server.
 * The cards travel as a small board file (attached files included) the same way whole boards do (see
 * transfer.ts and phoneTransfer.ts), and join the chosen board there.
 */

export interface CardDestination {
  /** "dev:<id>" for a phone connected to this computer, else a place ("phone" or an origin). */
  key: string;
  name: string;
  boards: { id: string; title: string; color: string }[];
}

/** Other devices this page can send cards to, with their boards. */
export function cardDestinations(): CardDestination[] {
  if (isDeviceWindow) return [];
  if (isDesktopApp && !placesMode)
    return linkedNow.filter((p) => p.boards.length).map((p) => ({ key: `dev:${p.id}`, name: p.name, boards: p.boards }));
  const p = placesNow;
  if (!placesMode || !p) return [];
  return destinations(p.me, p.list)
    .map((d) => ({ ...d, boards: p.boards[d.key]?.boards ?? [] }))
    .filter((d) => d.boards.length > 0);
}

/** The cards a card menu acts on: the selection when the card is part of it, else just that card. */
export function cardsFor(cardId: ID): ID[] {
  const sel = useStore.getState().selected;
  return sel.includes(cardId) ? sel : [cardId];
}

export async function sendCards(cardIds: ID[], to: CardDestination, boardId: ID, move: boolean): Promise<void> {
  const st = useStore.getState();
  const cards = cardIds.map((id) => st.data.cards[id]).filter(Boolean);
  if (!cards.length) return;
  const what = cards.length === 1 ? `“${cards[0].title}”` : `${cards.length} cards`;
  const board = to.boards.find((b) => b.id === boardId)?.title ?? "the board";
  const key = "send-cards";
  st.toast(`${move ? "Moving" : "Copying"} ${what} to ${board} on ${to.name}…`, { key });
  try {
    // One file per board they come from (a selection can span boards).
    const files: Uint8Array[] = [];
    for (const from of new Set(cards.map((c) => c.boardId))) {
      const ids = cards.filter((c) => c.boardId === from).map((c) => c.id);
      const { bytes, missing } = await buildBoardFile(st.data, from, { cardIds: ids, into: boardId });
      if (missing && move) throw new Error(`${missing === 1 ? "an attached file" : `${missing} attached files`} couldn't be read. Copy instead, or remove ${missing === 1 ? "it" : "them"} first.`);
      files.push(bytes);
    }
    if (to.key.startsWith("dev:")) {
      const device = to.key.slice(4);
      for (const bytes of files) {
        const tid = await invoke<string>("linked_send_board", bytes, { headers: { "x-device": device } });
        if (!(await received(tid, 45_000))) throw new Error(`${to.name} didn't answer. Check that TCI Boards is open on it and try again.`);
      }
      if (move) removeCards(cards.map((c) => c.id));
      return void useStore.getState().toast(`${move ? "Moved" : "Copied"} ${what} to ${board} on ${to.name}`, { key });
    }
    if (to.key !== "phone") {
      if (!(await ensureLocalNetwork())) throw new Error(LOCAL_NETWORK_HELP);
      if (!(await reachable(to.key))) throw new Error(`${to.name} can't be reached right now. Check that it's on and on the same Wi‑Fi, then try again.`);
    }
    for (const bytes of files) await call("places_send_board", bytes, { headers: { "x-to": to.key } });
    if (move) {
      removeCards(cards.map((c) => c.id));
      await saveNow();
      await savePlaceList();
    }
    // The other place's page adds them when it opens (and shows that board).
    if (to.key === "phone") goToPhone();
    else await goToPlace(to.key);
  } catch (e) {
    useStore.getState().toast(`Couldn't ${move ? "move" : "copy"} ${what}: ${e instanceof Error ? e.message : e}`, { key });
  }
}

function removeCards(ids: ID[]) {
  const st = useStore.getState();
  for (const id of ids) st.deleteCard(id);
  st.clearSelected();
}
