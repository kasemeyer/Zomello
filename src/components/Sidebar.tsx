import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDragSensors, useIsPhone } from "../mobile";
import {
  Archive, ChevronDown, ChevronRight, ChevronUp, ChevronsLeft, ChevronsRight, CircleHelp, LogOut, Shield, UserCog, Home, Hourglass, Pause, Play, Plus, Search, Settings, Star, Sun, UserCheck, Users, X, Zap, ExternalLink, Server as ServerIcon, Smartphone, Monitor, FolderPlus, LayoutTemplate, Lock,
} from "lucide-react";
import { runningTimer, useStore } from "../store";
import type { Board, ID, Route } from "../types";
import { closestCenter, DndContext, pointerWithin, useDroppable, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { openContextMenu } from "./ContextMenu";
import { boardMenu, categoryMenu } from "./boardMenu";
import { isBoardWindow, isDeviceWindow, isExtraWindow, openBoardWindow, windowDeviceId } from "../windows";
import { DeviceBanner, PhoneNav } from "./PhoneNav";
import { boardCategories, byOrder, formatDuration, parseDuration } from "../utils";
import { ask, askChoice, Popover } from "./ui";
import { LogoMark, Wordmark } from "./Logo";
import { useNow } from "./useNow";
import { logoClicked } from "../easterEgg";
import { SpinCat } from "./SpinCat";
import { isServer, logout, me, ownsBoard } from "../server";
import { NO_SERVERS, openServer } from "../servers";
import { isRemote } from "../remote";
import { goToPhone, inZomelloApp, takeAddRequest } from "../places";
import { placesMode } from "../placeLists";
import { PlaceSections } from "./PlaceSections";
import { sendBoard } from "../transfer";
import { sendBoardToPhone } from "../phoneTransfer";
import { deviceWord, isDesktopApp, isMobileApp } from "../storage";
import { useFeature } from "../features";
import { Avatar } from "./ui";

export function Sidebar() {
  const boards = useStore((s) => s.data.boards);
  const route = useStore((s) => s.route);
  const savedCollapsed = useStore((s) => s.data.settings.sidebarCollapsed);
  // Board windows start with a slim sidebar (their own toggle, not the saved setting).
  const [winCollapsed, setWinCollapsed] = useState(true);
  // On a phone the sidebar is a slide-out drawer, always shown in full.
  const phone = useIsPhone();
  const collapsed = phone ? false : isBoardWindow ? winCollapsed : savedCollapsed;
  const { navigate, createBoard, setOverlay, updateSettings } = useStore.getState();
  const [adding, setAdding] = useState(false);
  /** Phones: the section a new board goes into (null = none). */
  const [addIn, setAddIn] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  // Came from another place's "+ Board" / "+ Section" (phone menu): open the menu with the box ready.
  useEffect(() => {
    const req = takeAddRequest();
    if (!req) return;
    const t = setTimeout(() => {
      window.dispatchEvent(new Event("zomello-open-nav"));
      if (req.kind === "section") setAddingSection(true);
      else {
        setAddIn(req.section);
        setAdding(true);
      }
    }, 300);
    return () => clearTimeout(t);
  }, []);
  const [title, setTitle] = useState("");

  const live = useMemo(() => Object.values(boards).filter((b) => !b.archived).sort(byOrder), [boards]);
  const starred = live.filter((b) => b.starred);
  // Optional categories group the boards; with none, it's one plain list as before.
  const sections = useStore((s) => s.data.settings.sections);
  const categories = useMemo(() => boardCategories(live, sections), [live, sections]);
  const loose = categories.length && !collapsed ? live.filter((b) => !b.category) : live;
  const collapsedCats = useStore((s) => s.data.settings.collapsedCategories);
  const activeId = route.page === "board" ? route.boardId : null;

  const [renaming, setRenaming] = useState<ID | null>(null);
  const [dancing, setDancing] = useState(false);
  const style = useStore((s) => s.data.settings.style);
  const homeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const burst = useRef<{ from: Route | null; last: number }>({ from: null, last: 0 });
  const asideRef = useScrollFades();

  const NavItem = ({ icon, label, onClick, on, kbd }: { icon: React.ReactNode; label: string; onClick: () => void; on?: boolean; kbd?: string }) => (
    <button className={`nav-item ${on ? "active" : ""}`} onClick={onClick} title={collapsed ? label : undefined}>
      {icon}
      <span className="label">{label}</span>
      {kbd && <kbd className="label">{kbd}</kbd>}
    </button>
  );

  return (
    <aside ref={asideRef} className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-fade top">
        <button className="sidebar-more" tabIndex={-1} aria-label="Scroll up" title="Scroll up" onClick={() => scrollSidebar(asideRef.current, -1)}>
          <ChevronUp size={14} />
        </button>
      </div>
      <div className="brand">
        <button
          className="logo-btn"
          aria-label="TCI Boards: go to Home"
          title="Home"
          onClick={() => {
            // Remember where this burst of clicks started.
            const now = Date.now();
            if (now - burst.current.last > 1500) burst.current.from = useStore.getState().route;
            burst.current.last = now;
            clearTimeout(homeTimer.current);
            if (logoClicked()) {
              // The clicks were for the Easter egg: stay on (or go back to) the page they started on.
              setDancing(true);
              setTimeout(() => setDancing(false), 3200);
              const from = burst.current.from;
              if (from && useStore.getState().route.page !== from.page) navigate(from);
              burst.current.last = 0;
              return;
            }
            // A single click goes Home, once the clicking stops.
            homeTimer.current = setTimeout(() => {
              if (useStore.getState().route.page !== "home") navigate({ page: "home" });
            }, 450);
          }}
        >
          <LogoMark size={collapsed ? 40 : 46} animate={dancing} />
          <Wordmark />
        </button>
        <button
          className="icon-btn tiny collapse-btn"
          title={collapsed ? "Expand sidebar ([)" : "Collapse sidebar ([)"}
          onClick={() => (isBoardWindow ? setWinCollapsed(!collapsed) : updateSettings({ sidebarCollapsed: !collapsed }))}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>
      <button className="nav-item quick-add-btn" onClick={() => setOverlay({ quickAddOpen: true })} title="Quick add (N)">
        <Zap size={16} />
        <span className="label">Quick add</span>
        <kbd className="label">N</kbd>
      </button>
      <NavItem icon={<Search size={16} />} label="Search" kbd="Ctrl K" onClick={() => setOverlay({ searchOpen: true })} />
      <NavItem icon={<Home size={16} />} label="Home" on={route.page === "home"} onClick={() => navigate({ page: "home" })} />
      <NavItem icon={<Sun size={16} />} label="My Day" on={route.page === "myday"} onClick={() => navigate({ page: "myday" })} />
      <NavItem icon={<UserCheck size={16} />} label="My Tasks" on={route.page === "mytasks"} onClick={() => navigate({ page: "mytasks" })} />

      {starred.length > 0 && (
        <>
          <div className="nav-heading">
            <Star size={12} /> <span className="label">Starred</span>
          </div>
          <BoardList list={starred} all={live} activeId={activeId} collapsed={collapsed} renaming={renaming} setRenaming={setRenaming} />
        </>
      )}

      {isDeviceWindow && windowDeviceId && <DeviceBanner id={windowDeviceId} />}
      {(() => {
        // A new board, optionally straight into a section (phones: each section has its own +).
        const commitNew = (name: string) => {
          const n = name.trim();
          if (n) {
            const id = createBoard(n);
            if (addIn) useStore.getState().setBoardCategory(id, addIn);
            navigate({ page: "board", boardId: id });
          }
          setTitle("");
          setAdding(false);
          setAddIn(null);
        };
        const commitSection = (name: string) => {
          if (name.trim()) useStore.getState().addCategory(name);
          setSectionName("");
          setAddingSection(false);
        };
        const addInput = adding && (
          <input
            autoFocus
            className="nav-input"
            placeholder={addIn ? `Board name (in ${addIn})` : "Board name"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) commitNew(title);
              if (e.key === "Escape") {
                e.currentTarget.value = "";
                commitNew("");
              }
            }}
            // Clicking away creates the board if a name was typed.
            onBlur={(e) => commitNew(e.currentTarget.value.trim() ? title : "")}
          />
        );
        const templatesLink = adding && !addIn && (
          <button
            className="nav-item small muted"
            // Before the name box loses focus (which would close it).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              commitNew("");
              setOverlay({ templatesOpen: true });
            }}
          >
            <LayoutTemplate size={14} /> <span className="label">Or start from a template…</span>
          </button>
        );
        const categoryGroups = categories.map((cat) => {
          const inCat = live.filter((b) => b.category === cat);
          const shut = collapsedCats.includes(cat);
          return (
            <DropGroup key={cat} name={cat} className="nav-category">
              <div className="nav-category-row">
                <button
                  className="nav-category-head"
                  onClick={() => useStore.getState().toggleCategoryCollapsed(cat)}
                  onContextMenu={(e) => openContextMenu(e, () => categoryMenu(cat))}
                  title="Click to fold; right-click (or press and hold) to rename or remove"
                  aria-expanded={!shut}
                >
                  {shut ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="grow ellipsis">{cat}</span>
                  <span className="count">{inCat.length}</span>
                </button>
                {!collapsed && (
                  <button
                    className="icon-btn tiny"
                    title={`New board in ${cat}`}
                    aria-label={`New board in ${cat}`}
                    onClick={() => {
                      if (shut) useStore.getState().toggleCategoryCollapsed(cat);
                      setAddIn(cat);
                      setAdding(true);
                    }}
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
              {!shut && (
                <>
                  <BoardList list={inCat} all={live} activeId={activeId} collapsed={collapsed} renaming={renaming} setRenaming={setRenaming} />
                  {addIn === cat && addInput}
                  {inCat.length === 0 && addIn !== cat && !collapsed && <p className="muted small place-empty">No boards yet</p>}
                </>
              )}
            </DropGroup>
          );
        });

        // OneNote style, on phones and computers alike: sections (categories) with their boards, then
        // boards in no section, then + Board / + Section. Boards drag between sections.
        const tree = (
          // (Desktop: a connected phone's board dragged here comes to this computer.)
          <div className={`nav-boards ${placesMode ? "place-tree" : ""}`} data-computer-boards={isDesktopApp && !isExtraWindow ? "" : undefined}>
            <BoardsDnd all={live}>
              {!collapsed && categoryGroups}
              <DropGroup name="">
                {loose.length > 0 && categories.length > 0 && !collapsed && <div className="place-subhead">Other boards</div>}
                <BoardList list={collapsed ? live : loose} all={live} activeId={activeId} collapsed={collapsed} renaming={renaming} setRenaming={setRenaming} />
                {loose.length === 0 && categories.length > 0 && !collapsed && <NoSectionDrop />}
              </DropGroup>
            </BoardsDnd>
            {!addIn && addInput}
            {templatesLink}
            {addingSection && (
              <input
                autoFocus
                className="nav-input"
                placeholder="Section name, e.g. Home Projects"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitSection(sectionName);
                  if (e.key === "Escape") commitSection("");
                }}
                onBlur={() => commitSection(sectionName)}
              />
            )}
            {!collapsed && (
              <div className="place-actions">
                <button className="btn sm ghost" onClick={() => (setAddIn(null), setAdding(true))}>
                  <Plus size={14} /> Board
                </button>
                <button className="btn sm ghost" onClick={() => setAddingSection(true)}>
                  <FolderPlus size={14} /> Section
                </button>
              </div>
            )}
          </div>
        );
        // Phones and tablets: inside a heading per place (This phone, Computer…).
        if (placesMode && !isDeviceWindow) return <PlaceSections here={tree} />;
        return (
          <>
            <div className="nav-heading">
              <span className="label">Boards</span>
              <button className="icon-btn tiny" title="New board" onClick={() => (setAddIn(null), setAdding(true))}>
                <Plus size={14} />
              </button>
            </div>
            {tree}
          </>
        );
      })()}

      {/* Desktop: connected phones. A phone or tablet on this computer's boards: your other devices that share. */}
      {((isDesktopApp && !isExtraWindow) || (isRemote && !isDeviceWindow)) && <PhoneNav collapsed={collapsed} />}
      {!isServer && !isRemote && !placesMode && !isDeviceWindow && <ServerNav collapsed={collapsed} />}
      {inZomelloApp() && !placesMode && (
        <button className="nav-item" onClick={() => goToPhone()} title={`Switch to the boards stored on this ${deviceWord}`}>
          <Smartphone size={16} />
          <span className="label">Boards on this {deviceWord}</span>
        </button>
      )}

      <div className="grow" />
      {style === "partycat" && (
        <div className="spin-cat-spot">
          <SpinCat size={collapsed ? 44 : 64} />
        </div>
      )}
      <FocusWidget collapsed={collapsed} />
      <RunningTimer collapsed={collapsed} />
      <NavItem icon={<Archive size={16} />} label="Archive" on={route.page === "archive"} onClick={() => navigate({ page: "archive" })} />
      {isServer && me?.isAdmin && (
        <NavItem icon={<Shield size={16} />} label="Admin" on={route.page === "admin"} onClick={() => navigate({ page: "admin" })} />
      )}
      {!isDeviceWindow && (
        <NavItem icon={<Settings size={16} />} label="Settings" on={route.page === "settings"} onClick={() => navigate({ page: "settings" })} />
      )}
      <NavItem icon={<CircleHelp size={16} />} label="Help" kbd="?" onClick={() => setOverlay({ helpOpen: true })} />
      {isServer && me && <AccountButton collapsed={collapsed} />}
      <div className="sidebar-fade bottom">
        <button className="sidebar-more" tabIndex={-1} aria-label="Scroll down for more" title="More below" onClick={() => scrollSidebar(asideRef.current, 1)}>
          <ChevronDown size={14} />
          <span className="label">More</span>
        </button>
      </div>
    </aside>
  );
}

