import { useEffect, useState } from "react";
import type { FlicksApi } from "../shared/api";
import type { RecentChannel } from "../shared/model";
import { whenPhrase } from "../shared/when";
import { StartShell } from "./StartShell";
import "./polish-nav.css";

type Nav = "home" | "library";

type StartMode = "quick" | "full" | "ai";

type Tool = {
  title: string;
  action: string;
  art: string;
  studio: "ranking" | "split";
};

type ForgetRecentResult = { ok?: boolean; message?: string };

type HomeLibraryApi = FlicksApi & {
  forgetRecent: (dir: string) => Promise<ForgetRecentResult | void>;
};

export function recentRowsAfterForget<T extends { path: string }>(
  rows: readonly T[],
  dir: string,
  result: { ok?: boolean } | null | undefined,
): T[] {
  if (result?.ok === true) return rows.filter((item) => item.path !== dir);
  return [...rows];
}

const STARTS: Tool[] = [
  {
    title: "Video Ranking",
    action: "Start ranking",
    art: "rank",
    studio: "ranking",
  },
  {
    title: "Dual video",
    action: "Start dual",
    art: "split",
    studio: "split",
  },
];

export function HomeScreen({
  openOn = "home",
  onOpen,
  onOpenFlick,
  onRanking,
  onSplit,
  onConnections,
}: {
  openOn?: Nav;
  onOpen: (dir: string) => void;
  onOpenFlick: (dir: string, flickId: string) => void;
  onRanking: () => void;
  onSplit: () => void;
  onConnections: () => void;
}) {
  const [name, setName] = useState("");
  const [recent, setRecent] = useState<RecentChannel[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [nav, setNav] = useState<Nav>(openOn);
  const [mode, setMode] = useState<StartMode>("quick");
  const [staging, setStaging] = useState("");
  const [confirmClean, setConfirmClean] = useState(false);

  useEffect(() => {
    setNav(openOn);
  }, [openOn]);

  useEffect(() => {
    void window.flicks?.recent().then(setRecent);
    void window.flicks?.staging().then((result) => setStaging(result.stagingDir));
  }, []);

  useEffect(() => {
    if (!confirmClean) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmClean(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmClean]);

  async function changeStaging() {
    const result = await window.flicks!.chooseStaging();
    if (result.stagingDir) setStaging(result.stagingDir);
    if (result.message && result.message !== "No folder chosen.") setMessage(result.message);
  }

  async function cleanUnused() {
    setBusy(true);
    setMessage("");
    try {
      const result = await window.flicks!.cleanUnused();
      setMessage(result.message);
    } finally {
      setBusy(false);
      setConfirmClean(false);
    }
  }

  function start(tool: Tool) {
    if (tool.studio === "ranking") onRanking();
    else onSplit();
  }

  async function createChannel() {
    setBusy(true);
    setMessage("");
    try {
      const parent = await window.flicks!.pickDirectory();
      if (!parent) return;
      const result = await window.flicks!.createChannel(parent, name.trim() || "My channel");
      if (!result.ok || !result.dir) {
        setMessage(result.message ?? "Could not create that channel.");
        return;
      }
      onOpen(result.dir);
    } finally {
      setBusy(false);
    }
  }

  async function forget(dir: string) {
    try {
      const result = await (window.flicks as HomeLibraryApi).forgetRecent(dir);
      if (result?.ok !== true) setMessage(result?.message || "Could not hide that channel.");
      setRecent((items) => recentRowsAfterForget(items, dir, result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not hide that channel.");
    }
  }

  async function openChannel() {
    const dir = await window.flicks!.pickDirectory();
    if (!dir) return;
    const result = await window.flicks!.openChannel(dir);
    if (!result.ok || !result.dir) {
      setMessage(result.message ?? "Could not open that folder.");
      return;
    }
    onOpen(result.dir);
  }

  return (
    <StartShell nav={nav} onHome={() => setNav("home")} onLibrary={() => setNav("library")} onConnections={onConnections}>
      {message ? <p className="banner start-note">{message}</p> : null}
      {nav === "library" ? (
        <div className="lib-page">
          <div className="lib-head">
            <h1>Library</h1>
            <div className="lib-create">
              <input
                className="field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Channel name"
                aria-label="Channel name"
              />
              <button className="btn-primary" type="button" disabled={busy} onClick={() => void createChannel()}>
                New channel
              </button>
              <button className="btn-ghost" type="button" onClick={() => void openChannel()}>
                Open folder
              </button>
            </div>
          </div>
          <div className="lib-cards">
            {recent.map((item) => {
              const clipped = item.clippedAt ? whenPhrase("Clipped", item.clippedAt) : null;
              const made = item.madeAt ? whenPhrase("Made", item.madeAt) : null;
              const when = [made, clipped].filter(Boolean).join(" · ");
              const title = channelTitle(item);
              return (
                <article key={item.path} className="lib-card">
                  <button type="button" className="lib-card-open" onClick={() => onOpen(item.path)}>
                    <strong className="lib-name">{title}</strong>
                    <span className="lib-when" title={when || undefined}>
                      {when || "\u00a0"}
                    </span>
                    <span className="lib-open">Open</span>
                  </button>
                  <button
                    type="button"
                    className="lib-hide"
                    aria-label={`Hide ${title}`}
                    title="Takes this channel off the list. The folder stays."
                    onClick={() => void forget(item.path)}
                  >
                    Hide
                  </button>
                </article>
              );
            })}
          </div>
          {!recent.length ? <p className="muted lib-empty">No channels yet.</p> : null}
          <section className="lib-copies">
            <div>
              <h2>Working copies</h2>
              <p className="lib-path">{staging || "This computer"}</p>
            </div>
            <div className="lib-copy-actions">
              <button className="btn" type="button" onClick={() => void changeStaging()}>
                Change folder
              </button>
              <button className="start-danger" type="button" disabled={busy} onClick={() => setConfirmClean(true)}>
                Clean unused
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="start-home">
          <h1 className="start-hello">Hello, what would you like to create today?</h1>
          <div className="row start-modes" role="group" aria-label="Start mode">
            {(["quick", "full", "ai"] as const).map((pill) => (
              <button
                key={pill}
                type="button"
                className={mode === pill ? "btn-primary" : "btn"}
                aria-pressed={mode === pill}
                onClick={() => setMode(pill)}
              >
                {pill === "quick" ? "Quick" : pill === "full" ? "Full" : "AI"}
              </button>
            ))}
          </div>
          <ModeHint mode={mode} />
          {mode === "full" ? (
            <button className="btn start-mode-go" type="button" onClick={() => setNav("library")}>
              Open a channel
            </button>
          ) : null}
          {mode === "ai" ? (
            <button className="btn start-mode-go" type="button" onClick={onConnections}>
              Open connections
            </button>
          ) : null}
          <div className="start-pair">
            {STARTS.map((tool) => (
              <button key={tool.title} className="start-primary" type="button" disabled={busy} onClick={() => start(tool)}>
                <span className={`art art-${tool.art}`} aria-hidden="true">
                  <CardArt art={tool.art} />
                </span>
                <strong>{tool.title}</strong>
                <span className="start-cta">{tool.action}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {confirmClean ? (
        <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="clean-title">
          <div className="modal panel stack">
            <h2 id="clean-title">Clean unused?</h2>
            <div className="clean-cols">
              <div className="clean-drops">
                <p>Deletes</p>
                <ul>
                  <li>Unused working copies</li>
                  <li>Unfinished exports</li>
                  <li>Numbered extras</li>
                </ul>
              </div>
              <div className="clean-keeps">
                <p>Does not delete</p>
                <ul>
                  <li>A named export</li>
                  <li>A clip on a timeline</li>
                  <li>A folder on a network drive</li>
                </ul>
              </div>
            </div>
            <div className="actions">
              <button className="btn" type="button" onClick={() => setConfirmClean(false)} autoFocus>
                Cancel
              </button>
              <button className="start-danger start-danger-fill" type="button" disabled={busy} onClick={() => void cleanUnused()}>
                Clean unused
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </StartShell>
  );
}

function ModeHint({ mode }: { mode: StartMode }) {
  const line =
    mode === "quick"
      ? "Quick starts: rank clips, or face and gameplay."
      : mode === "full"
        ? "Open a channel for the timeline and the other tools."
        : "Open connections for the keys. AI helps on the canvas after you open a flick.";
  return <p className="muted tiny">{line}</p>;
}

const SKIP_DIRS = new Set([
  "users",
  "appdata",
  "local",
  "roaming",
  "temp",
  "tmp",
  "github",
  "windows",
  "desktop",
  "documents",
  "program files",
  "program files (x86)",
  "application data",
]);

/** Card label only. A long id stays out of the title; the folder name on disk is left as it is. */
export function channelTitle(item: Pick<RecentChannel, "name" | "path"> & Partial<Pick<RecentChannel, "madeAt" | "clippedAt">>): string {
  const stored = item.name.trim();
  const leaf = item.path.split(/[/\\]/).filter(Boolean).pop()?.trim() ?? "";
  const raw = stored && !/[\\/]/.test(stored) ? stored : leaf;
  const words = readableWords(raw);
  if (words) return words;
  const fromFolder = folderPhrase(item.path);
  if (fromFolder) return fromFolder;
  return channelFallback(item);
}

function readableWords(value: string): string {
  const stripped = value.replace(/\d{8,}/g, " ").replace(/\s+/g, " ").trim();
  const parts = stripped.split(" ").filter((part) => part && !/^\d{5,}$/.test(part));
  if (!parts.length) return "";
  if (!parts.some((part) => /[A-Za-z]/.test(part))) {
    const digits = parts.join("");
    return digits.length >= 5 ? "" : parts.join(" ");
  }
  return parts.join(" ");
}

function folderPhrase(filePath: string): string {
  const segments = filePath.split(/[/\\]/).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i].trim();
    if (/^[a-z]:$/i.test(segment)) continue;
    if (SKIP_DIRS.has(segment.toLowerCase())) return "";
    if (!/\s/.test(segment) && /[a-z]/i.test(segment) && /\d/.test(segment) && segment.length > 16) continue;
    const words = readableWords(segment);
    if (words) return words;
  }
  return "";
}

function channelFallback(item: { madeAt?: string; clippedAt?: string }): string {
  const phrase = item.madeAt ? whenPhrase("Made", item.madeAt) : item.clippedAt ? whenPhrase("Clipped", item.clippedAt) : null;
  if (!phrase) return "Channel";
  return `Channel ${phrase.replace(/^(Made|Clipped) /, "")}`;
}

function CardArt({ art }: { art: string }) {
  if (art === "rank") {
    return (
      <div className="mini-phone">
        <p className="mini-title">Funniest</p>
        <p className="mini-rank">#5</p>
        <p className="mini-cap">Caption</p>
      </div>
    );
  }
  return (
    <div className="mini-phone mini-split">
      <span>Face</span>
      <span>Gameplay</span>
    </div>
  );
}
