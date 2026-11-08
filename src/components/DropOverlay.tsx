import { FileUp, MousePointerClick } from "lucide-react";
import { useDrop } from "../fileDrop";
import { useStore } from "../store";

/** Full-window hint shown while something is dragged in from outside the app. */
export function DropOverlay() {
  const { active, mode, cardId } = useDrop();
  const title = useStore((s) => (cardId ? s.data.cards[cardId]?.title : undefined));
  if (!active || mode === "zone") return null;
  if (mode === "tile")
    return (
      <div className="drop-banner">
        <FileUp size={16} /> Drop to attach to <b>“{title}”</b>
      </div>
    );
  return (
    <div className={`drop-overlay ${mode}`}>
      <div className="drop-panel">
        {mode === "card" ? (
          <>
            <FileUp size={40} />
            <b>Drop to attach</b>
            <span>to “{title}”</span>
            <small>Files are copied into TCI Boards · links are saved as links</small>
          </>
        ) : (
          <>
            <MousePointerClick size={36} />
            <b>Drop onto a card</b>
            <span>Hover the card you want, or open a card first and drop anywhere.</span>
          </>
        )}
      </div>
    </div>
  );
}
