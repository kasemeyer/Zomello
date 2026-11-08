import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { format } from "date-fns";
import { Copy, HardDriveDownload, Lock, Send, Trash2 } from "lucide-react";
import { buildBoardFile, openBoardFile } from "../boardFile";
import { received } from "../phoneTransfer";
import { useStore } from "../store";
import type { AppData } from "../types";
import { ask, Popover } from "./ui";

interface BackupDay {
  date: string;
  at: number;
  boards: number;
  private: boolean;
}
interface DeviceBackup {
  id: string;
  name: string;
  days: BackupDay[];
}

/**
 * Settings > Phones & tablets (desktop app): copies of phones' and tablets' boards that they asked this
 * computer to keep (see backup.rs). Send one back to a device after a reinstall, or copy it here.
 */
export function DeviceBackups() {
  const [list, setList] = useState<DeviceBackup[]>([]);
  const [connected, setConnected] = useState<{ id: string; name: string }[]>([]);
  const [day, setDay] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let gone = false;
    let un: (() => void) | undefined;
    const load = () => {
      void invoke<DeviceBackup[]>("device_backups").then((l) => !gone && setList(l), () => {});
      void invoke<{ id: string; name: string }[]>("linked_connected").then((l) => !gone && setConnected(l), () => {});
    };
    load();
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const u = await listen("zomello://linked-changed", load);
      if (gone) u();
      else un = u;
    });
    return () => {
      gone = true;
      un?.();
    };
  }, []);

  if (!list.length) return null;
  const toast = (text: string) => useStore.getState().toast(text, { key: "device-backup" });
  const reload = () => void invoke<DeviceBackup[]>("device_backups").then(setList);

  const read = async (dev: DeviceBackup, date: string) => {
    const b = await invoke<{ data: string; private: string | null }>("device_backup_read", { id: dev.id, date });
    const data = JSON.parse(b.data) as AppData;
    const boards = Object.values(data.boards ?? {});
    // Attached files come from the backup's own copies (they were on the device, not here).
    const readFile = async (url: string) => new Uint8Array(await invoke<ArrayBuffer>("device_backup_file", { id: dev.id, rel: url }));
    return { data, boards, locked: b.private, readFile };
  };

  const sendTo = async (dev: DeviceBackup, date: string, to: { id: string; name: string }) => {
    setBusy(dev.id);
    try {
      const { data, boards, locked, readFile } = await read(dev, date);
      toast(`Sending ${boards.length} ${boards.length === 1 ? "board" : "boards"} to ${to.name}…`);
      for (const b of boards) {
        const { bytes } = await buildBoardFile(data, b.id, undefined, readFile);
        const tid = await invoke<string>("linked_send_board", bytes, { headers: { "x-device": to.id } });
        if (!(await received(tid, 45_000))) throw new Error(`${to.name} didn't answer. Check that TCI Boards is open on it and try again.`);
      }
      if (locked) await invoke("linked_send_private", { id: to.id, blob: locked });
      toast(
        `Sent ${boards.length} ${boards.length === 1 ? "board" : "boards"} to ${to.name}${locked ? ". It asks for the backup password to add the private ones" : ""}.`,
      );
    } catch (e) {
      toast(`Couldn't send the backup: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const copyHere = async (dev: DeviceBackup, date: string) => {
    setBusy(dev.id);
    try {
      const { data, boards, readFile } = await read(dev, date);
      for (const b of boards) {
        const { bytes } = await buildBoardFile(data, b.id, undefined, readFile);
        await openBoardFile(bytes, `From ${dev.name}'s backup:`);
      }
    } catch (e) {
      toast(`Couldn't copy the backup: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  };

  const remove = async (dev: DeviceBackup) => {
    if (!(await ask(`Delete all of ${dev.name}'s backups on this computer?`, { okText: "Delete", danger: true }))) return;
    await invoke("device_backup_delete", { id: dev.id, date: null }).catch((e) => toast(String(e)));
    reload();
  };

  return (
    <div className="device-backups">
      <h4>
        <HardDriveDownload size={15} /> Device backups
      </h4>
      <p className="muted small">
        Phones and tablets that turned on <b>Back up this phone's boards on my computer</b> are kept here: a copy a day while they're
        connected, for two weeks. After a reinstall, pair the device again, then send its backup to it. Each copy is only a copy:
        changing boards here doesn't change it.
      </p>
      <ul className="archive-list devices">
        {list.map((dev) => {
          const date = day[dev.id] ?? dev.days[0].date;
          const d = dev.days.find((x) => x.date === date) ?? dev.days[0];
          return (
            <li key={dev.id}>
              <span className="grow">
                <b>{dev.name}</b>
                <span className="muted small">
                  {d.boards} {d.boards === 1 ? "board" : "boards"}
                  {d.private && (
                    <>
                      {" "}
                      · <Lock size={11} /> private boards locked with its password
                    </>
                  )}
                </span>
                <select value={date} onChange={(e) => setDay({ ...day, [dev.id]: e.target.value })} aria-label={`Which backup of ${dev.name}`}>
                  {dev.days.map((x) => (
                    <option key={x.date} value={x.date}>
                      {format(x.at * 1000, "EEE, MMM d, p")}
                    </option>
                  ))}
                </select>
              </span>
              <Popover
                align="right"
                trigger={(_, toggle) => (
                  <button className="btn sm" disabled={busy === dev.id} onClick={toggle}>
                    <Send size={14} /> Send to a device…
                  </button>
                )}
              >
                {(close) => (
                  <div className="menu">
                    {connected.length ? (
                      connected.map((c) => (
                        <button
                          key={c.id}
                          className="menu-item"
                          onClick={() => {
                            close();
                            void sendTo(dev, d.date, c);
                          }}
                        >
                          {c.name}
                        </button>
                      ))
                    ) : (
                      <p className="muted small">No phone or tablet is connected right now. Open TCI Boards on it (paired, on the same Wi‑Fi).</p>
                    )}
                  </div>
                )}
              </Popover>
              <button className="btn sm" disabled={busy === dev.id} onClick={() => void copyHere(dev, d.date)} title="Add copies of these boards to this computer">
                <Copy size={14} /> Copy to this computer
              </button>
              <button className="icon-btn" title={`Delete ${dev.name}'s backups`} aria-label={`Delete ${dev.name}'s backups`} onClick={() => void remove(dev)}>
                <Trash2 size={15} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
