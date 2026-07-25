import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render-time errors in a page.
 *
 * Without this, an uncaught throw makes React 18 unmount the entire tree — the
 * user just sees a blank page with no clue what happened, and the only way to
 * find the cause is the browser console. Show the error instead, and keep the
 * rest of the app (nav, client picker) alive so they can navigate away.
 */
interface Props {
  children: ReactNode;
  /** Remount the boundary when this changes (e.g. the route path). */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console for debugging.
    console.error("Page crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="card p-8 text-center">
        <h2 className="text-lg font-bold text-red-600">This page failed to load</h2>
        <p className="mt-2 text-sm text-slate-500">
          Something went wrong while rendering. The details below usually say why.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-100 p-4 text-left text-xs text-red-700 dark:bg-slate-800 dark:text-red-400">
          {error.message}
        </pre>
        <button className="btn mt-4" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
