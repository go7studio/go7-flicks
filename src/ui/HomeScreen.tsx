import { useEffect, useState } from "react";
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

const STARTS: Tool[] = [
  {
    title: "Video Ranking",
    action: "Start ranking",
    art: "rank",
    studio: "ranking",
  },
  {
    title: "Split",
    action: "Start split",
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
              return (
                <button key={item.path} className="lib-card" type="button" onClick={() => onOpen(item.path)}>
                  <span className="lib-card-copy">
                    <strong>{channelTitle(item)}</strong>
                    {made ? <span className="lib-when">{made}</span> : null}
                    {clipped ? <span className="lib-when">{clipped}</span> : null}
                  </span>
                  <span className="lib-open">Open</span>
                </button>
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
      ? "Quick starts: rank clips or split face and gameplay."
      : mode === "full"
        ? "Full is the same two starts. More tools stay inside a channel."
        : "AI helps on the canvas after you open a flick. Connections holds your keys.";
  return <p className="muted tiny">{line}</p>;
}

function channelTitle(item: RecentChannel): string {
  const name = item.name.trim();
  if (name && !/[\\/]/.test(name)) return name;
  const base = item.path.split(/[/\\]/).filter(Boolean).pop();
  return base || "Channel";
}

function CardArt({ art }: { art: string }) {
  if (art === "rank") {
    return (
      <div className="mini-phone">
        <p className="mini-title">Funniest</p>
        <p className="mini-rank">#5</p>
        <p className="mini-cap">Clip title</p>
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
