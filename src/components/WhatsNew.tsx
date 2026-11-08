import type { ReactNode } from "react";
import { create } from "zustand";
import { CalendarClock, Network, SlidersHorizontal, Sparkles, Zap } from "lucide-react";
import { useStore } from "../store";
import { openExternal } from "../storage";
import { Modal } from "./ui";

/**
 * "New in TCI Boards": a short note shown once after updating to a new version (a 0.x release), with the few
 * things worth trying. Update WHATS_NEW for each release; the full list is the guide's What's new page.
 */
export const WHATS_NEW: { version: string; items: { icon: ReactNode; title: string; text: string; action?: { label: string; run: () => void } }[] } = {
  version: "0.6",
  items: [
    {
      icon: <SlidersHorizontal size={18} />,
      title: "Choose what you see",
      text: "Simple, Standard or Everything, or turn eight groups on and off yourself. Nothing is deleted when you hide something.",
      action: {
        label: "Open Features",
        run: () => {
          useStore.getState().navigate({ page: "settings" });
          setTimeout(() => document.getElementById("set-features")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
        },
      },
    },
    {
      icon: <Zap size={18} />,
      title: "Buckets that do the busywork",
      text: "Bucket rules can now start cards from a template, assign people, set due dates, act on finished checklists and late cards, and tidy up done cards. Find them in a bucket's ⋯ menu.",
    },
    {
      icon: <Network size={18} />,
      title: "Linked and blocked tasks",
      text: "Tap a card's link badge to see everything it's connected to. Blocked cards say what they're waiting on, and you'll hear when they're free.",
    },
    {
      icon: <CalendarClock size={18} />,
      title: "What's due, at a glance",
      text: "\"Late\" and \"due today\" show next to a board's Filter button, one click from showing just those cards.",
    },
  ],
};

const GUIDE_WHATS_NEW = "https://docs.zombeatzmedia.com/zomello/whats-new";

export const useWhatsNew = create<{ open: boolean }>(() => ({ open: false }));
export const openWhatsNew = () => useWhatsNew.setState({ open: true });

/** This version has a note, and it hasn't been seen on this account yet. */
export const whatsNewDue = (seen: string | undefined) => seen !== WHATS_NEW.version && __APP_VERSION__.startsWith(`${WHATS_NEW.version}.`);

export function WhatsNew() {
  const close = () => {
    useWhatsNew.setState({ open: false });
    useStore.getState().updateSettings({ seenWhatsNew: WHATS_NEW.version });
  };
  return (
    <Modal onClose={close} width={520} className="whats-new">
      <header className="whats-new-head">
        <Sparkles size={20} />
        <h2>New in TCI Boards {WHATS_NEW.version}</h2>
      </header>
      <ul className="whats-new-list">
        {WHATS_NEW.items.map((it) => (
          <li key={it.title}>
            <span className="whats-new-icon">{it.icon}</span>
            <div>
              <b>{it.title}</b>
              <p className="muted">{it.text}</p>
              {it.action && (
                <button
                  className="btn sm"
                  onClick={() => {
                    close();
                    it.action!.run();
                  }}
                >
                  {it.action.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="row end gap whats-new-foot">
        <button className="btn ghost" onClick={() => void openExternal(GUIDE_WHATS_NEW)}>
          See everything new
        </button>
        <button className="btn primary" onClick={close}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
