import { useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { invoke } from "@tauri-apps/api/core";
import { Download, KeyRound, QrCode, RefreshCw, ShieldCheck, Smartphone, Unlink, X } from "lucide-react";
import { useStore } from "../store";
import { ask, InlineEdit, Modal } from "./ui";
import { copyText } from "./Markdown";
import { DeviceBackups } from "./DeviceBackups";

interface DeviceInfo {
  id: string;
  name: string;
  created: number;
  last_seen: number;
  /** Its boards show on this computer while it's connected. */
  show_boards: boolean;
  /** The TCI Boards app on it has linked with this computer (it can share its boards). */
  can_link: boolean;
}
interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  addresses: string[];
  address: string | null;
  host: string | null;
  url: string | null;
  secure_url: string | null;
  setup_url: string | null;
  error: string | null;
  devices: DeviceInfo[];
  firewall: { kind: "ufw" | "firewalld" | "windows" | "macos" | "none"; allowed: boolean; command: string | null };
  cert: { fingerprint: string; created: number; covers_address: boolean } | null;
}
interface PairingInfo {
  code: string;
  url: string;
  qr_svg: string;
  expires_in: number;
}

const FIREWALL_NAME = { ufw: "ufw", firewalld: "firewalld", windows: "Windows Firewall", macos: "The macOS firewall", none: "" };
const CUSTOM = "\u0000custom";

