/**
 * Android: text or a link shared to TCI Boards from another app (the share sheet's "Add to TCI Boards") opens
 * Quick add with it filled in. MainActivity keeps it until this page takes it.
 */
export function installShareIn(): () => void {
  const android = (window as unknown as { ZomelloAndroid?: { takeShared?(): string | null } }).ZomelloAndroid;
  if (!android?.takeShared) return () => {};
  const take = () => {
    let shared: { text?: string; subject?: string } | null = null;
    try {
      shared = JSON.parse(android.takeShared!() ?? "null");
    } catch {
      return;
    }
    const text = shared?.text?.trim();
    if (!text) return;
    const task = sharedTask(text, shared?.subject?.trim() ?? "");
    void import("./store").then(({ useStore }) => useStore.getState().setOverlay({ quickAddOpen: true, quickAddPrefill: task }));
  };
  take();
  window.addEventListener("zomello-shared", take);
  return () => window.removeEventListener("zomello-shared", take);
}

/** A title and description from shared text: a page's title and its link, or the first line and the rest. */
export function sharedTask(text: string, subject: string): { title: string; description: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const onlyLink = lines.length === 1 && /^https?:\/\/\S+$/i.test(lines[0]);
  if (subject) return { title: subject.slice(0, 200), description: text };
  if (onlyLink) {
    // No title came with it: name it after the site.
    const host = lines[0].replace(/^https?:\/\/(www\.)?/i, "").split(/[/?#]/)[0];
    return { title: `Look at ${host}`, description: lines[0] };
  }
  const first = lines[0].length > 120 ? `${lines[0].slice(0, 117)}…` : lines[0];
  return { title: first, description: lines.length > 1 || lines[0].length > 120 ? text : "" };
}