/** TCI Boards servers added in Settings: one click opens a server's window. */
function ServerNav({ collapsed }: { collapsed: boolean }) {
  const servers = useStore((s) => s.data.settings.servers ?? NO_SERVERS);
  if (!servers.length) return null;
  return (
    <>
      <div className="nav-heading">
        <span className="label">{isMobileApp ? "Places" : "Servers"}</span>
        <button className="icon-btn tiny" title="Add or manage servers" onClick={() => useStore.getState().navigate({ page: "settings" })}>
          <Plus size={14} />
        </button>
      </div>
      {isMobileApp && (
        <button className="nav-item active" title={`The boards stored on this ${deviceWord}`}>
          <Smartphone size={16} />
          <span className="ellipsis label">This {deviceWord}</span>
        </button>
      )}
      {servers.map((s) => (
        <button
          key={s.id}
          className="nav-item"
          title={collapsed ? s.name : `Open ${s.url}`}
          onClick={() => void openServer(s)}
          onContextMenu={(e) =>
            openContextMenu(e, () => [
              { label: "Open", icon: <ExternalLink size={14} />, onClick: () => void openServer(s) },
              {
                label: "Remove from this list",
                icon: <X size={14} />,
                onClick: () =>
                  useStore.getState().updateSettings({ servers: (useStore.getState().data.settings.servers ?? []).filter((x) => x.id !== s.id) }),
              },
            ])
          }
        >
          {s.kind === "computer" ? <Monitor size={16} /> : <ServerIcon size={16} />}
          <span className="ellipsis label">{s.name}</span>
        </button>
      ))}
    </>
  );
}

