import { useEffect, useState, type ReactNode } from "react";
import { Download, LogIn, ServerCrash, ShieldCheck } from "lucide-react";
import { getSession, isServer, login, setMe, setup, SIGNED_OUT_EVENT } from "../server";
import { LogoMark } from "./Logo";
import { PhoneBoardsButton } from "./PhoneBoardsButton";
import { saveSignIn } from "../places";

type Gate = "checking" | "in" | "login" | "setup" | "unreachable";

/** TCI Boards server: create the first (admin) account, or sign in, before the app loads. */
export function ServerGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>(isServer ? "checking" : "in");
  const [selfCert, setSelfCert] = useState(false);

  const check = () =>
    getSession()
      .then((s) => {
        setMe(s.user);
        setSelfCert(!!s.selfCert);
        setGate(s.user ? "in" : s.setupNeeded ? "setup" : "login");
      })
      .catch(() => setGate("unreachable"));

  useEffect(() => {
    if (!isServer) return;
    void check();
    // Signed out elsewhere, password changed, account turned off: back to sign-in.
    const out = () => {
      setMe(null);
      setGate("login");
    };
    window.addEventListener(SIGNED_OUT_EVENT, out);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, out);
  }, []);

  if (gate === "in") return <>{children}</>;
  if (gate === "checking")
    return (
      <div className="splash">
        <LogoMark size={72} />
      </div>
    );
  if (gate === "unreachable")
    return (
      <div className="pair-screen">
        <ServerCrash size={36} className="muted" />
        <h2>Can't reach the TCI Boards server</h2>
        <p className="muted">Check your connection, or ask whoever runs the server whether it's up.</p>
        <button className="btn primary" onClick={() => (setGate("checking"), void check())}>
          Try again
        </button>
        <PhoneBoardsButton />
      </div>
    );
  return gate === "setup" ? (
    <SetupForm onDone={() => (saveSignIn(), location.reload())} hint={selfCert && <CertHint />} />
  ) : (
    <LoginForm onDone={() => (saveSignIn(), location.reload())} hint={selfCert && <CertHint />} />
  );
}

/**
 * The server makes its own https certificate: each device installs it once, so the browser trusts the
 * address (and offers to install TCI Boards as an app).
 */
export function CertHint() {
  const https = `https://${location.host}${location.pathname}`;
  return (
    <details className="cert-hint">
      <summary>{location.protocol === "http:" ? "Use a secure connection on this device" : "Setting up another phone or tablet?"}</summary>
      <ol className="small">
        <li>
          <a href="/zomello-ca.crt" download>
            <Download size={13} className="inline-icon" /> Download this server's certificate
          </a>
        </li>
        <li>
          <b>Android:</b> Settings → Security → More security settings → Install from device storage → CA certificate.
          <br />
          <b>iPhone / iPad:</b> open the file, install it in Settings → Profile Downloaded, then turn it on in Settings → General →
          About → Certificate Trust Settings.
          <br />
          <b>Windows / Mac:</b> open the file and add it to the trusted root certificates (Mac: Keychain Access, set to Always Trust).
        </li>
        {location.protocol === "http:" && (
          <li>
            Then open <a href={https}>{https}</a>.
          </li>
        )}
      </ol>
    </details>
  );
}

function LoginForm({ onDone, hint }: { onDone: () => void; hint?: ReactNode }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="pair-screen"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await login(username, password);
          onDone();
        } catch (er) {
          setError(er instanceof Error ? er.message : String(er));
          setBusy(false);
        }
      }}
    >
      <LogoMark size={56} />
      <h2>Sign in to TCI Boards</h2>
      <label>
        Username
        <input autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="pair-error">{error}</p>}
      <button className="btn primary" disabled={busy || !username.trim() || !password}>
        <LogIn size={16} /> {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="muted small">No account yet, or forgot your password? Ask whoever runs this TCI Boards server.</p>
      {hint}
      <PhoneBoardsButton />
    </form>
  );
}

function SetupForm({ onDone, hint }: { onDone: () => void; hint?: ReactNode }) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mismatch = again.length > 0 && again !== password;
  return (
    <form
      className="pair-screen"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== again) return setError("The two passwords don't match.");
        setBusy(true);
        setError("");
        try {
          await setup(username, name, password);
          onDone();
        } catch (er) {
          setError(er instanceof Error ? er.message : String(er));
          setBusy(false);
        }
      }}
    >
      <LogoMark size={56} />
      <h2>Set up your TCI Boards server</h2>
      <p className="muted">Create the first account. It's the admin: it can add people and manage every board.</p>
      <label>
        Your name
        <input autoFocus placeholder="How others see you" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Username
        <input autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="for signing in, e.g. sam" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" autoComplete="new-password" placeholder="at least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Password again
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {(error || mismatch) && <p className="pair-error">{error || "The two passwords don't match yet."}</p>}
      <button className="btn primary" disabled={busy || !username.trim() || password.length < 8 || mismatch}>
        <ShieldCheck size={16} /> {busy ? "Setting up…" : "Create admin account"}
      </button>
      {hint}
    </form>
  );
}
