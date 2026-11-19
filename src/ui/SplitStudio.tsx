import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  DUAL_FACE,
  DUAL_GAME,
  applyDualLayout,
  applyDualShare,
  builtinTemplates,
  dualTopHeight,
  flickFromTemplate,
  spokenLine,
  type DualArrangement,
  type DualPreset,
} from "../shared/canvas";
import { round3, uid, type Clip, type Flick, type Template } from "../shared/model";
import type { ResolvedMedia } from "../shared/api";
import { captionFromFile, openDeskFlick, splitTrackPair, titleFromClip } from "../remotion/FlickComposition";
import "./polish-desks.css";

type Side = {
  title: string;
  link: string;
  mediaId: string | null;
  mediaName: string;
  previewUrl: string | null;
  duration: number;
  inSec: number;
  outSec: number;
};

const empty = (): Side => ({ title: "", link: "", mediaId: null, mediaName: "", previewUrl: null, duration: 0, inSec: 0, outSec: 3 });

const ARRANGEMENTS: { id: DualArrangement; label: string }[] = [
  { id: "face-top", label: "Face on top" },
  { id: "game-top", label: "Gameplay on top" },
];

const PRESETS: { id: DualPreset; label: string }[] = [
  { id: "half", label: "Half" },
  { id: "face-larger", label: "Face larger" },
  { id: "game-larger", label: "Gameplay larger" },
];

function matchPreset(arrangement: DualArrangement, share: number): DualPreset | "custom" {
  const found = PRESETS.find((item) => Math.abs(dualTopHeight(arrangement, item.id) - share) < 0.015);
  return found?.id ?? "custom";
}

function heardLine(faceOn: boolean, gameOn: boolean): string {
  if (faceOn && gameOn) return "Both clips are heard. Turn a sound off if you only want the other.";
  if (faceOn) return "The face is heard. The gameplay is silent.";
  if (gameOn) return "The gameplay is heard. The face is silent.";
  return "Both clips are silent. Turn a sound on to hear that side.";
}

function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

function deskStorageKey(channelDir?: string): string {
  return `go7-flicks-desk:${channelDir || "none"}:split`;
}

function clampOut(next: number, inSec: number, duration: number): number {
  const cap = duration > 0 ? duration : Math.max(next, inSec + 3);
  return round3(Math.max(inSec + 0.1, Math.min(Math.max(0, next), cap)));
}

function clampIn(next: number, outSec: number, duration: number): number {
  const end = duration > 0 ? Math.min(outSec, duration) : outSec;
  return round3(Math.min(Math.max(0, next), Math.max(0, end - 0.1)));
}

/** Trimmed length of one side. Unknown duration floors at about 3 seconds. No 12 second cap. */
export function sideWindow(side: Pick<Side, "inSec" | "outSec" | "duration">): { inSec: number; outSec: number } {
  const inSec = round3(Math.max(0, side.inSec));
  if (side.duration > 0) {
    const cappedIn = round3(Math.min(inSec, Math.max(0, side.duration - 0.1)));
    const outSec = round3(Math.min(side.duration, Math.max(side.outSec, cappedIn + 0.1)));
    return { inSec: cappedIn, outSec };
  }
  const span = side.outSec - inSec;
  return { inSec, outSec: round3(inSec + (span >= 3 ? span : 3)) };
}

function clipFromSide(side: Side, trackId: string, fallback: string) {
  if (!side.mediaId) return null;
  const window = sideWindow(side);
  return {
    id: uid(),
    mediaId: side.mediaId,
    trackId,
    startSec: 0,
    inSec: window.inSec,
    outSec: window.outSec,
    label: side.title || fallback,
    line: side.title.trim() ? side.title : undefined,
    sourceUrl: side.link.trim() || undefined,
  };
}

function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalCs = Math.round(safe * 100);
  const cs = totalCs % 100;
  const totalSecs = Math.floor(totalCs / 100);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function parseClock(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+):(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (match) {
    const mins = Number(match[1]);
    const secs = Number(match[2]);
    const frac = match[3] ? Number(match[3].padEnd(2, "0")) / 100 : 0;
    return mins * 60 + secs + frac;
  }
  const plain = Number(trimmed);
  return Number.isFinite(plain) ? plain : null;
}

type SplitDraft = {
  name?: string;
  arrangement?: DualArrangement;
  preset?: DualPreset | "custom";
  topShare?: number;
  face?: Partial<Side>;
  game?: Partial<Side>;
  faceHeard?: boolean;
  gameHeard?: boolean;
  dir?: string | null;
};