function RunningTimer({ collapsed }: { collapsed: boolean }) {
  const cards = useStore((s) => s.data.cards);
  const run = runningTimer(cards);
  const now = useNow(1000);
  if (!run) return null;
  const { card } = run;
  const total = card.time.reduce((s, t) => s + ((t.end ?? now) - t.start), 0);
  return (
    <div className="running-timer" title={`Timer running: ${card.title}`}>
      <span className="pulse" />
      {!collapsed && (
        <button className="grow ellipsis link-plain" onClick={() => useStore.getState().openCard(card.id)}>
          {card.title}
        </button>
      )}
      <span className="timer-text">{formatDuration(total, true)}</span>
      <button className="icon-btn tiny" title="Pause timer (time so far is kept)" onClick={() => useStore.getState().stopTimer()}>
        <Pause size={13} />
      </button>
    </div>
  );
}

/** Countdown timer: start one from here (or from a card), then pause / extend / cancel. */
function FocusWidget({ collapsed }: { collapsed: boolean }) {
  const focus = useStore((s) => s.focus);
  const defaultMin = useStore((s) => s.data.settings.focusMinutes);
  const now = useNow(1000);
  const { startFocus, pauseFocus, resumeFocus, extendFocus, endFocus, openCard } = useStore.getState();
  const [custom, setCustom] = useState("");
  const [label, setLabel] = useState("");
  const time = useFeature("time");

  // A countdown already running stays visible even with Time tracking turned off.
  if (!focus && !time) return null;
  if (!focus)
    return (
      <Popover
        trigger={(_, t) => (
          <button className="nav-item" onClick={t} title={collapsed ? "Focus timer" : undefined}>
            <Hourglass size={16} />
            <span className="label">Focus timer</span>
          </button>
        )}
      >
        {(close) => (
          <div className="menu focus-menu">
            <span className="menu-heading">Start a countdown</span>
            <input placeholder="What are you focusing on? (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <div className="focus-presets">
              {[5, 10, 15, 25, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  className={`chip-btn ${m === defaultMin ? "default" : ""}`}
                  onClick={() => {
                    startFocus(m, null, label.trim() || "Focus");
                    setLabel("");
                    close();
                  }}
                >
                  {m}m
                </button>
              ))}
            </div>
            <form
              className="row gap-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const m = parseDuration(custom);
                if (!m) return;
                startFocus(m, null, label.trim() || "Focus");
                setCustom("");
                setLabel("");
                close();
              }}
            >
              <input className="grow" placeholder="Custom: 20, 1h, 1:15…" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <button className="btn sm primary" type="submit">
                Start
              </button>
            </form>
            <p className="muted small">Tip: start one from a card to also track the time on it.</p>
          </div>
        )}
      </Popover>
    );

  const left = focus.endsAt ? Math.max(0, focus.endsAt - now) : focus.remainingMs;
  const pct = 100 - (left / focus.durationMs) * 100;
  return (
    <div className={`focus-widget ${focus.endsAt ? "" : "paused"}`} title={focus.label}>
      <div className="focus-bar" style={{ width: `${pct}%` }} />
      <div className="focus-main">
        <Hourglass size={14} />
        {!collapsed && (
          <button className="grow ellipsis link-plain" onClick={() => focus.cardId && openCard(focus.cardId)} disabled={!focus.cardId}>
            {focus.label}
          </button>
        )}
        <span className="timer-text">{formatDuration(left, true).replace(/^0:/, "")}</span>
      </div>
      {!collapsed && (
        <div className="focus-actions">
          {focus.endsAt ? (
            <button className="btn sm ghost" onClick={pauseFocus}>
              <Pause size={12} /> Pause
            </button>
          ) : (
            <button className="btn sm ghost" onClick={resumeFocus}>
              <Play size={12} /> Resume
            </button>
          )}
          <button className="btn sm ghost" onClick={() => extendFocus(5)}>
            +5m
          </button>
          <button className="btn sm ghost" title="Cancel the countdown" onClick={() => endFocus(false)}>
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

/** A board in the sidebar: drag to reorder, right-click for board actions, inline rename. */
function BoardLink({
  board,
  active,
  collapsed,
  renaming,
  onRename,
  onRenamed,
}: {
  board: Board;
  active: boolean;
  collapsed: boolean;
  renaming: boolean;
  onRename: () => void;
  onRenamed: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: board.id, disabled: renaming });
  const st = useStore.getState();
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const icon = board.icon ? <span className="nav-emoji">{board.icon}</span> : <span className="board-dot" style={{ background: board.color }} />;

  if (renaming)
    return (
      <div ref={setNodeRef} style={style} className="nav-item renaming">
        {icon}
        <input
          autoFocus
          className="nav-input"
          defaultValue={board.title}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = board.title;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t && t !== board.title) st.updateBoard(board.id, { title: t });
            onRenamed();
          }}
        />
      </div>
    );

  const menu = () => boardMenu(board, { onRename });

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`nav-item ${active ? "active" : ""}`}
      onClick={() => st.navigate({ page: "board", boardId: board.id })}
      onDoubleClick={onRename}
      // Middle-click: open in its own window (and stop the browser's autoscroll). Left button: the
      // drag-to-reorder handler, which this would otherwise replace.
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
        else listeners?.onMouseDown?.(e);
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        void openBoardWindow(board.id, board.title);
      }}
      onContextMenu={(e) => openContextMenu(e, menu)}
      title={collapsed ? board.title : "Drag to reorder · double-click to rename · middle-click for a new window · right-click for more"}
    >
      {icon}
      <span className="ellipsis label">{board.title}</span>
      {!collapsed && (board.members?.length ?? 0) > 1 && <SharedMark board={board} />}
      {!collapsed && board.private && (
        <span className="private-mark muted" title="Private: only on this device" aria-label="Private">
          <Lock size={12} />
        </span>
      )}
    </button>
  );
}

