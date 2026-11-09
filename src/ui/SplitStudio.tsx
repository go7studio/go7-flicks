import { useEffect, useState, type CSSProperties } from "react";
import {
  DUAL_FACE,
  DUAL_GAME,
  applyDualShare,
  builtinTemplates,
  dualTopHeight,
  flickFromTemplate,
  type DualArrangement,
  type DualPreset,
} from "../shared/canvas";
import { uid, type Flick, type Template } from "../shared/model";

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
  const [preset, setPreset] = useState<DualPreset | "custom">("half");
  const [topShare, setTopShare] = useState(0.5);
  const [recipes, setRecipes] = useState<Template[]>([]);
  const [face, setFace] = useState<Side>(empty);
  const [game, setGame] = useState<Side>(empty);
  const [faceHeard, setFaceHeard] = useState(true);
  const [gameHeard, setGameHeard] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.flicks?.templates().then((items) => {
      setRecipes(items.filter((item) => !item.builtin && item.tracks.some((track) => track.id === DUAL_FACE)));
    });
  }, []);

  function choosePreset(next: DualPreset) {
    setPreset(next);
    setTopShare(dualTopHeight(arrangement, next));
  }

  function chooseArrangement(next: DualArrangement) {
    setArrangement(next);
    if (preset !== "custom") setTopShare(dualTopHeight(next, preset));
  }

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
      const regions = applyDualShare(created.flick.regions, arrangement, topShare);
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
              line: game.title || undefined,
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

  async function saveRecipe() {
    const dual = builtinTemplates().find((item) => item.id === "builtin-dual");
    if (!dual) return;
    const base = flickFromTemplate(dual, name.trim() || "Split Screen");
    base.name = name.trim() || "Split Screen";
    base.regions = applyDualShare(base.regions, arrangement, topShare);
    base.tracks = base.tracks.map((track) => {
      if (track.id === DUAL_FACE) return { ...track, muted: !faceHeard };
      if (track.id === DUAL_GAME) return { ...track, muted: !gameHeard };
      return track;
    });
    base.clips = base.clips.map((clip) => {
      if (clip.trackId === DUAL_FACE) return { ...clip, label: face.title || "Face", line: face.title || undefined };
      if (clip.trackId === DUAL_GAME) return { ...clip, label: game.title || "Gameplay", line: game.title || undefined };
      return clip;
    });
    const result = await window.flicks!.saveTemplate(base, base.name);
    setMessage(result.ok ? `Saved “${base.name}”. The videos stay off the template.` : result.message ?? "Could not save that template.");
    if (result.ok) {
      const items = await window.flicks!.templates();
      setRecipes(items.filter((item) => !item.builtin && item.tracks.some((track) => track.id === DUAL_FACE)));
    }
  }

  function loadRecipe(template: Template) {
    const faceRegion = template.regions.find((item) => item.trackId === DUAL_FACE);
    const gameRegion = template.regions.find((item) => item.trackId === DUAL_GAME);
    if (faceRegion && gameRegion) {
      const faceOnTop = faceRegion.y <= gameRegion.y;
      setArrangement(faceOnTop ? "face-top" : "game-top");
      setTopShare(faceOnTop ? faceRegion.height : gameRegion.height);
      setPreset("custom");
    }
    const faceClip = template.clips.find((item) => item.trackId === DUAL_FACE);
    const gameClip = template.clips.find((item) => item.trackId === DUAL_GAME);
    if (faceClip) setFace((side) => ({ ...side, title: faceClip.line || faceClip.label }));
    if (gameClip) setGame((side) => ({ ...side, title: gameClip.line || gameClip.label }));
    setFaceHeard(!(template.tracks.find((item) => item.id === DUAL_FACE)?.muted ?? false));
    setGameHeard(!(template.tracks.find((item) => item.id === DUAL_GAME)?.muted ?? false));
    setName(template.name);
    setMessage(`Loaded “${template.name}”. Add the clips, then open the timeline.`);
  }

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
        <strong>Split Screen</strong>
        <button className="btn-gold" disabled={busy} onClick={() => void openTimeline()}>
          <TimelineIcon />
          Open timeline
        </button>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="studio-body">
        <aside className="rail stack rank-rail">
          <p className="rail-label">Arrangement</p>
          <div className="order-stack">
            {ARRANGEMENTS.map((item) => (
              <button
                key={item.id}
                className={arrangement === item.id ? "choice on" : "choice"}
                onClick={() => chooseArrangement(item.id)}
              >
                <span className="choice-radio" aria-hidden="true" />
                <span className="choice-diagram" style={diagramStyle(item.id, item.id === "face-top" ? "face-top" : "game-top")} />
                {item.label}
              </button>
            ))}
          </div>
          <p className="rail-label">Seam</p>
          <div className="order-stack">
            {PRESETS.map((item) => (
              <button
                key={item.id}
                className={preset === item.id ? "choice on" : "choice"}
                onClick={() => choosePreset(item.id)}
              >
                <span className="choice-radio" aria-hidden="true" />
                <span className="choice-diagram" style={diagramStyle(item.id, arrangement)} />
                {item.label}
              </button>
            ))}
          </div>
          <label className="stack">
            <span className="rail-label">Top size {Math.round(topShare * 100)}%</span>
            <input
              className="seam-slider"
              type="range"
              min={0.2}
              max={0.8}
              step={0.01}
              value={topShare}
              onChange={(event) => {
                setTopShare(Number(event.target.value));
                setPreset("custom");
              }}
            />
          </label>
          <button className="btn" disabled={busy} onClick={() => void saveRecipe()}>
            Save template
          </button>
          {recipes.length ? (
            <div className="order-stack">
              <p className="rail-label">Your templates</p>
              {recipes.map((recipe) => (
                <button key={recipe.id} className="choice" onClick={() => loadRecipe(recipe)}>
                  {recipe.name}
                </button>
              ))}
            </div>
          ) : null}
          <p className="muted">Save keeps this seam, these words, and which side is heard. The videos stay in the channel.</p>
        </aside>
        <div className="stage-wrap">
          <div className="phone">
            <div className="split-preview" style={{ gridTemplateRows: `${topShare}fr ${roundShare(1 - topShare)}fr` }}>
              <SidePreview side={top} label={topLabel} heard={arrangement === "face-top" ? faceHeard : gameHeard} />
              <SidePreview side={bottom} label={bottomLabel} heard={arrangement === "face-top" ? gameHeard : faceHeard} />
            </div>
          </div>
        </div>
        <aside className="inspector stack rank-inspector">
          <label className="stack">
            <span>Name</span>
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="clip-card">
            <span className="clip-badge face" aria-hidden="true">
              <PersonIcon />
            </span>
            <div className="clip-card-main">
              <span>{face.mediaName || "Add face clip"}</span>
              <input
                className="field"
                value={face.title}
                placeholder="Words on the face"
                onChange={(event) => setFace((side) => ({ ...side, title: event.target.value }))}
              />
              <span className="clip-sound">
                <SpeakerIcon />
                <button
                  type="button"
                  className={faceHeard ? "switch on" : "switch"}
                  role="switch"
                  aria-checked={faceHeard}
                  aria-label="Face sound"
                  onClick={() => setFaceHeard((value) => !value)}
                />
              </span>
            </div>
            <button className="plus" disabled={busy} aria-label="Add face clip" onClick={() => void add("face")}>
              +
            </button>
          </div>
          <div className="clip-card">
            <span className="clip-badge game" aria-hidden="true">
              <GameIcon />
            </span>
            <div className="clip-card-main">
              <span>{game.mediaName || "Add gameplay clip"}</span>
              <input
                className="field"
                value={game.title}
                placeholder="Words on the gameplay"
                onChange={(event) => setGame((side) => ({ ...side, title: event.target.value }))}
              />
              <span className="clip-sound">
                <SpeakerIcon />
                <button
                  type="button"
                  className={gameHeard ? "switch on" : "switch"}
                  role="switch"
                  aria-checked={gameHeard}
                  aria-label="Gameplay sound"
                  onClick={() => setGameHeard((value) => !value)}
                />
              </span>
            </div>
            <button className="plus" disabled={busy} aria-label="Add gameplay clip" onClick={() => void add("game")}>
              +
            </button>
          </div>
          <p className="muted tiny">Both clips are heard. Turn a sound off if you only want the other.</p>
        </aside>
      </div>
    </div>
  );
}

