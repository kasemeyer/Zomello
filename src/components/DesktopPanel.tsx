import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow } from "lucide-react";
import { useStore } from "../store";

/** Settings → Desktop app: keep running in the tray, start at login. */
export function DesktopPanel() {
  const bg = useStore((s) => s.data.settings.runInBackground);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  /** Installed from the Microsoft Store: Windows' own Startup list decides. */
  const [store, setStore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void invoke<boolean>("get_autostart").then(setAutostart).catch(() => setAutostart(false));
    void invoke<boolean>("store_package").then(setStore).catch(() => setStore(false));
  }, []);

  const setBackground = async (on: boolean) => {
    setError("");
    try {
      await invoke("set_background_mode", { enabled: on });
      useStore.getState().updateSettings({ runInBackground: on });
      if (on) useStore.getState().toast("Closing the window now keeps TCI Boards running in the tray");
    } catch (e) {
      setError(String(e));
    }
  };
  const setLogin = async (on: boolean) => {
    setError("");
    try {
      await invoke("set_autostart", { enabled: on });
      setAutostart(on);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="panel" id="set-desktop">
      <h3>
        <AppWindow size={15} /> Desktop app
      </h3>
      <label className="check-row">
        <input type="checkbox" checked={bg} onChange={(e) => void setBackground(e.target.checked)} />
        <span>
          Keep running in the tray when I close the window
          <small className="muted">
            Phones and tablets stay connected and reminders keep coming. Open or quit TCI Boards from its tray icon.
          </small>
        </span>
      </label>
      {store ? (
        <p className="small muted">
          <b>Start TCI Boards when I log in:</b>{" "}
          {/Macintosh/.test(navigator.userAgent)
            ? "turn it on in macOS: System Settings → General → Login Items → + → TCI Boards."
            : "turn it on in Windows: Settings → Apps → Startup → TCI Boards."}
        </p>
      ) : (
        <label className="check-row">
          <input type="checkbox" checked={!!autostart} disabled={autostart === null} onChange={(e) => void setLogin(e.target.checked)} />
          <span>
            Start TCI Boards when I log in
            <small className="muted">{bg ? "It starts quietly in the tray." : "Turn on the option above to have it start quietly in the tray."}</small>
          </span>
        </label>
      )}
      {error && <p className="small danger-text">{error}</p>}
    </section>
  );
}