/** Shared boards get a small people icon; hovering says whose board it is. */
function SharedMark({ board }: { board: Board }) {
  const owner = board.members?.find((m) => m.role === "owner");
  const mine = owner?.userId === me?.id;
  return (
    <span
      className="shared-icon"
      aria-label="Shared"
      title={mine ? `Shared with ${board.members!.length - 1} ${board.members!.length === 2 ? "person" : "people"}` : `${owner?.displayName ?? "Someone"}'s board`}
    >
      <Users size={12} />
    </span>
  );
}

/** A draggable list of boards. `list` may be a subset (Starred) of `all`; the full order is updated either way.
 * Inside a BoardsDnd (the sections of the sidebar) it shares that drag area, so boards can also be
 * dragged into another section; on its own (Starred) it only reorders. */
function BoardList({
  list,
  all,
  activeId,
  collapsed,
  renaming,
  setRenaming,
}: {
  list: Board[];
  all: Board[];
  activeId: ID | null;
  collapsed: boolean;
  renaming: ID | null;
  setRenaming: (id: ID | null) => void;
}) {
  const shared = useContext(BoardsDndState) !== null;
  const sensors = useDragSensors(5);
  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    if (!over || a.id === over.id) return;
    const ids = list.map((b) => b.id);
    const moved = arrayMove(ids, ids.indexOf(String(a.id)), ids.indexOf(String(over.id)));
    // Put the reordered subset back into the slots it occupies in the full order.
    const order = all.map((b) => b.id);
    const slots = order.map((id, i) => (ids.includes(id) ? i : -1)).filter((i) => i >= 0);
    slots.forEach((slot, k) => (order[slot] = moved[k]));
    useStore.getState().reorderBoards(order);
  };
  const items = (
    <SortableContext items={list.map((b) => b.id)} strategy={verticalListSortingStrategy}>
      {list.map((b) => (
        <BoardLink
          key={b.id}
          board={b}
          active={activeId === b.id}
          collapsed={collapsed}
          renaming={renaming === b.id}
          onRename={() => setRenaming(b.id)}
          onRenamed={() => setRenaming(null)}
        />
      ))}
    </SortableContext>
  );
  if (shared) return items;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis]}>
      {items}
    </DndContext>
  );
}