function readSplitDraft(channelDir?: string): SplitDraft | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(deskStorageKey(channelDir));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SplitDraft;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeSide(value: Partial<Side> | undefined): Side | null {
  if (!value || typeof value !== "object") return null;
  const duration = typeof value.duration === "number" && value.duration > 0 ? value.duration : 0;
  const inSec = typeof value.inSec === "number" ? value.inSec : 0;
  const outSec = typeof value.outSec === "number" ? value.outSec : duration > 0 ? duration : 3;
  return {
    title: typeof value.title === "string" ? value.title : "",
    link: typeof value.link === "string" ? value.link : "",
    mediaId: typeof value.mediaId === "string" ? value.mediaId : null,
    mediaName: typeof value.mediaName === "string" ? value.mediaName : "",
    previewUrl: typeof value.previewUrl === "string" ? value.previewUrl : null,
    duration,
    inSec,
    outSec,
  };
}

function sideFromClip(clip: Clip | undefined, media: ResolvedMedia[]): Side | null {
  if (!clip || (!clip.mediaId && !clip.line)) return null;
  const asset = clip.mediaId ? media.find((item) => item.id === clip.mediaId) : undefined;
  const duration = asset && asset.durationSec > 0 ? asset.durationSec : 0;
  const inSec = clip.inSec;
  const outSec = clip.outSec > clip.inSec ? clip.outSec : duration > 0 ? duration : inSec + 3;
  return {
    title: titleFromClip(clip),
    link: clip.sourceUrl ?? "",
    mediaId: clip.mediaId,
    mediaName: asset?.name ?? "",
    previewUrl: asset?.previewUrl ?? null,
    duration,
    inSec,
    outSec,
  };
}

