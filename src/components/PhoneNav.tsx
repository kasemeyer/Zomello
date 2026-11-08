import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, Smartphone } from "lucide-react";
import { DndContext, useDraggable, type DragEndEvent, type DragMoveEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { onLinkedDevices, openDeviceWindow, type LinkedDevice } from "../deviceWindow";
import { useStore } from "../store";
import { useDragSensors } from "../mobile";
import { takeBoardFromPhone } from "../phoneTransfer";
import { openContextMenu, type MenuEntry } from "./ContextMenu";
import { askChoice } from "./ui";
import { isRemote } from "../remote";

/** On a phone or tablet viewing your computer: these are your other devices (no moving boards here). */
const otherDevices = isRemote;

/**
 * Desktop app: phones connected right now (same Wi‑Fi, TCI Boards open), each with its boards. Clicking
 * one opens it in a window that edits the phone's board directly. A phone that goes away disappears
 * from here. Hide a phone's boards in Settings → Phones & tablets.
 */
export function PhoneNav({ collapsed }: { collapsed: boolean }) {
  const [phones, setPhones] = useState<LinkedDevice[]>([]);
  const [shut, setShut] = useState<string[]>([]);
  const sensors = useDragSensors(5);
  useEffect(() => onLinkedDevices(setPhones), []);
  if (!phones.length) return null;
  const open = (id: string, board?: string) =>
    void openDeviceWindow(id, board).catch((e) => useStore.getState().toast(String(e instanceof Error ? e.message : e)));
  const menu = (p: LinkedDevice, b: LinkedDevice["boards"][number]): MenuEntry[] => [
    { label: "Open", icon: <ExternalLink size={14} />, onClick: () => open(p.id, b.id) },
    ...(otherDevices ? [] : transferItems(p, b)),
  ];
  const transferItems = (p: LinkedDevice, b: LinkedDevice["boards"][number]): MenuEntry[] => [
    { separator: true },
    { label: "Move to this computer", icon: <ArrowRightLeft size={14} />, onClick: () => void takeBoardFromPhone(p, b.id, true) },
    { label: "Copy to this computer", icon: <Copy size={14} />, onClick: () => void takeBoardFromPhone(p, b.id, false) },
  ];
  // A phone's board dragged onto this computer's boards comes here.
  const target = (e: DragMoveEvent | DragEndEvent) => pointAt(e)?.closest<HTMLElement>("[data-computer-boards]") ?? undefined;
  const mark = (el?: HTMLElement) => {
    document.querySelectorAll("[data-computer-boards].drop-into").forEach((n) => n !== el && n.classList.remove("drop-into"));
    el?.classList.add("drop-into");
  };
  const dropped = async (e: DragEndEvent) => {
    const el = target(e);
    mark();
    if (!el) return;
    const [pid, bid] = String(e.active.id).split("\n");
    const p = phones.find((x) => x.id === pid);
    const b = p?.boards.find((x) => x.id === bid);
    if (!p || !b) return;
    const pick = await askChoice(`Move “${b.title}” from ${p.name} to this computer? Or leave it there and copy it here.`, "Move", "Copy");
    if (pick) void takeBoardFromPhone(p, b.id, pick === "ok");
  };

  return (
    <DndContext sensors={sensors} modifiers={[restrictToVerticalAxis]} onDragMove={(e) => mark(target(e))} onDragCancel={() => mark()} onDragEnd={(e) => void dropped(e)}>
      {phones.map((p) => {
        const closed = shut.includes(p.id);
        const cats = [...new Set([...p.boards.map((b) => b.category), ...(p.sections ?? [])].filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
        const row = (b: LinkedDevice["boards"][number]) => (
          <PhoneBoardRow key={b.id} phone={p} board={b} collapsed={collapsed} onOpen={() => open(p.id, b.id)} onMenu={(e) => openContextMenu(e, () => menu(p, b))} />
        );
        return (
          <div key={p.id} className="phone-nav">
            {/* Drop one of this computer's boards here to move or copy it to the phone. */}
            <div className="nav-heading phone-nav-head" data-device={otherDevices ? undefined : p.id} data-place-name={p.name}>
              <button className="link-plain row gap-sm grow" onClick={() => setShut(closed ? shut.filter((x) => x !== p.id) : [...shut, p.id])} aria-expanded={!closed} title="Boards on this phone, while it's connected">
                {closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <Smartphone size={12} />
                <span className="label ellipsis">{p.name}</span>
              </button>
              <span className="live-dot" title="Connected now" />
            </div>
            {!closed && (
              <div className="nav-boards">
                {p.boards.filter((b) => !b.category).map(row)}
                {!collapsed &&
                  cats.map((c) => (
                    <div key={c} className="nav-category">
                      <div className="nav-category-head static">
                        <span className="grow ellipsis">{c}</span>
                        <span className="count">{p.boards.filter((b) => b.category === c).length}</span>
                      </div>
                      {p.boards.filter((b) => b.category === c).map(row)}
                    </div>
                  ))}
                {p.boards.length === 0 && <p className="muted small place-empty">No boards on it yet</p>}
              </div>
            )}
          </div>
        );
      })}
    </DndContext>
  );
}

/** Where the pointer is during a drag (it started on the row and moved by `delta`). */
function pointAt(e: { activatorEvent: Event | null; delta: { x: number; y: number } }): Element | null {
  const start = e.activatorEvent as (MouseEvent & TouchEvent) | null;
  if (!start) return null;
  const p = start.touches?.[0] ?? start.changedTouches?.[0] ?? start;
  return document.elementFromPoint(p.clientX, p.clientY + e.delta.y);
}

/** One of the phone's boards: click to open it here, drag it onto this computer's boards, right-click for more. */
function PhoneBoardRow({
  phone,
  board: b,
  collapsed,
  onOpen,
  onMenu,
}: {
  phone: LinkedDevice;
  board: LinkedDevice["boards"][number];
  collapsed: boolean;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${phone.id}\n${b.id}`, disabled: otherDevices });
  // Letting go after a drag also "clicks" the row; that click shouldn't open the board.
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);
  return (
    <button
      ref={setNodeRef}
      className={`nav-item ${isDragging ? "dragging" : ""}`}
      style={transform ? { transform: `translateY(${transform.y}px)`, position: "relative", zIndex: 5 } : undefined}
      title={collapsed ? `${b.title} (on ${phone.name})` : `Open on ${phone.name}`}
      onClick={() => {
        if (dragged.current) dragged.current = false;
        else onOpen();
      }}
      onContextMenu={onMenu}
      {...attributes}
      {...listeners}
    >
      {b.icon ? <span className="nav-emoji">{b.icon}</span> : <span className="board-dot" style={{ background: b.color }} />}
      <span className="ellipsis label">{b.title}</span>
    </button>
  );
}

/** In a phone's window on this computer: whose boards these are. */
export function DeviceBanner({ id }: { id: string }) {
  const [name, setName] = useState("your phone");
  useEffect(() => onLinkedDevices((l) => setName(l.find((d) => d.id === id)?.name ?? "your phone")), [id]);
  return (
    <>
      <div className="device-banner" title="Changes here go straight to that device">
        <Smartphone size={15} /> Boards on {name}
      </div>
      {otherDevices && (
        <button className="nav-item" onClick={() => (location.href = "/")}>
          <ChevronLeft size={16} />
          <span className="label">Back to your computer's boards</span>
        </button>
      )}
    </>
  );
}