/** While dragging a board in the sections: which section it would land in ("" = none), or null. */
const BoardsDndState = createContext<{ dragging: boolean; over: string | null } | null>(null);
const GROUP = "group:";

/**
 * One drag area for all of the sidebar's board sections: drag a board within its section to reorder,
 * or onto another section (its heading, or among its boards) to move it there. "" is "no section".
 */
function BoardsDnd({ all, children }: { all: Board[]; children: ReactNode }) {
  const sensors = useDragSensors(5);
  const [state, setState] = useState<{ dragging: boolean; over: string | null }>({ dragging: false, over: null });
  const groupOf = (id: string): string | undefined => {
    if (id.startsWith(GROUP)) return id.slice(GROUP.length);
    const b = all.find((x) => x.id === id);
    return b ? (b.category ?? "") : undefined;
  };
  // A board under the pointer wins over the section around it (so a drop can also reorder).
  const collide: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    const boards = hits.filter((h) => !String(h.id).startsWith(GROUP));
    if (boards.length) return boards;
    if (hits.length) return hits;
    return closestCenter(args);
  };
  return (
    <BoardsDndState.Provider value={state}>
      <DndContext
        sensors={sensors}
        collisionDetection={collide}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={() => setState({ dragging: true, over: null })}
        onDragOver={({ over }) => setState({ dragging: true, over: over ? (groupOf(String(over.id)) ?? null) : null })}
        onDragMove={(e) => (placesMode || isDesktopApp) && markPlace(placeAt(e))}
        onDragCancel={() => {
          setState({ dragging: false, over: null });
          markPlace(undefined);
        }}
        onDragEnd={(e) => {
          const { active, over } = e;
          setState({ dragging: false, over: null });
          // Phones and tablets: dropped on another place's heading (This phone, Computer, a server).
          // Desktop: dropped on a connected phone's heading.
          const place = placesMode || isDesktopApp ? placeAt(e) : undefined;
          markPlace(undefined);
          if (place?.dataset.device) return void dropOnPhone(String(active.id), { id: place.dataset.device, name: place.dataset.placeName ?? "your phone" });
          if (place) return void dropOnPlace(String(active.id), { key: place.dataset.place!, name: place.dataset.placeName ?? "" });
          if (!over) return;
          const a = String(active.id);
          const o = String(over.id);
          const to = groupOf(o);
          if (to === undefined) return;
          const st = useStore.getState();
          const from = groupOf(a) ?? "";
          if (from !== to) {
            // Like OneNote, a section stays when its last board is dragged out (remove it from its menu).
            if (from && all.filter((b) => b.category === from).length === 1) st.addCategory(from);
            st.setBoardCategory(a, to || null);
          }
          if (!o.startsWith(GROUP) && o !== a) {
            const order = all.map((b) => b.id);
            st.reorderBoards(arrayMove(order, order.indexOf(a), order.indexOf(o)));
          }
        }}
      >
        {children}
      </DndContext>
    </BoardsDndState.Provider>
  );
}