export function SplitStudio({
  onBack,
  onOpen,
  channelDir,
  flickId,
}: {
  onBack: () => void;
  onOpen: (dir: string, flickId: string) => void;
  channelDir?: string;
  flickId?: string;
}) {
  const [dir, setDir] = useState<string | null>(channelDir ?? null);
  const [announced, setAnnounced] = useState(() => (channelDir ? folderName(channelDir) : ""));
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
  const [playing, setPlaying] = useState(false);
  const faceVideo = useRef<HTMLVideoElement>(null);
  const gameVideo = useRef<HTMLVideoElement>(null);
  const keepDraft = useRef(true);
  const draftKey = deskStorageKey(channelDir);
  const [boundKey, setBoundKey] = useState<string | null>(null);
  const folderLabel = announced || (dir ? folderName(dir) : "");

  useEffect(() => {
    void window.flicks?.templates().then((items) => {
      setRecipes(items.filter((item) => !item.builtin && item.tracks.some((track) => track.id === DUAL_FACE)));
    });
  }, []);

  useEffect(() => {
    if (channelDir) {
      setDir(channelDir);
      setAnnounced(folderName(channelDir));
      return;
    }
    let cancel = false;
    void window.flicks?.recent().then((rows) => {
      if (cancel) return;
      const first = rows[0];
      if (first?.path) {
        setDir((current) => current ?? first.path);
        setAnnounced((current) => current || first.name || folderName(first.path));
        return;
      }
      setAnnounced((current) => current || "Dual video");
    });
    return () => {
      cancel = true;
    };
  }, [channelDir]);

  useEffect(() => {
    let cancel = false;
    keepDraft.current = true;
    if (flickId && channelDir && window.flicks) {
      void window.flicks.readFlick(channelDir, flickId).then((result) => {
        if (cancel) return;
        if (result.ok && result.flick) {
          const flick = result.flick;
          setName(flick.name || "Dual video");
          const pair = splitTrackPair(flick);
          const faceRegion = flick.regions.find((item) => item.trackId === pair.face);
          const gameRegion = flick.regions.find((item) => item.trackId === pair.game);
          if (faceRegion && gameRegion) {
            const faceOnTop = faceRegion.y <= gameRegion.y;
            const nextArrangement = faceOnTop ? "face-top" : "game-top";
            const share = faceOnTop ? faceRegion.height : gameRegion.height;
            setArrangement(nextArrangement);
            setTopShare(share);
            setPreset(matchPreset(nextArrangement, share));
          }
          const nextFace = sideFromClip(flick.clips.find((item) => item.trackId === pair.face), result.media ?? []);
          const nextGame = sideFromClip(flick.clips.find((item) => item.trackId === pair.game), result.media ?? []);
          if (nextFace) setFace(nextFace);
          if (nextGame) setGame(nextGame);
          setFaceHeard(!(flick.tracks.find((item) => item.id === pair.face)?.muted ?? false));
          setGameHeard(!(flick.tracks.find((item) => item.id === pair.game)?.muted ?? false));
          setDir(channelDir);
        } else if (result.message) {
          setMessage(result.message);
        }
        if (!cancel) setBoundKey(draftKey);
      });
      return () => {
        cancel = true;
      };
    }
    const stored = readSplitDraft(channelDir);
    if (stored) {
      if (typeof stored.name === "string") setName(stored.name);
      if (stored.arrangement === "face-top" || stored.arrangement === "game-top") setArrangement(stored.arrangement);
      if (stored.preset === "half" || stored.preset === "face-larger" || stored.preset === "game-larger" || stored.preset === "custom") {
        setPreset(stored.preset);
      }
      if (typeof stored.topShare === "number") setTopShare(stored.topShare);
      const nextFace = normalizeSide(stored.face);
      const nextGame = normalizeSide(stored.game);
      if (nextFace) setFace(nextFace);
      if (nextGame) setGame(nextGame);
      if (typeof stored.faceHeard === "boolean") setFaceHeard(stored.faceHeard);
      if (typeof stored.gameHeard === "boolean") setGameHeard(stored.gameHeard);
      if (!channelDir && stored.dir) {
        setDir(stored.dir);
        setAnnounced(folderName(stored.dir));
      }
    }
    setBoundKey(draftKey);
    return () => {
      cancel = true;
    };
  }, [channelDir, draftKey, flickId]);

  useEffect(() => {
    if (boundKey !== draftKey || !keepDraft.current) return;
    try {
      if (typeof sessionStorage === "undefined") return;
      const payload: SplitDraft = {
        name,
        arrangement,
        preset,
        topShare,
        face,
        game,
        faceHeard,
        gameHeard,
        dir: channelDir || dir,
      };
      sessionStorage.setItem(draftKey, JSON.stringify(payload));
    } catch {
      // The desk still works when the browser refuses the draft.
    }
  }, [boundKey, draftKey, channelDir, dir, name, arrangement, preset, topShare, face, game, faceHeard, gameHeard]);

  function choosePreset(next: DualPreset) {
    setPreset(next);
    setTopShare(dualTopHeight(arrangement, next));
  }

  function chooseArrangement(next: DualArrangement) {
    setArrangement(next);
    if (preset !== "custom") setTopShare(dualTopHeight(next, preset));
  }

  async function ensureDir(): Promise<string | null> {
    if (channelDir) {
      setDir(channelDir);
      setAnnounced(folderName(channelDir));
      return channelDir;
    }
    if (dir) {
      setAnnounced(folderName(dir));
      return dir;
    }
    const recent = await window.flicks!.recent();
    const existing = recent[0];
    if (existing?.path) {
      setDir(existing.path);
      setAnnounced(existing.name || folderName(existing.path));
      return existing.path;
    }
    setAnnounced(name.trim() || "Dual video");
    const parent = await window.flicks!.pickDirectory();
    if (!parent) return null;
    const created = await window.flicks!.createChannel(parent, name.trim() || "Dual video");
    if (!created.ok || !created.dir) {
      setMessage(created.message ?? "Could not create the channel.");
      return null;
    }
    setDir(created.dir);
    setAnnounced(folderName(created.dir));
    return created.dir;
  }

  function liveVideos(): { video: HTMLVideoElement; side: Side }[] {
    const pairs = [
      { video: faceVideo.current, side: face },
      { video: gameVideo.current, side: game },
    ];
    return pairs.filter((item): item is { video: HTMLVideoElement; side: Side } => Boolean(item.video));
  }

  function syncPlaying() {
    const nodes = liveVideos();
    setPlaying(nodes.some((item) => !item.video.paused));
  }

  function guardSide(which: "face" | "game") {
    const video = which === "face" ? faceVideo.current : gameVideo.current;
    const side = which === "face" ? face : game;
    if (!video || video.paused) return;
    const end = sideWindow(side).outSec;
    if (video.currentTime >= end - 0.03) video.pause();
  }

  function togglePlay() {
    const pairs = liveVideos();
    if (!pairs.length) {
      setMessage("Add a clip to play.");
      return;
    }
    if (playing) {
      pairs.forEach((item) => item.video.pause());
      setPlaying(false);
      return;
    }
    pairs.forEach((item) => {
      const window = sideWindow(item.side);
      if (item.video.currentTime < window.inSec - 0.05 || item.video.currentTime >= window.outSec - 0.05) {
        item.video.currentTime = window.inSec;
      }
    });
    void Promise.all(pairs.map((item) => item.video.play()))
      .then(() => setPlaying(true))
      .catch(() => {
        pairs.forEach((item) => item.video.pause());
        setPlaying(false);
      });
  }

  async function getSide(which: "face" | "game") {
    const side = which === "face" ? face : game;
    if (!side.link.trim()) {
      setMessage("Paste a link.");
      return;
    }
    setBusy(true);
    setMessage("Getting the clip…");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const result = await window.flicks!.downloadMedia(folder, side.link);
      if (!result.ok || !result.asset) {
        setMessage(result.message ?? "Could not get that clip.");
        return;
      }
      const resolved = result.media?.find((item) => item.id === result.asset?.id);
      const duration = result.asset.durationSec > 0 ? result.asset.durationSec : 0;
      const next: Side = {
        ...side,
        link: result.sourceUrl || side.link,
        title: captionFromFile(side.title, result.asset.name),
        mediaId: result.asset.id,
        mediaName: result.asset.name,
        previewUrl: resolved?.previewUrl ?? null,
        duration,
        inSec: 0,
        outSec: duration > 0 ? duration : 3,
      };
      if (which === "face") setFace(next);
      else setGame(next);
      setMessage(result.workingCopy ? "Working copy is on this computer." : result.asset.name);
    } finally {
      setBusy(false);
    }
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
      const previous = which === "face" ? face : game;
      const duration = result.asset.durationSec > 0 ? result.asset.durationSec : 0;
      const side: Side = {
        title: captionFromFile(previous.title, result.asset.name),
        link: previous.link,
        mediaId: result.asset.id,
        mediaName: result.asset.name,
        previewUrl: resolved?.previewUrl ?? null,
        duration,
        inSec: 0,
        outSec: duration > 0 ? duration : 3,
      };
      if (which === "face") setFace(side);
      else setGame(side);
      if (result.workingCopy) setMessage("Working copy is on this computer.");
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
      let existing: Flick | null = null;
      if (flickId) {
        const loaded = await window.flicks!.readFlick(folder, flickId);
        if (!loaded.ok || !loaded.flick) {
          setMessage(loaded.message ?? "Could not open the timeline.");
          return;
        }
        existing = loaded.flick;
      }
      let shell = existing;
      if (!shell) {
        const created = await window.flicks!.createFlick(folder, name.trim() || "Dual video", "builtin-dual");
        if (!created.ok || !created.flick) {
          setMessage(created.message ?? "Could not open the timeline.");
          return;
        }
        shell = created.flick;
      }
      const pair = splitTrackPair(shell);
      const regions =
        preset === "custom"
          ? applyDualShare(shell.regions, arrangement, topShare, pair)
          : applyDualLayout(shell.regions, arrangement, preset, pair);
      const tracks = shell.tracks.map((track) => {
        if (track.id === pair.face) return { ...track, muted: !faceHeard };
        if (track.id === pair.game) return { ...track, muted: !gameHeard };
        return track;
      });
      const clips = [clipFromSide(face, pair.face, "Face"), clipFromSide(game, pair.game, "Gameplay")].filter((item) => item !== null);
      const plan = openDeskFlick(existing, {
        name: name.trim() || "Dual video",
        editedTrackIds: [pair.face, pair.game],
        clips,
        regions,
        tracks,
      });
      const flick: Flick = plan.id
        ? plan.flick
        : {
            ...shell,
            ...plan.flick,
            id: shell.id,
            fps: shell.fps,
            width: shell.width,
            height: shell.height,
            templateId: shell.templateId,
            voiceRelative: undefined,
            voiceStartSec: undefined,
            musicId: undefined,
            musicCredit: undefined,
          };
      const saved = await window.flicks!.saveFlick(folder, flick);
      if (!saved.ok || !saved.flick) {
        setMessage(saved.message ?? "Could not save the dual video.");
        return;
      }
      keepDraft.current = false;
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        // Opening the timeline still stands when the draft cannot be cleared.
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
      const nextArrangement = faceOnTop ? "face-top" : "game-top";
      const share = faceOnTop ? faceRegion.height : gameRegion.height;
      setArrangement(nextArrangement);
      setTopShare(share);
      setPreset(matchPreset(nextArrangement, share));
    }
    const faceClip = template.clips.find((item) => item.trackId === DUAL_FACE);
    const gameClip = template.clips.find((item) => item.trackId === DUAL_GAME);
    if (faceClip) setFace((side) => ({ ...side, title: titleFromClip(faceClip) }));
    if (gameClip) setGame((side) => ({ ...side, title: titleFromClip(gameClip) }));
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
        <strong>Dual video</strong>
        {folderLabel ? <span className="timeline-hint">{folderLabel}</span> : null}
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
                aria-pressed={arrangement === item.id}
                onClick={() => chooseArrangement(item.id)}
              >
                <span className="choice-radio" aria-hidden="true" />
                <span className="choice-diagram" style={diagramStyle(item.id, item.id === "face-top" ? "face-top" : "game-top")} />
                {item.label}
              </button>
            ))}
          </div>
          <p className="rail-label">Size</p>
          <div className="order-stack" role="group" aria-label="Size">
            {PRESETS.map((item) => (
              <button
                key={item.id}
                className={preset === item.id ? "choice on" : "choice"}
                aria-pressed={preset === item.id}
                onClick={() => choosePreset(item.id)}
              >
                <span className="choice-radio" aria-hidden="true" />
                <span className="choice-diagram" style={diagramStyle(item.id, arrangement)} />
                {item.label}
              </button>
            ))}
          </div>
          {preset === "custom" ? <p className="muted">This template uses its own seam. Pick Half, Face larger, or Gameplay larger.</p> : null}
          <button className="btn desk-save" disabled={busy} onClick={() => void saveRecipe()}>
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
          <div className="phone-column">
            <div className="phone">
              <div className="split-preview" data-top-share={topShare} style={{ gridTemplateRows: `${topShare}fr ${roundShare(1 - topShare)}fr` }}>
                <SidePreview
                  side={top}
                  label={topLabel}
                  heard={arrangement === "face-top" ? faceHeard : gameHeard}
                  videoRef={topLabel === "Face" ? faceVideo : gameVideo}
                  onTime={() => guardSide(topLabel === "Face" ? "face" : "game")}
                  onPlayState={syncPlaying}
                />
                <SidePreview
                  side={bottom}
                  label={bottomLabel}
                  heard={arrangement === "face-top" ? gameHeard : faceHeard}
                  videoRef={bottomLabel === "Face" ? faceVideo : gameVideo}
                  onTime={() => guardSide(bottomLabel === "Face" ? "face" : "game")}
                  onPlayState={syncPlaying}
                />
              </div>
            </div>
            <p className="desk-share">
              {topLabel} {Math.round(topShare * 100)}% · {bottomLabel} {Math.round((1 - topShare) * 100)}%
            </p>
            <div className="desk-play">
              <button type="button" className="btn-gold" onClick={togglePlay}>
                {playing ? "Pause" : "Play"}
              </button>
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
              <strong className="clip-kind">Face</strong>
              <span className="clip-file">{face.mediaName || "No clip yet"}</span>
              <label className="stack desk-words">
                <span>Words on the face</span>
                <input
                  className="field"
                  value={face.title}
                  placeholder="On the face"
                  onChange={(event) => setFace((side) => ({ ...side, title: event.target.value }))}
                />
              </label>
              <SideRange
                side={face}
                which="Face"
                onIn={(next) => setFace((row) => ({ ...row, inSec: clampIn(next, row.outSec, row.duration) }))}
                onOut={(next) => setFace((row) => ({ ...row, outSec: clampOut(next, row.inSec, row.duration) }))}
              />
              <span className="link-line">
                <input
                  className="field"
                  value={face.link}
                  placeholder="Paste a link"
                  onChange={(event) => setFace((side) => ({ ...side, link: event.target.value }))}
                />
                <button className="btn-small btn" disabled={busy} onClick={() => void getSide("face")}>
                  Get
                </button>
              </span>
              <span className="clip-sound">
                <SpeakerIcon />
                <span className="clip-sound-word">Sound</span>
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
            <span className="clip-add">
              <button className="plus" disabled={busy} aria-label="Add face clip" onClick={() => void add("face")}>
                +
              </button>
              <span>Add</span>
            </span>
          </div>
          <div className="clip-card">
            <span className="clip-badge game" aria-hidden="true">
              <GameIcon />
            </span>
            <div className="clip-card-main">
              <strong className="clip-kind">Gameplay</strong>
              <span className="clip-file">{game.mediaName || "No clip yet"}</span>
              <label className="stack desk-words">
                <span>Words on the gameplay</span>
                <input
                  className="field"
                  value={game.title}
                  placeholder="On the gameplay"
                  onChange={(event) => setGame((side) => ({ ...side, title: event.target.value }))}
                />
              </label>
              <SideRange
                side={game}
                which="Gameplay"
                onIn={(next) => setGame((row) => ({ ...row, inSec: clampIn(next, row.outSec, row.duration) }))}
                onOut={(next) => setGame((row) => ({ ...row, outSec: clampOut(next, row.inSec, row.duration) }))}
              />
              <span className="link-line">
                <input
                  className="field"
                  value={game.link}
                  placeholder="Paste a link"
                  onChange={(event) => setGame((side) => ({ ...side, link: event.target.value }))}
                />
                <button className="btn-small btn" disabled={busy} onClick={() => void getSide("game")}>
                  Get
                </button>
              </span>
              <span className="clip-sound">
                <SpeakerIcon />
                <span className="clip-sound-word">Sound</span>
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
            <span className="clip-add">
              <button className="plus" disabled={busy} aria-label="Add gameplay clip" onClick={() => void add("game")}>
                +
              </button>
              <span>Add</span>
            </span>
          </div>
          <p className="muted tiny">{heardLine(faceHeard, gameHeard)}</p>
        </aside>
      </div>
    </div>
  );
}