/** Settings → Phones & tablets (desktop app only): the home-network server, pairing, certificate and unlinking. */
export function DevicesPanel() {
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [certQr, setCertQr] = useState<string | null>(null);
  const [port, setPort] = useState("");
  /** Text of the custom-address box while it's open. */
  const [custom, setCustom] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "firewall" | "cert">("");
  const toast = (t: string) => useStore.getState().toast(t);
  const runInBackground = useStore((s) => s.data.settings.runInBackground);

  useEffect(() => {
    const refresh = () => void invoke<RemoteStatus>("remote_status").then(setSt);
    refresh();
    let gone = false;
    const uns: (() => void)[] = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const a = await listen("zomello://remote-changed", refresh);
      // A device just paired (from its own screen): close the pairing window.
      const b = await listen("zomello://device-paired", () => {
        refresh();
        setPairing((p) => {
          if (p) toast("Device connected");
          return null;
        });
      });
      if (gone) (a(), b());
      else uns.push(a, b);
    });
    return () => {
      gone = true;
      uns.forEach((u) => u());
    };
  }, []);

  if (!st) return null;

  const run = async (fn: () => Promise<RemoteStatus>, okText?: string) => {
    try {
      setSt(await fn());
      if (okText) toast(okText);
      return true;
    } catch (e) {
      toast(String(e));
      return false;
    }
  };
  const setEnabled = (enabled: boolean) => {
    const p = Number(port);
    setPort("");
    return run(() => invoke("remote_set_enabled", { enabled, port: p >= 1024 && p <= 65535 ? p : null }));
  };
  const setAddress = (address: string | null) => run(() => invoke("remote_set_address", { address }));
  const startPairing = async () => {
    try {
      setPairing(await invoke<PairingInfo>("remote_start_pairing"));
    } catch (e) {
      toast(String(e));
    }
  };
  const unlink = async (d: DeviceInfo) => {
    if (!(await ask(`Unlink “${d.name}”? It's disconnected right away and would need to pair again.`, { okText: "Unlink", danger: true })))
      return;
    await run(() => invoke("remote_unlink", { id: d.id }));
  };
  const openFirewall = async () => {
    setBusy("firewall");
    await run(() => invoke("remote_open_firewall"), "Phones and tablets can now get through the firewall");
    setBusy("");
  };
  const regenerate = async () => {
    if (
      !(await ask(
        "Make a new security certificate? Every phone and tablet that installed the current one will need to install the new one (and can remove the old one).",
        { okText: "Make a new one", danger: true },
      ))
    )
      return;
    setBusy("cert");
    await run(() => invoke("remote_regenerate_cert"), "New certificate made. Install it on your devices again.");
    setBusy("");
  };
  const exportCert = async () => {
    try {
      const path = await invoke<string>("remote_export_cert");
      toast(`Saved ${path}`);
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path).catch(() => {});
    } catch (e) {
      toast(String(e));
    }
  };
  const showCertQr = async () => {
    if (st.setup_url) setCertQr(await invoke<string>("remote_qr", { text: st.setup_url }));
  };

  const on = st.enabled && st.running;
  const fw = st.firewall;

  return (
    <section className="panel" id="set-devices">
      <h3>
        <Smartphone size={16} /> Phones &amp; tablets
      </h3>
      <p className="muted small">
        Use TCI Boards from phones and tablets on your home network, and install it on them as an app. It works while this
        computer is on and TCI Boards is open; your data stays here, and only devices you pair can connect.
      </p>

      <ol className="setup-steps">
        <li className={on ? "done" : "current"}>
          <div className="step-title">Turn it on</div>
          <label className="row gap-sm">
            <input type="checkbox" checked={st.enabled} onChange={(e) => void setEnabled(e.target.checked)} />
            Allow access from phones and tablets on this network
          </label>
          {st.error && <p className="small danger-text">{st.error}</p>}
          {on && !runInBackground && (
            <p className="small muted">
              Tip: turn on <b>Desktop app → Keep running in the tray</b> so devices still connect after you close this window.
            </p>
          )}

          <div className="address-row small">
            <span className="muted">Devices connect to</span>
            {custom !== null ? (
              <form
                className="row gap-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void setAddress(custom.trim() || null).then((ok) => ok && setCustom(null));
                }}
              >
                <input
                  autoFocus
                  className="address-input"
                  placeholder="e.g. 192.168.1.20 or mypc.lan"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setCustom(null)}
                />
                <button className="btn sm primary">Use</button>
                <button type="button" className="btn sm ghost" onClick={() => setCustom(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <select
                value={st.address ?? ""}
                onChange={(e) => (e.target.value === CUSTOM ? setCustom(st.address ?? "") : void setAddress(e.target.value || null))}
              >
                <option value="">Automatic ({st.addresses[0] ?? "not found"})</option>
                {st.addresses.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                {st.address && !st.addresses.includes(st.address) && <option value={st.address}>{st.address}</option>}
                <option value={CUSTOM}>Custom address or name…</option>
              </select>
            )}
            <span className="muted">port</span>
            <input
              className="port-input"
              inputMode="numeric"
              placeholder={String(st.port)}
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && st.enabled && void setEnabled(true)}
              title="Change only if something else uses this port. Press Enter to apply."
            />
          </div>
          <p className="small muted">
            Automatic uses the address this computer reaches the internet with. Pick another if it has several (Wi‑Fi and
            Ethernet, or a VPN), or type a name your router gives it. Ask your router for a fixed address (a
            “DHCP reservation”) so it never changes.
          </p>
        </li>

        <li className={!on ? "" : fw.allowed ? "done" : "current"}>
          <div className="step-title">Let it through the firewall</div>
          {fw.kind === "none" ? (
            <p className="small muted">No firewall is blocking it. Nothing to do.</p>
          ) : fw.allowed ? (
            <p className="small ok-text">Allowed through {FIREWALL_NAME[fw.kind]}.</p>
          ) : (
            <>
              <p className="small muted">
                {FIREWALL_NAME[fw.kind]} blocks phones until you allow TCI Boards.{" "}
                {fw.kind === "windows" ? "Windows will ask you to confirm." : "You'll be asked for your password."}
              </p>
              <button className="btn" disabled={!on || busy === "firewall"} onClick={() => void openFirewall()}>
                <ShieldCheck size={14} /> {busy === "firewall" ? "Waiting for your OK…" : "Allow through firewall"}
              </button>
              {fw.command && (
                <details className="small muted">
                  <summary>Or do it yourself</summary>
                  <code className="copyable" onClick={() => void copyText(fw.command!)} title="Copy">
                    {fw.command}
                  </code>
                </details>
              )}
            </>
          )}
        </li>

        <li className={on && fw.allowed ? (st.devices.length ? "done" : "current") : ""}>
          <div className="step-title">Pair a phone or tablet</div>
          <p className="small muted">
            Scan the QR code with the device. It opens a short setup page there: install this computer's security
            certificate (once per device), then <b>Install app</b> in Chrome, or <b>Add to Home Screen</b> on iPhone/iPad.
          </p>
          <button className="btn primary" disabled={!on} onClick={startPairing}>
            <Smartphone size={14} /> Pair a device
          </button>
        </li>
      </ol>

      <div className="cert-box">
        <div className="step-title">
          <KeyRound size={14} /> Security certificate
        </div>
        <p className="small muted">
          Devices install this once so their browser trusts this computer's secure (https) address, which installing as an
          app needs. It only works for home-network addresses, so it can't vouch for any real website.
        </p>
        {st.cert && (
          <p className="small muted">
            Made {st.cert.created ? format(st.cert.created * 1000, "MMM d, yyyy") : "earlier"} · fingerprint{" "}
            <code title={st.cert.fingerprint}>{st.cert.fingerprint.slice(0, 23)}…</code>
          </p>
        )}
        {st.cert && !st.cert.covers_address && (
          <p className="small danger-text">
            This certificate doesn't cover <b>{st.host}</b>. Make a new one to use that address securely.
          </p>
        )}
        <div className="row gap-sm wrap">
          <button className="btn sm" disabled={!on} onClick={() => void showCertQr()}>
            <QrCode size={14} /> Put it on a device
          </button>
          <button className="btn sm" onClick={() => void exportCert()}>
            <Download size={14} /> Save certificate file
          </button>
          <button className="btn sm" disabled={busy === "cert"} onClick={() => void regenerate()}>
            <RefreshCw size={14} /> Make a new certificate
          </button>
        </div>
        <details className="small muted">
          <summary>Installing the saved file by hand</summary>
          <p>Send it to the device (USB cable, email, AirDrop, a cloud drive) and then:</p>
          <p>
            <b>Android:</b> Settings → search “CA certificate” → Install anyway → choose <code>zomello-ca.crt</code>.
          </p>
          <p>
            <b>iPhone/iPad:</b> open the file → Settings → General → VPN &amp; Device Management → Install; then Settings →
            General → About → Certificate Trust Settings → turn on TCI Boards.
          </p>
          <p>
            <b>Windows / Mac / Linux computers:</b> open it and add it as a trusted root certificate (Windows: “Trusted Root
            Certification Authorities”; Mac: Keychain Access → Always Trust).
          </p>
        </details>
      </div>

      {st.devices.length > 0 && (
        <ul className="archive-list devices">
          {st.devices.map((d) => (
            <li key={d.id}>
              <Smartphone size={15} className="muted" />
              <span className="grow">
                <InlineEdit
                  value={d.name}
                  onSave={(name) => void (name.trim() && run(() => invoke("remote_rename", { id: d.id, name })))}
                />
                <span className="muted small">
                  Paired {formatDistanceToNow(d.created * 1000, { addSuffix: true })} · last seen{" "}
                  {formatDistanceToNow(d.last_seen * 1000, { addSuffix: true })}
                </span>
                {d.can_link && (
                  <label className="check-row small">
                    <input
                      type="checkbox"
                      checked={d.show_boards}
                      onChange={(e) => void run(() => invoke("remote_show_boards", { id: d.id, show: e.target.checked }))}
                    />
                    Show its boards on this computer while it's connected
                  </label>
                )}
              </span>
              <button className="btn sm" onClick={() => void unlink(d)}>
                <Unlink size={14} /> Unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      <DeviceBackups />

      {pairing && (
        <PairingWindow
          info={pairing}
          setupUrl={st.setup_url}
          onClose={() => {
            void invoke("remote_cancel_pairing");
            setPairing(null);
          }}
        />
      )}
      {certQr && (
        <Modal onClose={() => setCertQr(null)} width={440} className="pairing">
          <header className="customize-head">
            <h2>Put the certificate on a device</h2>
            <button className="icon-btn" title="Close" aria-label="Close" onClick={() => setCertQr(null)}>
              <X size={18} />
            </button>
          </header>
          <div className="customize-body pairing-body">
            <p className="small">Scan with the phone or tablet. Its setup page has the download and the steps:</p>
            {/* Generated by the app itself (qrcode crate). */}
            <div className="qr" dangerouslySetInnerHTML={{ __html: certQr }} />
            <p className="small muted">
              Or open <code>{st.setup_url}</code> on it.
            </p>
          </div>
        </Modal>
      )}
    </section>
  );
}

function PairingWindow({ info, setupUrl, onClose }: { info: PairingInfo; setupUrl: string | null; onClose: () => void }) {
  const [left, setLeft] = useState(info.expires_in);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Modal onClose={onClose} width={440} className="pairing">
      <header className="customize-head">
        <h2>Pair a device</h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body pairing-body">
        {left === 0 ? (
          <p className="muted">This code expired. Close this and choose Pair a device again.</p>
        ) : (
          <>
            <p className="small">Scan with the phone or tablet camera, on the same network as this computer:</p>
            {/* Generated by the app itself (qrcode crate), not from user input. */}
            <div className="qr" dangerouslySetInnerHTML={{ __html: info.qr_svg }} />
            <p className="small muted">
              Or open <code>{setupUrl}</code> in its browser and enter:
            </p>
            <div className="pair-big-code">
              {info.code.slice(0, 3)} {info.code.slice(3)}
            </div>
            <p className="small muted">
              Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · works once
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