/** Where the pointer is during a board drag (it started on the board and moved by `delta`). */
function placeAt(e: { activatorEvent: Event | null; delta: { x: number; y: number } }): HTMLElement | undefined {
  const start = e.activatorEvent as (MouseEvent & TouchEvent) | null;
  if (!start) return undefined;
  const p = start.touches?.[0] ?? start.changedTouches?.[0] ?? start;
  const x = p.clientX;
  const y = p.clientY + e.delta.y;
  return document.elementsFromPoint(x, y).find((el): el is HTMLElement => el instanceof HTMLElement && !!(el.dataset.place || el.dataset.device));
}

/** Light up the place heading a board would be dropped on. */
function markPlace(el: HTMLElement | undefined) {
  document.querySelectorAll("[data-place].drop-into, [data-device].drop-into").forEach((n) => n !== el && n.classList.remove("drop-into"));
  el?.classList.add("drop-into");
}

/** Desktop: a board dropped on a connected phone. */
async function dropOnPhone(boardId: string, phone: { id: string; name: string }) {
  const board = useStore.getState().data.boards[boardId];
  if (!board) return;
  const pick = await askChoice(`Move “${board.title}” to ${phone.name}? Or keep it here and put a copy there.`, "Move", "Copy");
  if (pick) void sendBoardToPhone(boardId, phone, pick === "ok");
}

