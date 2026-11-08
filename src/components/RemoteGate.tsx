import { PhoneBoardsButton } from "./PhoneBoardsButton";
import { saveSignIn } from "../places";
import { useEffect, useState, type ReactNode } from "react";
import { Smartphone, Wifi, WifiOff } from "lucide-react";
import {
  guessDeviceName, httpsTrusted, isIOS, isRemote, onConnectionChange, remotePair, remoteStatus, UNPAIRED_EVENT,
} from "../remote";
import { isServer, onServerConnection } from "../server";
import { LogoMark } from "./Logo";

type Gate = "checking" | "paired" | "unpaired" | "unreachable";

/** On a phone or tablet: show the pairing screen until this device is paired with the computer. */
export function RemoteGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>(isRemote ? "checking" : "paired");

  const check = () =>
    remoteStatus()
      .then((s) => setGate(s.paired ? "paired" : "unpaired"))
      .catch(() => setGate("unreachable"));

  useEffect(() => {
    if (!isRemote) return;
    // Opened at the plain http address (an old bookmark or shortcut)? If this device trusts the computer's
    // certificate, move to the secure address so Chrome shows it as secure and offers "Install app".
    if (location.protocol === "http:" && !isIOS()) {
      void httpsTrusted().then((ok) => {
        if (ok) location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`);
        else void check();
      });
    } else void check();
    const h = () => setGate("unpaired");
    window.addEventListener(UNPAIRED_EVENT, h);
    return () => window.removeEventListener(UNPAIRED_EVENT, h);
  }, []);

  if (gate === "paired") return <>{children}</>;
  if (gate === "checking")
    return (
      <div className="splash">
        <LogoMark size={72} />
      </div>
    );
  if (gate === "unreachable")
    return (
      <div className="pair-screen">
        <WifiOff size={36} className="muted" />
        <h2>Can't reach TCI Boards on your computer</h2>
        <p className="muted">Make sure the computer is on, TCI Boards is open, and this device is on the same Wi‑Fi.</p>
        <button className="btn primary" onClick={() => (setGate("checking"), void check())}>
          Try again
        </button>
        <PhoneBoardsButton />
      </div>
    );
  return <PairForm onPaired={() => (saveSignIn(), location.reload())} />;
}

function PairForm({ onPaired }: { onPaired: () => void }) {
  // Scanning the QR code opens …/#pair=123456; the code is in the fragment, so it never reaches the server.
  const [code, setCode] = useState(() => new URLSearchParams(location.hash.slice(1)).get("pair") ?? "");
  const [name, setName] = useState(guessDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (location.hash) history.replaceState(null, "", location.pathname);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await remotePair(code.replace(/\D/g, ""), name);
      onPaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="pair-screen"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <LogoMark size={56} />
      <h2>Connect this device to TCI Boards</h2>
      <p className="muted">
        On your computer, open <b>Settings → Phones &amp; tablets</b> and choose <b>Pair a device</b>. Enter the code it shows.
      </p>
      <label>
        Pairing code
        <input
          className="pair-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus={!code}
        />
      </label>
      <label>
        Name this device
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      {error && <p className="pair-error">{error}</p>}
      <button className="btn primary" disabled={busy || code.replace(/\D/g, "").length !== 6}>
        <Smartphone size={16} /> {busy ? "Connecting…" : "Connect"}
      </button>
      <PhoneBoardsButton />
      {!window.isSecureContext && (
        <a className="muted small" href={`/setup${code ? `#pair=${code}` : ""}`}>
          Want to install TCI Boards as an app? Set up a secure connection first.
        </a>
      )}
    </form>
  );
}

/** On Android over plain http: explain why it says "Not secure" and how to fix it. */
export function SecureBanner() {
  const [show, setShow] = useState(() => {
    try {
      return isRemote && location.protocol === "http:" && !isIOS() && !sessionStorage.getItem("zomello-secure-hint");
    } catch {
      return false;
    }
  });
  if (!show) return null;
  return (
    <div className="secure-banner">
      <span className="grow">
        Chrome shows this as <b>Not secure</b>, and TCI Boards can't be installed as an app yet. One-time setup fixes both.
      </span>
      <a className="btn sm primary" href="/setup">
        Set up
      </a>
      <button
        className="icon-btn tiny"
        aria-label="Hide"
        onClick={() => {
          try {
            sessionStorage.setItem("zomello-secure-hint", "1");
          } catch {
            /* fine */
          }
          setShow(false);
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * A small status pill while a device is reconnecting. It waits a few seconds first (a phone coming back
 * from the background usually reconnects in a moment), and says "Connected" briefly when it's back.
 */
export function ConnectionBanner() {
  const [state, setState] = useState<"ok" | "reconnecting" | "back">("ok");
  useEffect(() => {
    if (!isRemote && !isServer) return;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    const off = (isServer ? onServerConnection : onConnectionChange)((online) => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (!online) {
        showTimer = setTimeout(() => {
          shown = true;
          setState("reconnecting");
        }, 4000);
      } else if (shown) {
        shown = false;
        setState("back");
        hideTimer = setTimeout(() => setState("ok"), 1800);
      } else setState("ok");
    });
    return () => {
      off();
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, []);
  if (state === "ok") return null;
  return (
    <div className={`conn-pill ${state}`} role="status">
      {state === "reconnecting" ? (
        <>
          <span className="conn-spinner" /> Reconnecting… your changes are kept
        </>
      ) : (
        <>
          <Wifi size={14} /> Connected
        </>
      )}
    </div>
  );
}
