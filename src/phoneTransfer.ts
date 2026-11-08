import { invoke } from "@tauri-apps/api/core";
import { buildBoardFile, openBoardFile } from "./boardFile";
import type { LinkedDevice } from "./deviceWindow";
import { useStore } from "./store";
import type { AppData, Card, ID } from "./types";

/**
 * Desktop app: moving or copying boards between this computer and a phone that's connected right now
 * (same Wi‑Fi, see link.rs). To the phone, a board travels as a board file over the encrypted link,
 * attached files included. From the phone, this computer already has the phone's boards (that's how it
 * shows them), so it adds a copy and, for a move, tells the phone to remove it.
 */

type Phone = Pick<LinkedDevice, "id" | "name">;

/** Wait for the phone to say it has transfer `tid`. */
export function received(tid: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let un: (() => void) | undefined;
    const t = setTimeout(() => {
      un?.();
      resolve(false);
    }, ms);
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      un = await listen<{ id: string }>("zomello://linked-board-received", (e) => {
        if (e.payload.id !== tid) return;
        clearTimeout(t);
        un?.();
        resolve(true);
      });
    });
  });
}

export async function sendBoardToPhone(boardId: ID, phone: Phone, move: boolean): Promise<void> {
  const st = useStore.getState();
  const board = st.data.boards[boardId];
  if (!board) return;
  const key = "send-board";
  st.toast(`${move ? "Moving" : "Copying"} “${board.title}” to ${phone.name}…`, { key });
  try {
    const { bytes, missing } = await buildBoardFile(st.data, boardId);
    if (missing && move) throw new Error(`${missing === 1 ? "an attached file" : `${missing} attached files`} couldn't be read. Copy it instead.`);
    const tid = await invoke<string>("linked_send_board", bytes, { headers: { "x-device": phone.id } });
    if (!(await received(tid, 45_000))) throw new Error(`${phone.name} didn't answer. Check that TCI Boards is open on it and try again.`);
    if (move) useStore.getState().deleteBoard(boardId);
    useStore.getState().toast(`${move ? "Moved" : "Copied"} “${board.title}” to ${phone.name}`, { key });
  } catch (e) {
    useStore.getState().toast(`Couldn't send “${board.title}”: ${e instanceof Error ? e.message : e}`, { key });
  }
}

/** Files stored with a board (attachments, a background image). They live on the phone. */
const hasStoredFiles = (data: AppData, boardId: ID) =>
  data.boards[boardId]?.background.type === "image" ||
  Object.values(data.cards).some((c) => c.boardId === boardId && c.attachments.some((a) => a.stored));

export async function takeBoardFromPhone(phone: Phone, boardId: ID, move: boolean): Promise<void> {
  const st = useStore.getState();
  const json = await invoke<string | null>("linked_data", { id: phone.id });
  if (!json) return st.toast(`${phone.name} isn't connected right now.`);
  const data = JSON.parse(json) as AppData;
  const board = data.boards?.[boardId];
  if (!board) return st.toast(`That board isn't on ${phone.name} anymore.`);
  const files = hasStoredFiles(data, boardId);
  if (files && move)
    return st.toast(
      `“${board.title}” has files attached, and those stay on the phone. To bring them along, move it from the phone: in TCI Boards there, hold the board in the menu and choose Move to… > Computer.`,
      { key: "send-board", action: { label: "Copy without files", run: () => void takeBoardFromPhone(phone, boardId, false) } },
    );
  // Stored files are on the phone, so they're left out here (links to websites come along).
  const cards: Record<ID, Card> = {};
  for (const c of Object.values(data.cards)) if (c.boardId === boardId) cards[c.id] = { ...c, attachments: c.attachments.filter((a) => !a.stored), coverImage: null };
  const lists = Object.fromEntries(Object.values(data.lists).filter((l) => l.boardId === boardId).map((l) => [l.id, l]));
  const plain = board.background.type === "image" ? { ...board, background: { type: "none" as const } } : board;
  const { bytes } = await buildBoardFile({ boards: { [boardId]: plain }, lists, cards }, boardId);
  await openBoardFile(bytes, move ? "Moved here:" : "Copied here:");
  if (move) {
    await invoke("linked_send", {
      id: phone.id,
      ops: { upserts: {}, deletes: { boards: [boardId], lists: Object.keys(lists), cards: Object.keys(cards) } },
    }).catch((e) => useStore.getState().toast(`Added here, but ${phone.name} still has it: ${e}`));
  }
}
