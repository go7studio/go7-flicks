import { useEffect, useState } from "react";
import type { RecentChannel } from "../shared/model";

type Mode = "quick" | "full" | "ai";
type Nav = "home" | "library";

type Tool = {
  title: string;
  copy: string;
  action: string;
  mode: Mode;
  art: string;
  templateId?: string;
  flickName?: string;
  connections?: boolean;
  note?: string;
  studio?: "ranking" | "split";
};

const CARDS: Tool[] = [
  {
    title: "Video Ranking",
    copy: "Rank your videos to find the best performers.",
    action: "Start Ranking",
    mode: "quick",
    art: "rank",
    studio: "ranking",
  },
  {
    title: "Split Screen",
    copy: "Face or UGC on one half, gameplay on the other. Drag the seam.",
    action: "Open Split Screen",
    mode: "quick",
    art: "split",
    studio: "split",
  },
  {
    title: "Simple Editor",
    copy: "One frame, a magnetic timeline, and the cuts you make by hand.",
    action: "Open Editor",
    mode: "full",
    art: "edit",
    templateId: "builtin-blank",
    flickName: "Edit",
  },
  {
    title: "Generate AI Voiceover",
    copy: "Use the ElevenLabs or MiniMax key already on this computer.",
    action: "Create Voiceover",
    mode: "ai",
    art: "voice",
    connections: true,
  },
];

const LATER: Tool[] = [
  {
    title: "Auto Clipping",
    copy: "Drop a long clip on the canvas and cut the moments you want to keep.",
    action: "Clip It Now",
    mode: "quick",
    art: "clip",
    note: "The in-and-out scan is not in this build. Rank a clip that is already on this computer.",
  },
  {
    title: "Video Commentary",
    copy: "Convert a script into a split screen with a line and a voice.",
    action: "Create Video Commentary",
    mode: "quick",
    art: "talk",
    studio: "split",
  },
  {
    title: "Text Story",
    copy: "Start from a blank frame and write the line over the picture.",
    action: "Create Text Story",
    mode: "quick",
    art: "story",
    note: "A text-story desk is not in this build. Write the line on the canvas.",
  },
  {
    title: "Video Transcriber",
    copy: "Word-by-word captions are not in this build yet.",
    action: "Coming later",
    mode: "full",
    art: "script",
    note: "Captions stay out of this build. Write the line in the editor instead.",
  },
  {
    title: "Generate Image",
    copy: "Still-image generation is not in this build yet.",
    action: "Coming later",
    mode: "ai",
    art: "image",
    note: "Bring your own clips. This build edits the footage on this computer.",
  },
];

