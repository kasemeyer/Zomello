import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { logViewCrash } from "../logs";

/**
 * Keeps one broken view from blanking the whole app: shows the error with ways out.
 * `resetKey` changes (e.g. navigating) clear the error automatically.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: unknown; onHome?: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("TCI Boards view crashed:", error, info.componentStack);
    logViewCrash(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <AlertTriangle size={28} />
        <h2>Something went wrong showing this page</h2>
        <p className="muted">Your data is safe, nothing was lost. You can try again or go back home.</p>
        <pre>{String(this.state.error.message || this.state.error)}</pre>
        <div className="row gap">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          {this.props.onHome && (
            <button
              className="btn primary"
              onClick={() => {
                this.setState({ error: null });
                this.props.onHome!();
              }}
            >
              Go to Home
            </button>
          )}
        </div>
      </div>
    );
  }
}
