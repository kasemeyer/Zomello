import { useStore } from "./store";

/**
 * Easter egg: click the TCI Boards logo five times quickly to drop the bass. The first time unlocks the
 * Bass Drop style (it then shows up in Settings → Appearance); after that, it switches back and forth.
 */
const CLICKS = 5;
const WITHIN_MS = 2500;
let clicks: number[] = [];

/** Returns true when the clicks set the style off (so the logo can dance). */
export function logoClicked(): boolean {
  const now = Date.now();
  clicks = [...clicks.filter((t) => now - t < WITHIN_MS), now];
  if (clicks.length < CLICKS) return false;
  clicks = [];
  const st = useStore.getState();
  const s = st.data.settings;
  if (!s.unlockedStyles.includes("bassdrop")) {
    st.updateSettings({ style: "bassdrop", unlockedStyles: [...s.unlockedStyles, "bassdrop"] });
    st.toast("🎧 You found Bass Drop! Switch styles any time in Settings → Appearance.");
    return true;
  }
  const on = s.style !== "bassdrop";
  st.updateSettings({ style: on ? "bassdrop" : "classic" });
  st.toast(on ? "🎧 Bass Drop on" : "Back to classic TCI Boards", { key: "style" });
  return on;
}