export function HomeScreen({
  onOpen,
  onOpenFlick,
  onRanking,
  onSplit,
  onConnections,
}: {
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
  const [mode, setMode] = useState<Mode>("quick");
  const [nav, setNav] = useState<Nav>("home");

  useEffect(() => {
    void window.flicks?.recent().then(setRecent);
  }, []);

  async function ensureChannel(): Promise<string | null> {
    const existing = recent[0]?.path;
    if (existing) return existing;
    const parent = await window.flicks!.pickDirectory();
    if (!parent) return null;
    const result = await window.flicks!.createChannel(parent, name.trim() || "My channel");
    if (!result.ok || !result.dir) {
      setMessage(result.message ?? "Could not create that channel.");
      return null;
    }
    return result.dir;
  }

  async function start(tool: Tool) {
    if (tool.studio === "ranking") {
      onRanking();
      return;
    }
    if (tool.studio === "split") {
      onSplit();
      return;
    }
    if (tool.connections) {
      onConnections();
      return;
    }
    if (tool.note) {
      setMessage(tool.note);
      return;
    }
    if (!tool.templateId || !tool.flickName) return;
    setBusy(true);
    setMessage("");
    try {
      const dir = await ensureChannel();
      if (!dir) return;
      const flick = await window.flicks!.createFlick(dir, tool.flickName, tool.templateId);
      if (!flick.ok || !flick.flick) {
        setMessage(flick.message ?? "Could not open that canvas.");
        return;
      }
      onOpenFlick(dir, flick.flick.id);
    } finally {
      setBusy(false);
    }
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

  const visible = CARDS.filter((tool) => tool.mode === mode);

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <span className="mark">G7</span>
          <strong>Go7Flicks</strong>
        </div>
        <nav className="side-nav">
          <button className={nav === "home" ? "on" : ""} onClick={() => setNav("home")}>
            <HomeIcon />
            Home
          </button>
          <button className={nav === "library" ? "on" : ""} onClick={() => setNav("library")}>
            <LibraryIcon />
            Library
          </button>
          <button onClick={onConnections}>
            <ConnectionsIcon />
            Connections
          </button>
        </nav>
        <div className="side-later">
          <p className="side-label">Later</p>
          <nav className="side-tools">
            {LATER.map((tool) => (
              <button key={tool.title} disabled={busy} onClick={() => void start(tool)}>
                {tool.title}
              </button>
            ))}
          </nav>
        </div>
      </aside>
      <section className="dash">
        {message ? <p className="banner">{message}</p> : null}
        {nav === "library" ? (
          <div className="library">
            <h1>Library</h1>
            <div className="library-create">
              <input
                className="field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Channel name"
              />
              <button className="btn-primary" disabled={busy} onClick={() => void createChannel()}>
                New channel
              </button>
              <button className="btn" onClick={() => void openChannel()}>
                Open folder
              </button>
            </div>
            <div className="cards">
              {recent.map((item) => (
                <button key={item.path} className="card" onClick={() => onOpen(item.path)}>
                  <strong>{item.name}</strong>
                  <span className="muted tiny">{item.path}</span>
                </button>
              ))}
              {!recent.length ? <p className="muted">No channels on this computer yet.</p> : null}
            </div>
          </div>
        ) : (
          <div className="home-main">
            <h1 className="hello">Hello, what would you like to create today?</h1>
            <div className="modes" role="tablist">
              <button className={mode === "quick" ? "on" : ""} onClick={() => setMode("quick")}>
                Quick Editor
              </button>
              <button className={mode === "full" ? "on" : ""} onClick={() => setMode("full")}>
                Full Editor
              </button>
              <button className={mode === "ai" ? "on" : ""} onClick={() => setMode("ai")}>
                AI Videos
              </button>
            </div>
            <div className={visible.length === 1 ? "tool-grid single" : "tool-grid"}>
              {visible.map((tool) => (
                <article key={tool.title} className="tool-card">
                  <div className={`art art-${tool.art}`} aria-hidden="true">
                    <CardIcon art={tool.art} />
                  </div>
                  <h2>{tool.title}</h2>
                  <p>{tool.copy}</p>
                  <button className={`tool-go go-${tool.art}`} disabled={busy} onClick={() => void start(tool)}>
                    {tool.action}
                  </button>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function CardIcon({ art }: { art: string }) {
  if (art === "rank") return <TrophyIcon />;
  if (art === "split") return <SplitIcon />;
  if (art === "voice") return <VoiceIcon />;
  return <EditIcon />;
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

function TrophyIcon() {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
      <path d="M22 12h20v14a10 10 0 0 1-20 0z" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M22 18H14a8 8 0 0 0 8 10M42 18h8a8 8 0 0 1-8 10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M32 36v6M24 52h16M26 42h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M32 22l1.8 3.6 4 .6-2.9 2.8.7 4L32 31.2 28.4 33l.7-4-2.9-2.8 4-.6z" fill="currentColor" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
      <rect x="16" y="12" width="32" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <rect x="16" y="36" width="32" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
      <rect x="14" y="16" width="36" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M14 46h36M24 52h16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
      <path d="M32 14a8 8 0 0 1 8 8v10a8 8 0 0 1-16 0V22a8 8 0 0 1 8-8z" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M20 32a12 12 0 0 0 24 0M32 44v8M24 52h16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