function SidePreview({
  side,
  label,
  heard,
  videoRef,
  onTime,
  onPlayState,
}: {
  side: Side;
  label: string;
  heard: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onTime: () => void;
  onPlayState: () => void;
}) {
  const caption = spokenLine(side.title, side.mediaName);
  return (
    <div className={label === "Face" ? "split-side is-face" : "split-side is-game"}>
      {side.previewUrl ? (
        <video
          ref={videoRef}
          src={side.previewUrl}
          playsInline
          muted={!heard}
          onLoadedData={(event) => {
            const node = event.currentTarget;
            const start = Math.max(0, side.inSec);
            if (!node.paused && node.currentTime >= start - 0.05) return;
            if (Math.abs(node.currentTime - start) > 0.05) node.currentTime = start;
          }}
          onTimeUpdate={onTime}
          onPlay={onPlayState}
          onPause={onPlayState}
        />
      ) : (
        <span>{label}</span>
      )}
      <span className="split-side-label">{label}</span>
      {caption ? <span className="split-side-caption">{caption}</span> : null}
    </div>
  );
}

function SideRange({
  side,
  which,
  onIn,
  onOut,
}: {
  side: Side;
  which: string;
  onIn: (next: number) => void;
  onOut: (next: number) => void;
}) {
  return (
    <div className="stack">
      <span className="field-label">In and Out</span>
      <div className="inout">
        <ClockField key={`${which}-in`} label="In" ariaLabel={`${which} in`} value={side.inSec} onCommit={onIn} />
        <span className="inout-dash">–</span>
        <ClockField key={`${which}-out`} label="Out" ariaLabel={`${which} out`} value={side.outSec} onCommit={onOut} />
      </div>
      {side.duration > 0 ? <p className="muted">This file is {side.duration.toFixed(1)}s. In and out stay inside it.</p> : null}
    </div>
  );
}

function ClockField({
  label,
  value,
  onCommit,
  ariaLabel,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(() => formatClock(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatClock(value));
  }, [value, focused]);
  return (
    <label className="clock">
      <span>{label}</span>
      <input
        className="field"
        aria-label={ariaLabel}
        value={focused ? text : formatClock(value)}
        onFocus={() => {
          setFocused(true);
          setText(formatClock(value));
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = parseClock(text);
          setFocused(false);
          if (next === null) {
            setText(formatClock(value));
            return;
          }
          onCommit(Math.max(0, next));
        }}
      />
    </label>
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
  const cut = id === "face-larger" ? (faceTop ? 60 : 40) : id === "game-larger" ? (faceTop ? 40 : 60) : 50;
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
      <rect x="5.2" y="6.2" width="9" height="7" rx="1.4" fill="#fffdf8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