function SidePreview({ side, label, heard }: { side: Side; label: string; heard: boolean }) {
  return (
    <div className="split-side">
      {side.previewUrl ? <video src={side.previewUrl} autoPlay playsInline muted={!heard} /> : <span>{label}</span>}
    </div>
  );
}

function roundShare(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function diagramStyle(id: string, arrangement: DualArrangement): CSSProperties {
  const face = "#e7d3c4";
  const game = "#6eae78";
  const faceTop = arrangement === "face-top";
  if (id === "face-top") return { background: `linear-gradient(${face} 50%, ${game} 50%)` };
  if (id === "game-top") return { background: `linear-gradient(${game} 50%, ${face} 50%)` };
  const top = faceTop ? face : game;
  const bottom = faceTop ? game : face;
  const cut = id === "face-larger" ? (faceTop ? 64 : 36) : id === "game-larger" ? (faceTop ? 36 : 64) : 50;
  return { background: `linear-gradient(${top} ${cut}%, ${bottom} ${cut}%)` };
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 19c1.2-3 3.2-4.5 6-4.5S16.8 16 18 19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GameIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="8" width="18" height="10" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 13h3M9.5 11.5v3M16 12.5h.01M18 14.5h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M4 10h3l4-3v10l-4-3H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 9.5a4 4 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
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
