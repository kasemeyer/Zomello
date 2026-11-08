import { create } from "zustand";
import { isServer, myInvites, type Invite } from "./server";
import { useStore } from "./store";

let primed = false;

/** TCI Boards server: board invitations waiting for you (shown on Home). */
export const useInvites = create<{ invites: Invite[]; refresh: () => Promise<void> }>((set, get) => ({
  invites: [],
  async refresh() {
    if (!isServer) return;
    try {
      const next = await myInvites();
      const known = new Set(get().invites.map((i) => i.id));
      const fresh = next.filter((i) => !known.has(i.id));
      set({ invites: next });
      // A heads-up for invitations that arrive while you're here (Home already lists the waiting ones).
      if (primed) for (const i of fresh) useStore.getState().toast(`${i.from} invited you to “${i.boardTitle}”. Accept it on Home.`);
      primed = true;
    } catch {
      /* offline: try again on the next update */
    }
  },
}));
