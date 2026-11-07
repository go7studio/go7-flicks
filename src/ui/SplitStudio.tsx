import { useState } from "react";
import {
  DUAL_FACE,
  DUAL_GAME,
  applyDualLayout,
  dualTopHeight,
  type DualArrangement,
  type DualPreset,
} from "../shared/canvas";
import { uid, type Flick } from "../shared/model";

type Side = {
  title: string;
  mediaId: string | null;
  mediaName: string;
  previewUrl: string | null;
  duration: number;
};

const empty = (): Side => ({ title: "", mediaId: null, mediaName: "", previewUrl: null, duration: 0 });

const ARRANGEMENTS: { id: DualArrangement; label: string }[] = [
  { id: "face-top", label: "Face on top" },
  { id: "game-top", label: "Gameplay on top" },
];

const PRESETS: { id: DualPreset; label: string }[] = [
  { id: "half", label: "Half" },
  { id: "face-larger", label: "Face larger" },
  { id: "game-larger", label: "Gameplay larger" },
];

export function SplitStudio({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  onOpen: (dir: string, flickId: string) => void;
}) {
  const [dir, setDir] = useState<string | null>(null);
  const [name, setName] = useState("Dual video");
  const [arrangement, setArrangement] = useState<DualArrangement>("face-top");
  const [preset, setPreset] = useState<DualPreset>("half");
  const [face, setFace] = useState<Side>(empty);
  const [game, setGame] = useState<Side>(empty);
  const [faceHeard, setFaceHeard] = useState(true);
  const [gameHeard, setGameHeard] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function ensureDir(): Promise<string | null> {
    if (dir) return dir;
    const recent = await window.flicks!.recent();
    const existing = recent[0]?.path;
    if (existing) {
      setDir(existing);
      return existing;
    }
    const parent = await window.flicks!.pickDirectory();
    if (!parent) return null;
    const created = await window.flicks!.createChannel(parent, name.trim() || "Dual video");
    if (!created.ok || !created.dir) {
      setMessage(created.message ?? "Could not create the channel.");
      return null;
    }
    setDir(created.dir);
    return created.dir;
  }

  async function add(which: "face" | "game") {
    setBusy(true);
    setMessage("");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const result = await window.flicks!.importMedia(folder, "copy");
      if (!result.ok || !result.asset) {
        setMessage(result.message ?? "No clip chosen.");
        return;
      }
      const resolved = result.media?.find((item) => item.id === result.asset?.id);
      const side: Side = {
        title: result.asset.name.replace(/\.[^.]+$/, "").slice(0, 24),
        mediaId: result.asset.id,
        mediaName: result.asset.name,
        previewUrl: resolved?.previewUrl ?? null,
        duration: result.asset.durationSec || 8,
      };
      if (which === "face") setFace(side);
      else setGame(side);
    } finally {
      setBusy(false);
    }
  }

  async function openTimeline() {
    if (!face.mediaId && !game.mediaId) {
      setMessage("Add the face clip, the gameplay clip, or both.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const created = await window.flicks!.createFlick(folder, name.trim() || "Dual video", "builtin-dual");
      if (!created.ok || !created.flick) {
        setMessage(created.message ?? "Could not open the timeline.");
        return;
      }
      const length = Math.min(12, Math.max(face.duration || 8, game.duration || 0, 3));
      const regions = applyDualLayout(created.flick.regions, arrangement, preset);
      const tracks = created.flick.tracks.map((track) => {
        if (track.id === DUAL_FACE) return { ...track, muted: !faceHeard };
        if (track.id === DUAL_GAME) return { ...track, muted: !gameHeard };
        return track;
      });
      const clips = [
        face.mediaId
          ? {
              id: uid(),
              mediaId: face.mediaId,
              trackId: DUAL_FACE,
              startSec: 0,
              inSec: 0,
              outSec: Math.min(length, face.duration || length),
              label: face.title || "Face",
              line: face.title || undefined,
            }
          : null,
        game.mediaId
          ? {
              id: uid(),
              mediaId: game.mediaId,
              trackId: DUAL_GAME,
              startSec: 0,
              inSec: 0,
              outSec: Math.min(length, game.duration || length),
              label: game.title || "Gameplay",
            }
          : null,
      ].filter((item) => item !== null);
      const flick: Flick = { ...created.flick, name: name.trim() || "Dual video", regions, tracks, clips };
      const saved = await window.flicks!.saveFlick(folder, flick);
      if (!saved.ok || !saved.flick) {
        setMessage(saved.message ?? "Could not save the dual video.");
        return;
      }
      onOpen(folder, saved.flick.id);
    } finally {
      setBusy(false);
    }
  }

  const topShare = dualTopHeight(arrangement, preset);
  const top = arrangement === "face-top" ? face : game;
  const bottom = arrangement === "face-top" ? game : face;
  const topLabel = arrangement === "face-top" ? "Face" : "Gameplay";
  const bottomLabel = arrangement === "face-top" ? "Gameplay" : "Face";

  return (
    <div className="studio ranking">
      <header className="toolbar rank-toolbar">
        <button className="home-back" onClick={onBack}>
          <HomeIcon />
          Home
        </button>
        <strong>Dual video</strong>
        <button className="btn-gold" disabled={busy} onClick={() => void openTimeline()}>
          <TimelineIcon />
          Open timeline
        </button>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="studio-body">
        <aside className="rail stack rank-rail">
          <p className="tiny muted">Arrangement</p>
          <div className="order-stack">
            {ARRANGEMENTS.map((item) => (
              <button
                key={item.id}
                className={arrangement === item.id ? "order-btn on" : "order-btn"}
                onClick={() => setArrangement(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="tiny muted">Seam</p>
          <div className="order-stack">
            {PRESETS.map((item) => (
              <button
                key={item.id}
                className={preset === item.id ? "order-btn on" : "order-btn"}
                onClick={() => setPreset(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="muted">Half is the start. The seam can still move after this opens on the timeline.</p>
        </aside>
        <div className="stage-wrap">
          <div className="phone">
            <div className="split-preview" style={{ gridTemplateRows: `${topShare}fr ${roundShare(1 - topShare)}fr` }}>
              <SidePreview side={top} label={topLabel} />
              <SidePreview side={bottom} label={bottomLabel} />
            </div>
          </div>
        </div>
        <aside className="inspector stack rank-inspector">
          <label className="stack">
            <span>Name</span>
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="add-line">
            <span>{face.mediaName || "Add face clip"}</span>
            <button className="plus" disabled={busy} aria-label="Add face clip" onClick={() => void add("face")}>
              +
            </button>
          </div>
          <div className="add-line">
            <span>{game.mediaName || "Add gameplay clip"}</span>
            <button className="plus" disabled={busy} aria-label="Add gameplay clip" onClick={() => void add("game")}>
              +
            </button>
          </div>
          <div className="toggle-line">
            <span>Face sound</span>
            <button
              type="button"
              className={faceHeard ? "switch on" : "switch"}
              role="switch"
              aria-checked={faceHeard}
              aria-label="Face sound"
              onClick={() => setFaceHeard((value) => !value)}
            />
          </div>
          <div className="toggle-line">
            <span>Gameplay sound</span>
            <button
              type="button"
              className={gameHeard ? "switch on" : "switch"}
              role="switch"
              aria-checked={gameHeard}
              aria-label="Gameplay sound"
              onClick={() => setGameHeard((value) => !value)}
            />
          </div>
          <p className="muted tiny">
            Both clips are heard. Turn a sound off if you only want the other. The files are already on this computer.
          </p>
        </aside>
      </div>
    </div>
  );
}

function SidePreview({ side, label }: { side: Side; label: string }) {
  return (
    <div className="split-side">
      {side.previewUrl ? <video src={side.previewUrl} muted playsInline /> : <span>{label}</span>}
    </div>
  );
}

function roundShare(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.2" y="2.2" width="9" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5.2" y="6.2" width="9" height="7" rx="1.4" fill="#e8b423" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