/** A board dropped on another place: move it there (or copy it). */
async function dropOnPlace(boardId: string, to: { key: string; name: string }) {
  const board = useStore.getState().data.boards[boardId];
  if (!board) return;
  if (!ownsBoard(board)) {
    if (await ask(`Copy “${board.title}” to ${to.name}?`, { okText: "Copy" })) void sendBoard(boardId, to, false);
    return;
  }
  const pick = await askChoice(`Move “${board.title}” to ${to.name}? Or keep it here and put a copy there.`, "Move", "Copy");
  if (pick) void sendBoard(boardId, to, pick === "ok");
}

/** A section (or "no section", name "") boards can be dropped into; lit up while a board is over it. */
function DropGroup({ name, className = "", children }: { name: string; className?: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: GROUP + name });
  const st = useContext(BoardsDndState);
  const lit = st?.dragging && st.over === name;
  return (
    <div ref={setNodeRef} className={`${className} ${lit ? "drop-into" : ""}`}>
      {children}
    </div>
  );
}

/** "No section" while dragging, when no board is outside a section yet: somewhere to drop. */
function NoSectionDrop() {
  const st = useContext(BoardsDndState);
  if (!st?.dragging) return null;
  return (
    <DropGroup name="" className="no-section-drop">
      Drop here for no section
    </DropGroup>
  );
}

