import type { ReactNode } from "react";
import "./polish-nav.css";

export type StartNav = "home" | "library" | "connections";

export function StartShell({
  nav,
  onHome,
  onLibrary,
  onConnections,
  children,
}: {
  nav: StartNav;
  onHome: () => void;
  onLibrary: () => void;
  onConnections: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell start-shell">
      <aside className="side">
        <div className="side-brand">
          <span className="mark">G7</span>
          <strong>Go7Flicks</strong>
        </div>
        <nav className="side-nav" aria-label="Start">
          <button type="button" className={nav === "home" ? "on" : ""} aria-current={nav === "home" ? "page" : undefined} onClick={onHome}>
            <HomeIcon />
            Home
          </button>
          <button type="button" className={nav === "library" ? "on" : ""} aria-current={nav === "library" ? "page" : undefined} onClick={onLibrary}>
            <LibraryIcon />
            Library
          </button>
          <button
            type="button"
            className={nav === "connections" ? "on" : ""}
            aria-current={nav === "connections" ? "page" : undefined}
            onClick={onConnections}
          >
            <ConnectionsIcon />
            Connections
          </button>
        </nav>
      </aside>
      <section className="dash">{children}</section>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 7h5l2 2h9v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ConnectionsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="7" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 12h4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