/** TCI Boards server: who's signed in, with account settings and sign-out. */
function AccountButton({ collapsed }: { collapsed: boolean }) {
  const name = useStore((s) => s.data.settings.me);
  return (
    <Popover
      trigger={(_, t) => (
        <button className="nav-item account-btn" onClick={t} title={collapsed ? name : "Your account"}>
          <Avatar name={name} size={20} />
          <span className="label ellipsis">{name}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="menu">
          <span className="menu-heading">Signed in as @{me?.username}</span>
          <button
            className="menu-item"
            onClick={() => {
              close();
              useStore.getState().navigate({ page: "settings" });
              setTimeout(() => document.getElementById("set-account")?.scrollIntoView({ behavior: "smooth" }), 100);
            }}
          >
            <UserCog size={14} /> <span>Your account</span>
          </button>
          <button
            className="menu-item"
            onClick={async () => {
              close();
              await logout().catch(() => {});
              location.hash = "";
              location.reload();
            }}
          >
            <LogOut size={14} /> <span>Sign out</span>
          </button>
        </div>
      )}
    </Popover>
  );
}

/**
 * The sidebar has no scrollbar, so a soft fade at its top or bottom edge shows there's more that way.
 * Marks the element "more-above" / "more-below"; checked on scroll, resize, and whenever the sidebar renders.
 */
/** Scroll the sidebar most of a screen up (-1) or down (1). */
function scrollSidebar(el: HTMLElement | null, dir: 1 | -1) {
  el?.scrollBy({ top: dir * el.clientHeight * 0.7, behavior: "smooth" });
}

function useScrollFades() {
  const ref = useRef<HTMLElement>(null);
  const check = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.toggle("more-above", el.scrollTop > 2);
    el.classList.toggle("more-below", el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  };
  useLayoutEffect(check);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener("scroll", check, { passive: true });
    return () => (ro.disconnect(), el.removeEventListener("scroll", check));
  }, []);
  return ref;
}
