import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FlickProps } from "../remotion/FlickComposition";
import { FlickComposition } from "../remotion/FlickComposition";
import {
  assignLinesInOrder,
  clipAt,
  deleteClip,
  dragSeam,
  exportSavePath,
  fitClipsToMedia,
  frameForClips,
  fullFrame,
  importedLines,
  lineSizeOf,
  moveClip,
  placeClip,
  type PlaceOptions,
  splitClip,
  splitEvenly,
  storedLineColor,
  storedLineSize,
  storedTitleFont,
  shelfName,
  shelfRemovePlan,
  spokenLine,
  storedWarmth,
  trimClip,
  visibleRegions,
  visibleSelection,
  warmthOf,
} from "../shared/canvas";
import { bytesToBase64, microphoneMessage } from "../shared/microphone";
import { clipDuration, storedVoiceStart, timelineEnd, uid, type CallResult, type Clip, type ConnectionPublic, type Flick, type ShelfEntry, type Template } from "../shared/model";
import type { ResolvedMedia } from "../shared/api";
import type { AssistClip } from "../shared/assist";
import { UPLOAD_FILE_NOTE, uploadHandout } from "../shared/upload-paste";
import { whenPhrase } from "../shared/when";
import { StyleFields } from "./StyleFields";
import { WhichClip } from "./WhichClip";
import "./polish-canvas.css";

function mediaLimit(media: ResolvedMedia[], mediaId: string | null): number | undefined {
  if (!mediaId) return undefined;
  const duration = media.find((item) => item.id === mediaId)?.durationSec ?? 0;
  return duration > 0 ? duration : undefined;
}

type LaneKind = "rank" | "loop" | "face" | "game" | "video" | "other";
type LayoutKind = "ranking" | "dual" | "split" | "video";

function laneKind(name: string): LaneKind {
  const key = name.trim().toLowerCase();
  if (key === "rank" || key === "top") return "rank";
  if (key === "loop" || key === "bottom") return "loop";
  if (key === "face") return "face";
  if (key === "gameplay") return "game";
  if (key === "video") return "video";
  return "other";
}

function layoutKind(flick: { templateId?: string; tracks: { name: string }[] }): LayoutKind {
  const id = flick.templateId ?? "";
  if (id === "builtin-ranking") return "ranking";
  if (id === "builtin-dual") return "dual";
  if (id === "builtin-split") return "split";
  const names = new Set(flick.tracks.map((track) => track.name.trim().toLowerCase()));
  if (names.has("rank") || names.has("loop")) return "ranking";
  if (names.has("face") || names.has("gameplay")) return "dual";
  if (names.has("top") && names.has("bottom")) return "split";
  return "video";
}

/** Words on the clip card. A ranking uses ranking and background. A dual video keeps face and gameplay. One video stays video. */
function clipSpot(name: string, kind: LayoutKind): { use: string; plus: string; spot: string } {
  const key = name.trim().toLowerCase();
  if (kind === "ranking") {
    if (key === "loop" || key === "bottom") return { use: "Use as the background", plus: "Add to the background", spot: "the background" };
    return { use: "Put on the ranking", plus: "Add to the ranking", spot: "the ranking" };
  }
  if (kind === "dual") {
    if (key === "gameplay" || key === "game" || key === "bottom") return { use: "Use as the gameplay", plus: "+ Gameplay", spot: "the gameplay" };
    return { use: "Use as the face", plus: "+ Face", spot: "the face" };
  }
  if (kind === "split") {
    if (key === "bottom" || key === "loop") return { use: "Use as the bottom", plus: "+ Bottom", spot: "the bottom" };
    return { use: "Use as the top", plus: "+ Top", spot: "the top" };
  }
  return { use: "Use as the video", plus: "Add to the video", spot: "the video" };
}

function laneTitle(name: string, kind: LayoutKind): string {
  const key = name.trim().toLowerCase();
  if (kind === "ranking") {
    if (key === "loop" || key === "bottom") return "Background";
    return "Clips";
  }
  if (kind === "dual") {
    if (key === "gameplay" || key === "game" || key === "bottom") return "Gameplay";
    if (key === "face" || key === "top") return "Face";
    return name.trim() || "Video";
  }
  if (kind === "split") {
    if (key === "bottom" || key === "loop") return "Bottom";
    if (key === "top" || key === "face") return "Top";
    return name.trim() || "Video";
  }
  return "Video";
}

function fileBase(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function plainError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/, "");
  return cleaned || fallback;
}

function voiceOwnerId(flick: Flick): string | null {
  if (flick.voiceRelative !== "voice.mp3") return null;
  let best: { id: string; dist: number } | null = null;
  const start = flick.voiceStartSec ?? 0;
  for (const clip of flick.clips) {
    const dist = Math.abs(clip.startSec - start);
    if (!best || dist < best.dist) best = { id: clip.id, dist };
  }
  return best?.id ?? null;
}

function shelfTitle(fileName: string, peers: { id: string; name: string }[] = [], selfId = ""): string {
  const parts = shelfName(fileName, peers, selfId);
  return parts.mark ? `${parts.title} ${parts.mark}` : parts.title;
}

function blockTitle(label: string, fileName?: string): string {
  const clean = label.trim();
  if (/^#\d+$/.test(clean)) return clean;
  const spoken = spokenLine(clean);
  if (spoken) return spoken;
  if (fileName) return shelfTitle(fileName);
  return "Clip";
}

function lengthLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

const CANVAS_PANES_KEY = "go7-canvas-panes";
const SHELF_DEFAULT = 220;
const INSPECTOR_DEFAULT = 248;
const SHELF_MIN = 176;
const INSPECTOR_MIN = 210;
/** Play, the clock, and one lane stay in view. */
const TIMELINE_MIN = 148;
/** The phone keeps a visible stage when a pane is dragged open. */
const STAGE_MIN_W = 200;
const STAGE_MIN_H = 220;
const PANE_HANDLE = 12;

type CanvasPane = "shelf" | "inspector" | "timeline";

type CanvasPanes = {
  shelf: number;
  inspector: number;
  timeline: number | null;
};

function clampNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function readCanvasPanes(): CanvasPanes {
  const fallback: CanvasPanes = { shelf: SHELF_DEFAULT, inspector: INSPECTOR_DEFAULT, timeline: null };
  try {
    const raw = sessionStorage.getItem(CANVAS_PANES_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CanvasPanes>;
    return {
      shelf: Number.isFinite(Number(parsed.shelf)) ? clampNum(Number(parsed.shelf), SHELF_MIN, 1600) : SHELF_DEFAULT,
      inspector: Number.isFinite(Number(parsed.inspector))
        ? clampNum(Number(parsed.inspector), INSPECTOR_MIN, 1600)
        : INSPECTOR_DEFAULT,
      timeline:
        parsed.timeline == null || !Number.isFinite(Number(parsed.timeline))
          ? null
          : clampNum(Number(parsed.timeline), TIMELINE_MIN, 4000),
    };
  } catch {
    return fallback;
  }
}

function rememberCanvasPanes(panes: CanvasPanes) {
  try {
    sessionStorage.setItem(CANVAS_PANES_KEY, JSON.stringify(panes));
  } catch {
    /* This window may block storage. The drag still works until reload. */
  }
}

function clampDraggedPane(draft: CanvasPanes, which: CanvasPane, width: number, height: number): CanvasPanes {
  if (which === "timeline") {
    const maxTimeline = Math.max(TIMELINE_MIN, Math.round(height - STAGE_MIN_H - PANE_HANDLE));
    return { ...draft, timeline: clampNum(draft.timeline ?? TIMELINE_MIN, TIMELINE_MIN, maxTimeline) };
  }
  const across = Math.max(0, width - PANE_HANDLE * 2 - STAGE_MIN_W);
  if (which === "shelf") {
    const max = Math.max(SHELF_MIN, across - draft.inspector);
    return { ...draft, shelf: clampNum(draft.shelf, SHELF_MIN, max) };
  }
  const max = Math.max(INSPECTOR_MIN, across - draft.shelf);
  return { ...draft, inspector: clampNum(draft.inspector, INSPECTOR_MIN, max) };
}

/** Keeps a stored size inside the current window without moving the other pane first. */
function fitCanvasPanes(panes: CanvasPanes, width: number, height: number): CanvasPanes {
  if (width < 480 || height < 280) return panes;
  const across = Math.max(SHELF_MIN + INSPECTOR_MIN, width - PANE_HANDLE * 2 - STAGE_MIN_W);
  let shelf = Math.max(SHELF_MIN, panes.shelf);
  let inspector = Math.max(INSPECTOR_MIN, panes.inspector);
  if (shelf + inspector > across) {
    const overflow = shelf + inspector - across;
    const shelfSlack = Math.max(0, shelf - SHELF_MIN);
    const takeShelf = Math.min(shelfSlack, overflow);
    shelf -= takeShelf;
    inspector = Math.max(INSPECTOR_MIN, inspector - (overflow - takeShelf));
  }
  let timeline = panes.timeline;
  if (timeline != null) {
    const maxTimeline = Math.max(TIMELINE_MIN, Math.round(height - STAGE_MIN_H - PANE_HANDLE));
    timeline = clampNum(timeline, TIMELINE_MIN, maxTimeline);
  }
  return { shelf: Math.round(shelf), inspector: Math.round(inspector), timeline };
}

function clipWords(clip: Clip, showRank: boolean | undefined, mediaName?: string): string {
  const line = spokenLine(clip.line, mediaName);
  const rank = showRank === false ? "" : (clip.label.trim().match(/^#\d+$/)?.[0] ?? "");
  return [rank, line].filter(Boolean).join(" · ");
}

function tracksWithMedia(clips: Clip[]): string {
  const ids = new Set<string>();
  for (const clip of clips) {
    if (clip.mediaId) ids.add(clip.trackId);
  }
  return [...ids].sort().join("\0");
}

function hasTrackMedia(clips: Clip[], trackId: string): boolean {
  return clips.some((clip) => clip.trackId === trackId && Boolean(clip.mediaId));
}

/** Reframe when an empty region is still on screen, or when every region is hidden but a clip has a picture. */
function showingNeedsFrame(flick: Flick): boolean {
  const showing = flick.regions.filter((region) => !region.hidden && region.height > 0.01);
  if (showing.some((region) => !hasTrackMedia(flick.clips, region.trackId))) return true;
  return showing.length === 0 && flick.clips.some((clip) => Boolean(clip.mediaId));
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const wrote = document.execCommand("copy");
      area.remove();
      return wrote;
    } catch {
      return false;
    }
  }
}

function clipFromAsset(asset: { id: string; name: string; durationSec: number }, trackId: string): Clip {
  const duration = asset.durationSec > 0 ? asset.durationSec : 3;
  return {
    id: uid(),
    mediaId: asset.id,
    trackId,
    startSec: 0,
    inSec: 0,
    outSec: Math.round(duration * 1000) / 1000,
    label: asset.name.replace(/\.[^.]+$/, ""),
  };
}

function placedClipId(before: Clip[], after: Clip[], incomingId: string, replaceId?: string): string {
  if (replaceId && after.some((clip) => clip.id === replaceId)) return replaceId;
  if (after.some((clip) => clip.id === incomingId)) return incomingId;
  const filled = after.find((clip) => {
    const previous = before.find((item) => item.id === clip.id);
    return Boolean(previous && !previous.mediaId && clip.mediaId);
  });
  return filled?.id ?? incomingId;
}

function shelfCopies(assets: ResolvedMedia[]): { asset: ResolvedMedia; copy: number }[] {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const key = asset.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return assets.map((asset) => {
    const key = asset.name.toLowerCase();
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);
    return { asset, copy: (counts.get(key) ?? 0) > 1 ? next : 0 };
  });
}

function LeaveNav({
  onHome,
  onLibrary,
  onChannel,
  channelName,
}: {
  onHome: () => void;
  onLibrary: () => void;
  onChannel: () => void;
  channelName: string;
}) {
  const channelLabel = channelName.trim() ? `Back to ${channelName.trim()}` : "Back to channel";
  return (
    <nav className="canvas-nav" aria-label="Leave this flick">
      <button className="btn nav-btn" onClick={onHome}>
        Home
      </button>
      <button className="btn nav-btn" onClick={onLibrary}>
        Library
      </button>
      <button className="btn nav-btn nav-leave" onClick={onChannel} title={channelLabel}>
        ← {channelLabel}
      </button>
    </nav>
  );
}

const DESK_TEMPLATES = new Set(["builtin-ranking", "builtin-dual", "builtin-split"]);

function narrationMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

function stopRecordTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function CanvasScreen({
  dir,
  flickId,
  onBack,
  onHome,
  onLibrary,
  onConnections,
  onOpenDesk,
}: {
  dir: string;
  flickId: string;
  onBack: () => void;
  onHome: () => void;
  onLibrary: () => void;
  onConnections: () => void;
  onOpenDesk?: () => void;
}) {
  const [flick, setFlick] = useState<Flick | null>(null);
  const [media, setMedia] = useState<ResolvedMedia[]>([]);
  const mediaRef = useRef<ResolvedMedia[]>([]);
  mediaRef.current = media;
  const [accent, setAccent] = useState("#e2b340");
  const [channelName, setChannelName] = useState("");
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [soundUrls, setSoundUrls] = useState<Record<string, string>>({});
  const [connections, setConnections] = useState<ConnectionPublic[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [shelfQuery, setShelfQuery] = useState("");
  const [chatId, setChatId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [encoder, setEncoder] = useState("Checking encoder…");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [recording, setRecording] = useState(false);
  const [savedFile, setSavedFile] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState<"title" | "description" | "">("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [replaceId, setReplaceId] = useState("");
  const [pasted, setPasted] = useState("");
  const playerRef = useRef<PlayerRef>(null);
  const voiceAudio = useRef<HTMLAudioElement>(null);
  const flickRef = useRef<Flick | null>(null);
  const dirty = useRef(false);
  const saveChain = useRef(Promise.resolve());
  const saveTimer = useRef(0);
  const saveWave = useRef(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const armingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const openFlickRef = useRef(flickId);
  openFlickRef.current = flickId;
  const past = useRef<Flick[]>([]);
  const future = useRef<Flick[]>([]);
  const [pastCount, setPastCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);
  const [panes, setPanes] = useState<CanvasPanes>(readCanvasPanes);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const workspaceRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLElement>(null);

  function applyPanes(next: CanvasPanes) {
    panesRef.current = next;
    rememberCanvasPanes(next);
    setPanes(next);
  }

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const fit = () => {
      const next = fitCanvasPanes(panesRef.current, el.clientWidth, el.clientHeight);
      const current = panesRef.current;
      if (next.shelf === current.shelf && next.inspector === current.inspector && next.timeline === current.timeline) return;
      applyPanes(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [flick?.id]);

  function remember(nextPast: Flick[], nextFuture: Flick[]) {
    past.current = nextPast;
    future.current = nextFuture;
    setPastCount(nextPast.length);
    setFutureCount(nextFuture.length);
  }

  useEffect(() => {
    setSavedFile(null);
    setMoreOpen(false);
    setCopied("");
    void window.flicks!.readFlick(dir, flickId).then((result) => {
      if (!result.ok || !result.flick || !result.channel) {
        setMessage(result.message ?? "Could not open the flick.");
        return;
      }
      const mediaRows = result.media ?? [];
      const limits = new Map(mediaRows.filter((item) => item.durationSec > 0).map((item) => [item.id, item.durationSec]));
      const fitted = fitClipsToMedia(result.flick.clips, limits);
      const fittedFlick = fitted === result.flick.clips ? result.flick : { ...result.flick, clips: fitted };
      const regions = showingNeedsFrame(fittedFlick) ? frameForClips(fittedFlick.regions, fittedFlick.clips) : fittedFlick.regions;
      const opened = regions === fittedFlick.regions ? fittedFlick : { ...fittedFlick, regions };
      setFlick(opened);
      flickRef.current = opened;
      if (opened !== result.flick) dirty.current = true;
      setMedia(mediaRows);
      setAccent(result.channel.accent);
      setChannelName(result.channel.name);
      setVoiceUrl(result.voicePreview ?? null);
      setSoundUrls(result.soundPreviews ?? {});
      setSelectedRegion(
        visibleSelection(opened.regions, opened.clips, opened.regions.find((region) => !region.hidden)?.id ?? null),
      );
      remember([], []);
    });
    void window.flicks!.connections().then((rows) => {
      setConnections(rows);
      const chat = rows.find((row) => row.connected && row.kind !== "elevenlabs");
      const voice = rows.find((row) => row.connected && (row.kind === "elevenlabs" || row.kind === "minimax"));
      if (chat) setChatId(chat.id);
      if (voice) setVoiceId(voice.id);
    });
    void window.flicks!.templates().then(setTemplates);
    void window.flicks!.shelf().then(setShelf);
    void window.flicks!.gpu().then((gpu) => setEncoder(gpu.chosen));
  }, [dir, flickId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => {
      setPlayhead(event.detail.frame / (flickRef.current?.fps ?? 30));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    setPlaying(player.isPlaying());
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
    };
  }, [flick?.id]);

  function enqueueSave(folder: string, snapshot: Flick, report: boolean): Promise<CallResult> {
    const ticket = ++saveWave.current;
    const run = saveChain.current.then(async () => {
      if (ticket !== saveWave.current) return { ok: true, message: "Saved." };
      if (!window.flicks) return { ok: false, message: "Could not save the flick." };
      let result: CallResult;
      try {
        result = await window.flicks.saveFlick(folder, snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not save the flick.";
        if (report && ticket === saveWave.current) setMessage(message);
        return { ok: false, message };
      }
      if (ticket !== saveWave.current) return { ok: true, message: "Saved." };
      if (!result.ok) {
        if (report) setMessage(result.message || "Could not save the flick.");
        return result;
      }
      if (flickRef.current === snapshot) dirty.current = false;
      return result;
    });
    saveChain.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function flushSave(folder: string): Promise<CallResult> {
    window.clearTimeout(saveTimer.current);
    saveWave.current += 1;
    let result: CallResult = { ok: true, message: "Saved." };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await saveChain.current;
      const snapshot = flickRef.current;
      if (!snapshot || !dirty.current) return result;
      result = await enqueueSave(folder, snapshot, true);
      if (!result.ok) return result;
    }
    return result;
  }

  useEffect(() => {
    if (!dirty.current || !flick) return;
    const folder = dir;
    const snapshot = flick;
    const wave = saveWave.current;
    saveTimer.current = window.setTimeout(() => {
      if (wave !== saveWave.current || flickRef.current !== snapshot) return;
      void enqueueSave(folder, snapshot, true);
    }, 350);
    return () => window.clearTimeout(saveTimer.current);
  }, [flick, dir]);

  useEffect(() => {
    const folder = dir;
    return () => {
      window.clearTimeout(saveTimer.current);
      saveWave.current += 1;
      const current = flickRef.current;
      if (!dirty.current || !current) return;
      void enqueueSave(folder, current, false);
    };
  }, [dir]);

  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state === "recording") rec.stop();
      else stopRecordTracks(recordStreamRef.current);
    };
  }, [flickId]);

  function edit(next: Flick, history: "push" | "replace" = "push") {
    const current = flickRef.current;
    const occupancyChanged = !current || tracksWithMedia(current.clips) !== tracksWithMedia(next.clips);
    const regions = occupancyChanged ? frameForClips(next.regions, next.clips) : next.regions;
    const laid = regions === next.regions ? next : { ...next, regions };
    if (history === "push" && current) remember([...past.current, structuredClone(current)].slice(-30), []);
    dirty.current = true;
    flickRef.current = laid;
    setFlick(laid);
    if (occupancyChanged) setSelectedRegion((picked) => visibleSelection(laid.regions, laid.clips, picked));
  }

  function pasteLines() {
    const current = flickRef.current;
    if (!current || !selectedClip) {
      setMessage("Select a cut, then paste the lines.");
      return;
    }
    const lines = importedLines(pasted);
    if (!lines.length) {
      setMessage("Paste one caption per cut.");
      return;
    }
    const start = current.clips.find((clip) => clip.id === selectedClip);
    if (!start) return;
    const ids = current.clips
      .filter((clip) => clip.trackId === start.trackId)
      .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
      .map((clip) => clip.id);
    const assigned = assignLinesInOrder(ids, lines, selectedClip);
    edit({
      ...current,
      clips: current.clips.map((clip) => (assigned.has(clip.id) ? { ...clip, line: assigned.get(clip.id) } : clip)),
    });
    setMessage(assigned.size === 1 ? "Put 1 caption on the cuts." : `Put ${assigned.size} captions on the cuts.`);
  }

  function undo() {
    const current = flickRef.current;
    const previous = past.current.at(-1);
    if (!current || !previous) return;
    remember(past.current.slice(0, -1), [...future.current, structuredClone(current)]);
    dirty.current = true;
    flickRef.current = previous;
    setFlick(previous);
  }

  function redo() {
    const current = flickRef.current;
    const next = future.current.at(-1);
    if (!current || !next) return;
    remember([...past.current, structuredClone(current)].slice(-30), future.current.slice(0, -1));
    dirty.current = true;
    flickRef.current = next;
    setFlick(next);
  }

  const frames = Math.max(30, Math.ceil(timelineEnd(flick?.clips ?? []) * (flick?.fps ?? 30)));
  const preview = useMemo<FlickProps | null>(() => {
    if (!flick) return null;
    return {
      fps: flick.fps,
      width: flick.width,
      height: flick.height,
      accent,
      headline: flick.headline,
      headlineColor: flick.headlineColor,
      accentWords: flick.accentWords,
      titleStroke: flick.titleStroke,
      showRank: flick.showRank,
      showCaptions: flick.showCaptions,
      titleFont: flick.titleFont,
      lineColor: flick.lineColor,
      lineSize: flick.lineSize,
      pictureWarmth: flick.pictureWarmth,
      regions: flick.regions,
      tracks: flick.tracks,
      voiceSrc: voiceUrl ?? undefined,
      voiceStartSec: flick.voiceStartSec,
      musicSrc: media.find((item) => item.id === flick.musicId)?.previewUrl || undefined,
      musicCredit: flick.musicId ? flick.musicCredit : undefined,
      preview: true,
      clips: flick.clips.map((clip) => ({
        id: clip.id,
        trackId: clip.trackId,
        startSec: clip.startSec,
        inSec: clip.inSec,
        outSec: clip.outSec,
        label: clip.label,
        line: clip.line,
        fileName: media.find((item) => item.id === clip.mediaId)?.name,
        focus: clip.focus,
        src: media.find((item) => item.id === clip.mediaId)?.previewUrl ?? undefined,
        soundSrc: soundUrls[clip.id],
      })),
    };
  }, [flick, media, accent, voiceUrl, soundUrls]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!flick) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      if (target.getAttribute("role") === "separator") return;
      if (event.key === " " && !event.repeat) {
        event.preventDefault();
        playerRef.current?.toggle();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        splitAtPlayhead();
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!selectedClip) return;
        event.preventDefault();
        edit({ ...flick, clips: deleteClip(flick.clips, selectedClip) });
        setSelectedClip(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function splitAtPlayhead() {
    if (!flick) return;
    const region = flick.regions.find((item) => item.id === selectedRegion) ?? visibleRegions(flick.regions)[0];
    const clip = region ? clipAt(flick.clips, region.trackId, playhead) : null;
    const target = clip?.id ?? selectedClip;
    if (!target) return;
    edit({ ...flick, clips: splitClip(flick.clips, target, playhead) });
  }

  async function addSound() {
    const current = flickRef.current;
    const chosen = current?.clips.find((clip) => clip.id === selectedClip);
    if (!current || !chosen) {
      setMessage("Select a cut, then add a sound.");
      return;
    }
    setBusy("Adding sound…");
    const saved = await flushSave(dir);
    if (!saved.ok) {
      setBusy("");
      return;
    }
    const result = await window.flicks!.addSound(dir, current.id, chosen.id);
    setBusy("");
    if (!result.ok) {
      setMessage(result.message ?? "Could not add that sound.");
      return;
    }
    const relative = result.flick?.clips.find((clip) => clip.id === chosen.id)?.soundRelative;
    if (result.previewUrl) setSoundUrls((urls) => ({ ...urls, [chosen.id]: result.previewUrl! }));
    const latest = flickRef.current ?? current;
    edit({
      ...latest,
      clips: latest.clips.map((clip) => (clip.id === chosen.id ? { ...clip, soundRelative: relative } : clip)),
    });
    setMessage(result.message ? `${result.message} plays once at the start of this cut.` : "Sound plays at the start of this cut.");
  }

  async function removeSound() {
    const current = flickRef.current;
    const chosen = current?.clips.find((clip) => clip.id === selectedClip);
    if (!current || !chosen?.soundRelative) return;
    setBusy("Removing sound…");
    const saved = await flushSave(dir);
    if (!saved.ok) {
      setBusy("");
      return;
    }
    const result = await window.flicks!.clearSound(dir, current.id, chosen.id);
    setBusy("");
    if (!result.ok) {
      setMessage(result.message ?? "Could not remove that sound.");
      return;
    }
    setSoundUrls((urls) => {
      const next = { ...urls };
      delete next[chosen.id];
      return next;
    });
    const latest = flickRef.current ?? current;
    edit({
      ...latest,
      clips: latest.clips.map((clip) => (clip.id === chosen.id ? { ...clip, soundRelative: undefined } : clip)),
    });
    setMessage("Sound removed.");
  }

  async function addMusic() {
    if (!flick) return;
    const result = await window.flicks!.importAudio(dir);
    if (!result.ok || !result.asset || !result.media) {
      setMessage(result.message ?? "Could not add that music.");
      return;
    }
    setMedia(result.media);
    edit({ ...flick, musicId: result.asset.id });
    setShelf(await window.flicks!.shelf());
    setMessage(result.workingCopy ? "Working copy is on this computer." : result.asset.name);
  }

  function trackForPlace(current: Flick): string | null {
    const selected = current.clips.find((clip) => clip.id === selectedClip);
    if (selected) return selected.trackId;
    const region = current.regions.find((item) => item.id === selectedRegion);
    if (region) return region.trackId;
    return current.tracks.find((track) => track.kind === "video")?.id ?? current.tracks[0]?.id ?? null;
  }

  async function useSaved(id: string) {
    const current = flickRef.current;
    if (!current) return;
    const result = await window.flicks!.useShelf(dir, id);
    const latest = flickRef.current ?? current;
    if (!result.ok || !result.asset || !result.media) {
      setMessage(result.message ?? "Could not use that saved file.");
      return;
    }
    setMedia(result.media);
    if (result.kind === "audio") {
      edit({ ...latest, musicId: result.asset.id, musicCredit: result.credit || latest.musicCredit });
      setMessage(result.workingCopy ? "Working copy is on this computer." : result.asset.name);
      return;
    }
    const trackId = trackForPlace(latest);
    if (!trackId) return;
    const clip = clipFromAsset(result.asset, trackId);
    const selected = latest.clips.find((item) => item.id === selectedClip);
    const replaceId = selected && selected.trackId === trackId ? selected.id : undefined;
    const clips = placeClip(latest.clips, trackId, clip, { mode: "place", replaceId });
    edit({ ...latest, clips });
    const framed = flickRef.current ?? latest;
    setSelectedClip(placedClipId(latest.clips, clips, clip.id, replaceId));
    setSelectedRegion(
      visibleSelection(framed.regions, framed.clips, framed.regions.find((region) => region.trackId === trackId)?.id ?? null),
    );
    setMessage(result.workingCopy ? "Working copy is on this computer." : result.asset.name);
  }

  async function removeAsset(mediaId: string) {
    if (!window.flicks) return;
    const flushed = await flushSave(dir);
    const plan = shelfRemovePlan(flushed);
    if (!plan.remove) {
      setMessage(plan.message);
      return;
    }
    try {
      const result = await window.flicks.removeMedia(dir, mediaId);
      if (!result?.ok) {
        setMessage(result?.message || "Could not remove that clip.");
        return;
      }
      if (result.media) setMedia(result.media);
      else setMedia((rows) => rows.filter((item) => item.id !== mediaId));
      setShelf(await window.flicks.shelf());
      setMessage(result.message || "Removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove that clip.");
    }
  }

  async function getLink() {
    if (!flick) return;
    const current = flick.clips.find((clip) => clip.id === selectedClip);
    const url = current?.sourceUrl?.trim() ?? "";
    if (!url) {
      setMessage("Paste a link on the selected cut.");
      return;
    }
    setBusy("Getting the clip…");
    const result = await window.flicks!.downloadMedia(dir, url);
    setBusy("");
    if (!result.ok || !result.asset || !result.media) {
      setMessage(result.message ?? "Could not get that clip.");
      return;
    }
    setMedia(result.media);
    setShelf(await window.flicks!.shelf());
    const duration = result.asset.durationSec > 0 ? result.asset.durationSec : 3;
    const sourceUrl = result.sourceUrl || url;
    const name = result.asset.name.replace(/\.[^.]+$/, "");
    setMessage(result.workingCopy ? "Working copy is on this computer." : result.asset.name);
    if (current) {
      let clips = flick.clips.map((clip) =>
        clip.id === current.id ? { ...clip, mediaId: result.asset!.id, sourceUrl, label: clip.label || name } : clip,
      );
      clips = trimClip(clips, current.id, "in", 0, duration);
      clips = trimClip(clips, current.id, "out", duration, duration);
      edit({ ...flick, clips });
    } else {
      const region = flick.regions.find((item) => item.id === selectedRegion) ?? visibleRegions(flick.regions)[0];
      if (!region) return;
      const clip: Clip = {
        id: uid(),
        mediaId: result.asset.id,
        trackId: region.trackId,
        startSec: 0,
        inSec: 0,
        outSec: Math.round(duration * 1000) / 1000,
        label: name,
        sourceUrl,
      };
      edit({ ...flick, clips: placeClip(flick.clips, region.trackId, clip) });
      setSelectedClip(clip.id);
    }
  }

  async function addMedia(mode: "copy" | "link") {
    setMessage("Adding the clip…");
    const result = await window.flicks!.importMedia(dir, mode);
    if (!result.ok || !result.media) {
      setMessage(result.message ?? "Could not add that file.");
      return;
    }
    setMedia(result.media);
    setShelf(await window.flicks!.shelf());
    setMessage(
      result.workingCopy
        ? "Working copy is on this computer."
        : mode === "copy"
          ? "Copied into the channel."
          : "Linked the file.",
    );
  }

  async function addToTrack(asset: ResolvedMedia, trackId: string, mode: "place" | "append") {
    const current = flickRef.current;
    if (!current) return;
    const spot = clipSpot(current.tracks.find((track) => track.id === trackId)?.name ?? "", layoutKind(current));
    const title = shelfTitle(asset.name);
    setMessage(mode === "append" ? `Adding ${title} to ${spot.spot}…` : `Putting ${title} on ${spot.spot}…`);
    const staged = await window.flicks!.stageMedia(dir, asset.id);
    const latest = flickRef.current ?? current;
    if (!staged.ok || !staged.media) {
      setMessage(staged.message ?? "Could not copy that file onto this computer.");
      return;
    }
    setMedia(staged.media);
    const clip = clipFromAsset(asset, trackId);
    const selected = latest.clips.find((item) => item.id === selectedClip);
    const replaceId = mode === "place" && selected?.trackId === trackId ? selected.id : undefined;
    const options: PlaceOptions = mode === "append" ? { mode: "append" } : { mode: "place", replaceId };
    const clips = placeClip(latest.clips, trackId, clip, options);
    edit({ ...latest, clips });
    const framed = flickRef.current ?? latest;
    setSelectedClip(placedClipId(latest.clips, clips, clip.id, replaceId));
    setSelectedRegion(
      visibleSelection(framed.regions, framed.clips, framed.regions.find((region) => region.trackId === trackId)?.id ?? null),
    );
    setMessage(mode === "append" ? `Added ${title} to ${spot.spot}.` : `Put ${title} on ${spot.spot}.`);
  }

  async function runLine() {
    if (!flick || !selected) return;
    if (!chatId) {
      setMessage("Add and test a chat connection first.");
      return;
    }
    const layout = visibleRegions(flick.regions)
      .map((region) => {
        const track = flick.tracks.find((item) => item.id === region.trackId);
        return `${track?.name ?? "Region"} ${Math.round(region.height * 100)}%`;
      })
      .join(", ");
    const prompt = [
      "Write one spoken line for a vertical short.",
      `Channel: ${channelName}`,
      `Layout: ${layout}`,
      `Clip label: ${selected.label}`,
      selected.line ? `Current line: ${selected.line}` : "",
      "Return only the line.",
    ]
      .filter(Boolean)
      .join("\n");
    setBusy("Writing…");
    const result = await window.flicks!.writeLine(chatId, prompt);
    setBusy("");
    if (!result.ok || !result.text) {
      setMessage(result.message ?? "The connection returned nothing.");
      return;
    }
    edit({
      ...flick,
      clips: flick.clips.map((clip) => (clip.id === selected.id ? { ...clip, line: result.text } : clip)),
    });
  }

  async function runVoice() {
    const current = flickRef.current;
    const chosen = current?.clips.find((clip) => clip.id === selectedClip);
    if (!current || !chosen) {
      setMessage("Pick a clip on the timeline first.");
      return;
    }
    const line = spokenLine(chosen.line, mediaRef.current.find((item) => item.id === chosen.mediaId)?.name);
    if (!line) {
      setMessage("Write a line first.");
      return;
    }
    if (!voiceId) {
      setMessage("Connect a voice account in Connections first.");
      return;
    }
    const startSec = chosen.startSec;
    setBusy("Making voice…");
    const result = await window.flicks!.makeVoice(voiceId, dir, current.id, line, startSec);
    setBusy("");
    if (!result.ok) {
      setMessage(result.message ?? "Voice failed.");
      return;
    }
    const previewUrl = "previewUrl" in result ? (result.previewUrl as string | undefined) : undefined;
    if (previewUrl) setVoiceUrl(previewUrl);
    const latest = flickRef.current ?? current;
    edit({ ...latest, voiceRelative: "voice.mp3", voiceStartSec: storedVoiceStart(startSec) });
    setMessage("Voice is ready. Press play to hear it.");
  }

  async function finishNarration(folder: string, flickId: string, blob: Blob, mime: string) {
    recordStreamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    if (!blob.size) {
      if (openFlickRef.current === flickId) setMessage("The recording was empty.");
      return;
    }
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const result = await window.flicks!.saveNarration(folder, flickId, bytesToBase64(bytes), mime);
      if (openFlickRef.current !== flickId) return;
      if (!result.ok) {
        setMessage(result.message ?? "Could not save the narration.");
        return;
      }
      const previewUrl = "previewUrl" in result ? (result.previewUrl as string | undefined) : undefined;
      if (previewUrl) setVoiceUrl(previewUrl);
      const latest = flickRef.current;
      if (latest) {
        const chosen = latest.clips.find((clip) => clip.id === selectedClip);
        edit({
          ...latest,
          voiceRelative: "voice.mp3",
          voiceStartSec: storedVoiceStart(chosen?.startSec ?? latest.voiceStartSec),
        });
      }
      setMessage("Narration is ready. Press play to hear it.");
    } catch (error) {
      if (openFlickRef.current === flickId) {
        setMessage(error instanceof Error ? error.message : "Could not save the narration.");
      }
    }
  }

  async function toggleNarration() {
    const active = recorderRef.current;
    if (active && active.state === "recording") {
      active.stop();
      return;
    }
    if (armingRef.current) {
      stopRequestedRef.current = true;
      return;
    }
    const current = flickRef.current;
    if (!current) return;
    if (!current.clips.some((clip) => clip.id === selectedClip)) {
      setMessage("Pick a clip on the timeline first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("This window cannot use the microphone.");
      return;
    }
    armingRef.current = true;
    stopRequestedRef.current = false;
    const folder = dir;
    const flickId = current.id;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stopRequestedRef.current) {
        stopRecordTracks(stream);
        stopRequestedRef.current = false;
        return;
      }
      const mime = narrationMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      rec.onstop = () => {
        stopRecordTracks(stream);
        const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        void finishNarration(folder, flickId, blob, rec.mimeType || mime || "audio/webm");
      };
      recordStreamRef.current = stream;
      recorderRef.current = rec;
      rec.start(1000);
      if (stopRequestedRef.current) {
        rec.stop();
        return;
      }
      setRecording(true);
      setMessage("Recording. Press Stop when you are done.");
    } catch (error) {
      stopRecordTracks(stream);
      recordStreamRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      setMessage(microphoneMessage(error));
    } finally {
      armingRef.current = false;
    }
  }

  async function saveTemplate() {
    if (!flick) return;
    const result = await window.flicks!.saveTemplate(flick, templateName || flick.name, replaceId || undefined);
    setMessage(result.message ?? (result.ok ? "Template saved." : "Could not save the template."));
    if (result.ok) {
      setSavingTemplate(false);
      setTemplates(await window.flicks!.templates());
    }
  }

  async function exportFlick(kind: "cut" | "styled") {
    const named = flickRef.current;
    if (!named) return;
    setSavedFile(null);
    setMessage(kind === "styled" ? "Opening the save window…" : "Opening the save window for the top picture…");
    const primed = await flushSave(dir);
    if (!primed.ok) {
      setMessage(primed.message || "Could not save before export.");
      return;
    }
    let output: string | null = null;
    try {
      output = await window.flicks!.pickSave(exportSavePath(dir, named.name));
    } catch (error) {
      setMessage(plainError(error, "Could not open the save window."));
      return;
    }
    if (!output) {
      setMessage("The save window was closed. Nothing was written.");
      return;
    }
    const flushed = await flushSave(dir);
    if (!flushed.ok) {
      setMessage(flushed.message || "Could not save before export.");
      return;
    }
    const latest = flickRef.current;
    if (!latest) return;
    setBusy(kind === "cut" ? "Cutting…" : "Rendering…");
    try {
      const result =
        kind === "cut"
          ? await window.flicks!.exportCut(dir, latest.id, output)
          : await window.flicks!.exportStyled(dir, latest.id, output);
      if (result.ok) {
        setSavedFile(output);
        setMessage(`Saved ${fileBase(output)}`);
        setCopied("");
      } else {
        setMessage(result.message ?? "Export failed.");
      }
    } catch (error) {
      setMessage(plainError(error, "Export failed."));
    } finally {
      setBusy("");
    }
  }

  async function copyUploadText(text: string, which: "title" | "description") {
    const wrote = await writeClipboard(text);
    if (wrote) {
      setCopied(which);
      return;
    }
    setMessage("Select the text and copy it.");
  }

  function onSeam(regionId: string, event: React.PointerEvent) {
    if (!flick) return;
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const upper = flick.regions.find((region) => region.id === regionId);
    if (!upper) return;
    const startY = event.clientY;
    const startHeight = upper.height;
    let pushed = false;
    const move = (ev: PointerEvent) => {
      const current = flickRef.current;
      if (!current) return;
      const nextHeight = startHeight + (ev.clientY - startY) / bounds.height;
      edit({ ...current, regions: dragSeam(current.regions, regionId, nextHeight) }, pushed ? "replace" : "push");
      pushed = true;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginPaneDrag(event: React.PointerEvent<HTMLDivElement>, which: CanvasPane) {
    if (event.button !== 0) return;
    event.preventDefault();
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const handle = event.currentTarget;
    const originX = event.clientX;
    const originY = event.clientY;
    const start = panesRef.current;
    const timelineStart =
      which === "timeline" ? (start.timeline ?? timelineRef.current?.getBoundingClientRect().height ?? TIMELINE_MIN) : 0;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* The listeners below still follow the pointer when capture is unavailable. */
    }
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = which === "timeline" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const live = workspace.getBoundingClientRect();
      const draft: CanvasPanes = { ...panesRef.current };
      if (which === "shelf") draft.shelf = start.shelf + (ev.clientX - originX);
      else if (which === "inspector") draft.inspector = start.inspector - (ev.clientX - originX);
      else draft.timeline = timelineStart - (ev.clientY - originY);
      const next = clampDraggedPane(draft, which, live.width, live.height);
      const current = panesRef.current;
      if (next.shelf === current.shelf && next.inspector === current.inspector && next.timeline === current.timeline) return;
      applyPanes(next);
    };
    const up = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function nudgePane(event: React.KeyboardEvent<HTMLDivElement>, which: CanvasPane) {
    const step = event.shiftKey ? 48 : 16;
    let delta = 0;
    if (which === "timeline") {
      if (event.key === "ArrowDown") delta = step;
      else if (event.key === "ArrowUp") delta = -step;
    } else if (which === "shelf") {
      if (event.key === "ArrowRight") delta = step;
      else if (event.key === "ArrowLeft") delta = -step;
    } else if (event.key === "ArrowLeft") delta = step;
    else if (event.key === "ArrowRight") delta = -step;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const bounds = workspace.getBoundingClientRect();
    const start = panesRef.current;
    const draft: CanvasPanes = { ...start };
    if (which === "timeline") {
      draft.timeline = (start.timeline ?? timelineRef.current?.getBoundingClientRect().height ?? TIMELINE_MIN) + delta;
    } else if (which === "shelf") draft.shelf = start.shelf + delta;
    else draft.inspector = start.inspector + delta;
    applyPanes(clampDraggedPane(draft, which, bounds.width, bounds.height));
  }

  if (!flick || !preview) {
    return (
      <main className="page">
        <LeaveNav onHome={onHome} onLibrary={onLibrary} onChannel={onBack} channelName={channelName} />
        <p className="banner">{message || "Opening flick…"}</p>
      </main>
    );
  }

  const selected = flick.clips.find((clip) => clip.id === selectedClip) ?? null;
  const regions = visibleRegions(flick.regions);
  const seconds = Math.max(timelineEnd(flick.clips), 1);
  const headlineText = flick.headline?.replace(/\s+/g, " ").trim() ?? "";
  const wordClips = flick.clips
    .map((clip) => ({ clip, text: clipWords(clip, flick.showRank, media.find((item) => item.id === clip.mediaId)?.name) }))
    .filter((item) => item.text);
  const wordTrackIds = flick.tracks.map((track) => track.id).filter((id) => wordClips.some((item) => item.clip.trackId === id));
  const wordsLaneHeight = Math.max(56, (headlineText ? 32 : 10) + wordTrackIds.length * 26 + 10);
  const clipQuery = shelfQuery.trim().toLowerCase();
  const videoAssets = shelfCopies(media.filter((asset) => asset.width > 0));
  const shelfPeers = videoAssets.map(({ asset }) => ({ id: asset.id, name: asset.name }));
  const kind = layoutKind(flick);
  const handout = uploadHandout(flick, media);
  const voiceOwner = voiceOwnerId(flick);
  const trackLabel = flick.tracks.find((track) => track.id === selected?.trackId)?.name ?? "";
  const selectedTrackName = selected ? laneTitle(trackLabel, kind) : "This cut";
  const visibleAssets = videoAssets.filter(({ asset }) => {
    if (!clipQuery) return true;
    const parts = shelfName(asset.name, shelfPeers, asset.id);
    const title = `${parts.title} ${parts.mark}`.toLowerCase();
    return asset.name.toLowerCase().includes(clipQuery) || title.includes(clipQuery);
  });
  const clipUses = new Set(flick.clips.map((clip) => clip.mediaId).filter((id): id is string => Boolean(id)));
  const headlineSwatch = /^#[0-9a-fA-F]{6}$/.test(flick.headlineColor?.trim() ?? "") ? flick.headlineColor!.trim() : "#e2b340";
  const titleStroke = Number.isFinite(flick.titleStroke) ? (flick.titleStroke as number) : 6;
  const usedVideos = shelf.filter(
    (item) =>
      item.kind === "video" &&
      (!clipQuery || item.name.toLowerCase().includes(clipQuery) || shelfTitle(item.name).toLowerCase().includes(clipQuery)),
  );

  return (
    <div className="app canvas-screen">
      <header className="toolbar">
        <LeaveNav onHome={onHome} onLibrary={onLibrary} onChannel={onBack} channelName={channelName} />
        <input
          className="field flick-name"
          aria-label="Video name"
          value={flick.name}
          onChange={(event) => edit({ ...flick, name: event.target.value })}
        />
        <span className="spacer" />
        <button className="btn" onClick={onConnections}>
          Connections
        </button>
        {DESK_TEMPLATES.has(flick.templateId ?? "") ? (
          <button type="button" className="btn" onClick={() => onOpenDesk?.()}>
            {flick.templateId === "builtin-ranking" ? "Ranking" : "Split"}
          </button>
        ) : null}
        <button
          className="btn-primary"
          disabled={Boolean(busy)}
          title="Saves the vertical video, with the clips and the words."
          onClick={() => void exportFlick("styled")}
        >
          Save vertical video
        </button>
        <div className="toolbar-more">
          <button type="button" className="btn" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
            More
          </button>
          {moreOpen ? (
            <div className="toolbar-more-menu">
              <button
                className="btn"
                type="button"
                title="Writes the top picture only. Captions, headlines, ranks, and clip audio are not in that file. Sound is the voice and the music."
                aria-label="Export top picture"
                disabled={encoder === "ffmpeg missing" || Boolean(busy)}
                onClick={() => void exportFlick("cut")}
              >
                Export top picture
              </button>
              <label className="stack">
                <span>Voice account</span>
                <select className="field" aria-label="Voice account" value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
                  <option value="">Choose</option>
                  {connections
                    .filter((row) => row.kind === "elevenlabs" || row.kind === "minimax")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                        {row.connected ? "" : " (not tested)"}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </header>
      {busy ? <p className="banner">{busy}</p> : message ? <p className="banner">{message}</p> : null}
      <section className="upload-card" aria-label="YouTube title and description">
        {savedFile ? <p className="saved-name">Saved {fileBase(savedFile)}</p> : null}
        <div className="upload-row">
          <span className="upload-paste-label">YouTube title</span>
          <textarea className="field upload-box" readOnly rows={2} aria-label="YouTube title" value={handout.title} />
          <button className="btn" type="button" aria-label="Copy YouTube title" onClick={() => void copyUploadText(handout.title, "title")}>
            Copy
          </button>
          {copied === "title" ? <span className="tiny muted">Copied</span> : null}
        </div>
        <div className="upload-row">
          <span className="upload-paste-label">YouTube description</span>
          <textarea className="field upload-box" readOnly rows={2} aria-label="YouTube description" value={handout.description} />
          <button className="btn" type="button" aria-label="Copy YouTube description" onClick={() => void copyUploadText(handout.description, "description")}>
            Copy
          </button>
          {copied === "description" ? <span className="tiny muted">Copied</span> : null}
        </div>
        <p className="tiny muted">{UPLOAD_FILE_NOTE}</p>
      </section>
      <div
        className="workspace"
        ref={workspaceRef}
        style={{
          ["--shelf-width" as string]: `${panes.shelf}px`,
          ["--inspector-width" as string]: `${panes.inspector}px`,
          ...(panes.timeline != null ? { ["--timeline-height" as string]: `${panes.timeline}px` } : {}),
        }}
      >
        <aside className="rail shelf-rail">
          <div className="shelf-sticky">
            <div className="shelf-head">
              <h2>Clips</h2>
              <p className="shelf-purpose">Put these on the timeline.</p>
            </div>
            <label className="shelf-search">
              <span className="sr-only">Find a clip</span>
              <input
                className="field"
                value={shelfQuery}
                placeholder="Find a clip"
                onChange={(event) => setShelfQuery(event.target.value)}
              />
            </label>
            {videoAssets.length ? (
              <p className="shelf-count">
                <span>{clipQuery ? `${visibleAssets.length} of ${videoAssets.length}` : `${videoAssets.length} clips`}</span>
                {clipQuery ? (
                  <button className="btn btn-small" onClick={() => setShelfQuery("")}>
                    Show all
                  </button>
                ) : null}
              </p>
            ) : null}
            <div className="shelf-actions">
              <button className="btn shelf-add" title="Copies the file into this channel." onClick={() => void addMedia("copy")}>
                Add clip
              </button>
              <button
                className="btn shelf-add"
                title="A local file stays where it is. A network file is copied onto this computer."
                onClick={() => void addMedia("link")}
              >
                Link clip
              </button>
            </div>
          </div>
          <div className="shelf-list">
            {visibleAssets.map(({ asset, copy }) => {
              const onTimeline = selected?.mediaId === asset.id;
              const linked = Boolean(asset.absolutePath && !asset.relativePath);
              const parts = shelfName(asset.name, shelfPeers, asset.id);
              const made = asset.madeAt ? whenPhrase("Made", asset.madeAt) : null;
              const status = [
                made ?? "",
                asset.missing ? "Missing" : "",
                asset.workingCopy ? "On this computer" : linked ? "Linked" : "",
                onTimeline ? "On the timeline" : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={asset.id} className={onTimeline ? "shelf-row on" : "shelf-row"}>
                  <div className="shelf-row-main">
                    <strong className="shelf-name" title={parts.mark ? `${parts.title} · ${parts.mark}` : asset.name}>
                      <span className="shelf-name-text">{parts.title}</span>
                      {parts.mark ? <span className="shelf-mark">{parts.mark}</span> : null}
                      {copy > 0 && !parts.mark ? <span className="shelf-index">{copy}</span> : null}
                    </strong>
                    <span className="shelf-time">{asset.missing ? "Missing" : lengthLabel(asset.durationSec)}</span>
                  </div>
                  {status ? <p className="shelf-meta">{status}</p> : null}
                  <div className="shelf-places">
                    {flick.tracks.map((track) => {
                      const region = flick.regions.find((item) => item.trackId === track.id);
                      const selectedHere = Boolean(region && region.id === selectedRegion);
                      const spot = clipSpot(track.name, kind);
                      return (
                        <button
                          key={track.id}
                          type="button"
                          className={selectedHere ? "btn shelf-place on" : "btn shelf-place"}
                          title={`Fills the selected cut on ${spot.spot}, or the first empty cut. If that track is already full, this adds a cut at the end.`}
                          onClick={() => void addToTrack(asset, track.id, "place")}
                        >
                          {spot.use}
                        </button>
                      );
                    })}
                  </div>
                  <div className="shelf-places">
                    {flick.tracks.map((track) => {
                      const spot = clipSpot(track.name, kind);
                      return (
                        <button
                          key={track.id}
                          type="button"
                          className="btn shelf-place"
                          title={`Adds this clip after the last cut on ${spot.spot}.`}
                          onClick={() => void addToTrack(asset, track.id, "append")}
                        >
                          {spot.plus}
                        </button>
                      );
                    })}
                  </div>
                  {clipUses.has(asset.id) ? null : (
                    <div className="shelf-places">
                      <button type="button" className="btn shelf-place" onClick={() => void removeAsset(asset.id)}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {!videoAssets.length ? (
              <p className="shelf-empty">No clips yet. Add one from this computer, or paste a link on a cut and press Get.</p>
            ) : null}
            {videoAssets.length > 0 && visibleAssets.length === 0 ? (
              <p className="shelf-empty">Nothing matches. Show all to see every clip.</p>
            ) : null}
            {usedVideos.length ? (
              <div className="stack used-clips">
                <p className="rail-label">Used before</p>
                {usedVideos.map((item) => {
                  const made = item.madeAt ? whenPhrase("Made", item.madeAt) : null;
                  return (
                    <button key={item.id} className="btn used-clip" title={item.name} onClick={() => void useSaved(item.id)}>
                      <span className="used-clip-name">{shelfTitle(item.name)}</span>
                      {made ? <span className="used-made">{made}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </aside>
        <div
          className="pane-split pane-split-v pane-split-shelf"
          role="separator"
          aria-orientation="vertical"
          aria-label="Clip shelf width"
          aria-valuemin={SHELF_MIN}
          aria-valuenow={panes.shelf}
          tabIndex={0}
          title="Drag to resize the clip shelf"
          onPointerDown={(event) => beginPaneDrag(event, "shelf")}
          onKeyDown={(event) => nudgePane(event, "shelf")}
        />
        <div className="stage-wrap">
          <div className="frame-wrap" ref={frameRef}>
            <Player
              ref={playerRef}
              component={FlickComposition}
              inputProps={preview}
              durationInFrames={frames}
              fps={flick.fps}
              compositionWidth={flick.width}
              compositionHeight={flick.height}
              style={{ width: "100%", height: "100%" }}
              acknowledgeRemotionLicense
            />
            <div className="frame-hit">
              {regions.map((region, index) => (
                <div key={region.id}>
                  <button
                    className={region.id === selectedRegion ? "region-hit on" : "region-hit"}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                      background: "transparent",
                    }}
                    onClick={() => setSelectedRegion(visibleSelection(flick.regions, flick.clips, region.id))}
                  />
                  {index < regions.length - 1 ? (
                    <div
                      className="seam"
                      style={{ top: `${(region.y + region.height) * 100}%` }}
                      onPointerDown={(event) => onSeam(region.id, event)}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div
          className="pane-split pane-split-v pane-split-inspector"
          role="separator"
          aria-orientation="vertical"
          aria-label="Inspector width"
          aria-valuemin={INSPECTOR_MIN}
          aria-valuenow={panes.inspector}
          tabIndex={0}
          title="Drag to resize the inspector"
          onPointerDown={(event) => beginPaneDrag(event, "inspector")}
          onKeyDown={(event) => nudgePane(event, "inspector")}
        />
        <aside className="inspector stack">
          <section className="voice-box" aria-label="Voice">
            <p className="rail-label">Voice</p>
            {selected ? null : <p className="muted">Pick a clip on the timeline first.</p>}
            <div className="row">
              <button className="btn" disabled={Boolean(busy)} onClick={() => void runVoice()}>
                Make voice
              </button>
              <button className="btn" type="button" disabled={Boolean(busy) && !recording} onClick={() => void toggleNarration()}>
                {recording ? "Stop" : "Record narration"}
              </button>
            </div>
            {voiceUrl ? <audio ref={voiceAudio} controls src={voiceUrl} aria-label="Play the voice" /> : null}
          </section>
          <label className="stack">
            <span>Headline</span>
            <textarea
              className="field"
              rows={2}
              aria-label="Headline"
              value={flick.headline ?? ""}
              onChange={(event) => edit({ ...flick, headline: event.target.value.trim() ? event.target.value : undefined })}
            />
          </label>
          <label className="stack">
            <span>Accent words</span>
            <input
              className="field"
              aria-label="Accent words"
              value={flick.accentWords ?? ""}
              onChange={(event) => edit({ ...flick, accentWords: event.target.value.trim() ? event.target.value : undefined })}
            />
          </label>
          <label className="stack">
            <span>Highlight color</span>
            <span className="color-line">
              <input
                type="color"
                aria-label="Highlight color"
                value={headlineSwatch}
                onChange={(event) => edit({ ...flick, headlineColor: event.target.value })}
              />
              <input
                className="field hex"
                spellCheck={false}
                aria-label="Highlight color hex"
                value={(flick.headlineColor ?? headlineSwatch).toUpperCase()}
                onChange={(event) => {
                  const next = event.target.value.trim();
                  edit({ ...flick, headlineColor: next ? (next.startsWith("#") ? next : `#${next}`) : undefined });
                }}
              />
            </span>
          </label>
          <label className="stack">
            <span>Title stroke</span>
            <p className="muted tiny">A thicker stroke makes the title easier to read.</p>
            <span className="stroke-line">
              <input
                type="range"
                min={0}
                max={12}
                aria-label="Title stroke"
                value={titleStroke}
                onChange={(event) => edit({ ...flick, titleStroke: Number(event.target.value) }, "replace")}
              />
              <input
                className="field stroke-num"
                type="number"
                min={0}
                max={12}
                aria-label="Title stroke amount"
                value={titleStroke}
                onChange={(event) =>
                  edit({ ...flick, titleStroke: Math.min(12, Math.max(0, Number(event.target.value) || 0)) })
                }
              />
            </span>
          </label>
          <div className="toggle-line">
            <span>Show the rank number</span>
            <button
              type="button"
              className={flick.showRank === false ? "switch" : "switch on"}
              role="switch"
              aria-checked={flick.showRank !== false}
              aria-label="Show the rank number"
              onClick={() => edit({ ...flick, showRank: flick.showRank === false })}
            />
          </div>
          <div className="toggle-line">
            <span>Show captions</span>
            <button
              type="button"
              className={flick.showCaptions === false ? "switch" : "switch on"}
              role="switch"
              aria-checked={flick.showCaptions !== false}
              aria-label="Show captions"
              onClick={() => edit({ ...flick, showCaptions: flick.showCaptions === false })}
            />
          </div>
          <StyleFields
            font={flick.titleFont}
            lineSize={flick.lineSize}
            lineColor={flick.lineColor}
            warmth={flick.pictureWarmth}
            pasted={pasted}
            pasteHint="One caption per cut, from the selected cut forward."
            onFont={(face) => edit({ ...flick, titleFont: storedTitleFont(face) })}
            onLineSize={(size) => edit({ ...flick, lineSize: lineSizeOf(size) }, "replace")}
            onLineColor={(next) => edit({ ...flick, lineColor: next })}
            onWarmth={(value) => edit({ ...flick, pictureWarmth: storedWarmth(warmthOf(value)) }, "replace")}
            onPasted={setPasted}
            onPaste={pasteLines}
          />
          <WhichClip
            clips={flick.clips.flatMap((clip): AssistClip[] => {
              const asset = media.find((item) => item.id === clip.mediaId);
              const line = spokenLine(clip.line, asset?.name);
              if (clip.label === "Loop" && !clip.mediaId && !line) return [];
              const fromFile = asset ? shelfName(asset.name).title : "";
              const name = line || fromFile || clip.label.trim() || "Clip";
              if (!clip.mediaId && !line && !clip.label.trim()) return [];
              return [
                {
                  id: clip.id,
                  name,
                  line,
                  lengthSec: clipDuration(clip),
                  date: asset?.madeAt ? whenPhrase("Made", asset.madeAt) ?? "no date" : "no date",
                },
              ];
            })}
            disabled={Boolean(busy)}
            onHeadline={(headline) => {
              const current = flickRef.current;
              if (current) edit({ ...current, headline });
            }}
            onTitle={(id, title) => {
              const current = flickRef.current;
              if (!current) return;
              edit({
                ...current,
                clips: current.clips.map((clip) => (clip.id === id ? { ...clip, line: title } : clip)),
              });
            }}
          />
          <div className="row">
            <button
              className="btn-small btn"
              disabled={!selectedRegion}
              onClick={() => selectedRegion && edit({ ...flick, regions: fullFrame(flick.regions, selectedRegion) })}
            >
              Full frame
            </button>
            <button className="btn-small btn" onClick={() => edit({ ...flick, regions: splitEvenly(flick.regions) })}>
              Split evenly
            </button>
          </div>
          <div className="row">
            <button className="btn-small btn lane-history" disabled={pastCount === 0} onClick={undo}>
              Undo
            </button>
            <button className="btn-small btn lane-history" disabled={futureCount === 0} onClick={redo}>
              Redo
            </button>
            <button className="btn-small lane-split" onClick={splitAtPlayhead}>
              Split
            </button>
            <button
              className="btn-small btn"
              disabled={!selected}
              onClick={() => selected && edit({ ...flick, clips: moveClip(flick.clips, selected.id, -1) })}
            >
              Earlier
            </button>
            <button
              className="btn-small btn"
              disabled={!selected}
              onClick={() => selected && edit({ ...flick, clips: moveClip(flick.clips, selected.id, 1) })}
            >
              Later
            </button>
          </div>
          {selected ? (
            <>
              <label className="stack">
                <span>Label</span>
                <input
                  className="field"
                  value={selected.label}
                  onChange={(event) =>
                    edit({
                      ...flick,
                      clips: flick.clips.map((clip) => (clip.id === selected.id ? { ...clip, label: event.target.value } : clip)),
                    })
                  }
                />
              </label>
              <label className="stack">
                <span>Caption</span>
                <textarea
                  className="field"
                  rows={3}
                  aria-label="Caption"
                  value={selected.line ?? ""}
                  onChange={(event) =>
                    edit({
                      ...flick,
                      clips: flick.clips.map((clip) => (clip.id === selected.id ? { ...clip, line: event.target.value } : clip)),
                    })
                  }
                />
              </label>
              <label className="stack">
                <span>Link</span>
                <span className="link-line">
                  <input
                    className="field"
                    value={selected.sourceUrl ?? ""}
                    placeholder="Paste a link"
                    onChange={(event) =>
                      edit({
                        ...flick,
                        clips: flick.clips.map((clip) =>
                          clip.id === selected.id ? { ...clip, sourceUrl: event.target.value } : clip,
                        ),
                      })
                    }
                  />
                  <button className="btn-small btn" disabled={Boolean(busy)} onClick={() => void getLink()}>
                    Get
                  </button>
                </span>
              </label>
              <div className="cut-own">
                <p>{selectedTrackName} · this cut</p>
                <p className="cut-own-range">
                  In {clock(selected.inSec)} · Out {clock(selected.outSec)} · {lengthLabel(clipDuration(selected))} long
                </p>
              </div>
              <div className="row">
                <label className="stack">
                  <span>In</span>
                  <input
                    className="field"
                    type="number"
                    min={0}
                    step="0.1"
                    value={selected.inSec}
                    onChange={(event) =>
                      edit({
                        ...flick,
                        clips: trimClip(flick.clips, selected.id, "in", Number(event.target.value), mediaLimit(media, selected.mediaId)),
                      })
                    }
                  />
                </label>
                <label className="stack">
                  <span>Out</span>
                  <input
                    className="field"
                    type="number"
                    min={0}
                    step="0.1"
                    value={selected.outSec}
                    onChange={(event) =>
                      edit({
                        ...flick,
                        clips: trimClip(flick.clips, selected.id, "out", Number(event.target.value), mediaLimit(media, selected.mediaId)),
                      })
                    }
                  />
                </label>
              </div>
              <p className="muted">In and out are this cut. They stay inside the file{mediaLimit(media, selected.mediaId) ? ` (${mediaLimit(media, selected.mediaId)?.toFixed(1)}s)` : ""}.</p>
              <label className="stack">
                <span>Write line with</span>
                <select className="field" value={chatId} onChange={(event) => setChatId(event.target.value)}>
                  <option value="">Choose</option>
                  {connections
                    .filter((row) => row.kind !== "elevenlabs" && row.kind !== "minimax")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                        {row.connected ? "" : " (not tested)"}
                      </option>
                    ))}
                </select>
              </label>
              <div className="row">
                <button className="btn" disabled={Boolean(busy)} onClick={() => void runLine()}>
                  Write line
                </button>
              </div>
              <div className="row">
                <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void addSound()}>
                  Add sound
                </button>
                {selected.soundRelative ? (
                  <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void removeSound()}>
                    Remove sound
                  </button>
                ) : null}
              </div>
              <p className="muted tiny">
                {selected.soundRelative
                  ? "This cut has a sound. It plays once at the start, under the voice. Add sound again to replace it."
                  : "Add sound copies one local file and plays it once at the start of this cut, under the voice."}
              </p>
              <button
                className="btn-danger"
                onClick={() => {
                  edit({ ...flick, clips: deleteClip(flick.clips, selected.id) });
                  setSelectedClip(null);
                }}
              >
                Delete cut
              </button>
            </>
          ) : (
            <p className="muted">Select a cut on its lane. Split cuts it at the playhead. Delete closes the gap.</p>
          )}
          <div className="row">
            <button className="btn" disabled={Boolean(busy)} onClick={() => void addMusic()}>
              Add music
            </button>
            {flick.musicId ? (
              <button className="btn" onClick={() => edit({ ...flick, musicId: undefined, musicCredit: undefined })}>
                Remove music
              </button>
            ) : null}
          </div>
          {flick.musicId ? (
            <>
              <p className="tiny">{media.find((item) => item.id === flick.musicId)?.name ?? "Music"}</p>
              <label className="stack">
                <span>Credit</span>
                <input
                  className="field"
                  value={flick.musicCredit ?? ""}
                  placeholder="Artist, track"
                  onChange={(event) => edit({ ...flick, musicCredit: event.target.value.trim() ? event.target.value : undefined })}
                />
              </label>
            </>
          ) : null}
          {shelf.some((item) => item.kind === "audio") ? (
            <div className="stack">
              <p className="rail-label">Used music</p>
              {shelf
                .filter((item) => item.kind === "audio")
                .map((item) => (
                  <button key={item.id} className="btn" onClick={() => void useSaved(item.id)}>
                    {item.name}
                    {item.credit ? ` · ${item.credit}` : ""}
                  </button>
                ))}
            </div>
          ) : null}
          <p className="muted">
            Save vertical video makes the phone video, with the clips, the words, and the voice. Export top picture, under More, keeps only the top picture.
          </p>
          <button className="btn" onClick={() => setSavingTemplate(true)}>
            Save as template
          </button>
        </aside>
        <div
          className="pane-split pane-split-h"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Timeline height"
          aria-valuemin={TIMELINE_MIN}
          aria-valuenow={panes.timeline ?? undefined}
          tabIndex={0}
          title="Drag to resize the timeline"
          onPointerDown={(event) => beginPaneDrag(event, "timeline")}
          onKeyDown={(event) => nudgePane(event, "timeline")}
        />
        <section className="timeline" aria-label="Clipping lane" ref={timelineRef}>
          <div className="lane-transport">
            <button type="button" className="btn lane-play" onClick={() => playerRef.current?.toggle()}>
              {playing ? "Pause" : "Play"}
            </button>
            <span className="lane-clock">
              {clock(playhead)} / {clock(seconds)}
            </span>
            <div className="lane-edits">
              <button className="lane-split" onClick={splitAtPlayhead}>
                Split
              </button>
              <button className="btn lane-history" disabled={pastCount === 0} onClick={undo}>
                Undo
              </button>
              <button className="btn lane-history" disabled={futureCount === 0} onClick={redo}>
                Redo
              </button>
            </div>
            <p className="lane-range">
              {selected ? (
                <>
                  <strong>{selectedTrackName}</strong>
                  {` · this cut · In ${clock(selected.inSec)} · Out ${clock(selected.outSec)}`}
                </>
              ) : (
                "Select a cut. In and out belong to that cut."
              )}
            </p>
          </div>
          <div
            className="lane-stack"
            style={{ ["--at" as string]: String(Math.min(1, Math.max(0, playhead / seconds))) }}
          >
            <div className="playhead-rule" title="Playhead" />
            <div className="track-row" data-lane="Time">
              <div className="lane-plate">
                <span className="lane-plate-name">Time</span>
                <span className="lane-plate-role">Drag</span>
              </div>
              <div className="lane" title="Drag the playhead" onPointerDown={beginScrub} style={{ cursor: "ew-resize" }}>
                {[0, 0.25, 0.5, 0.75, 1].map((mark) => (
                  <span
                    key={mark}
                    style={{
                      position: "absolute",
                      left: `${mark * 100}%`,
                      top: 6,
                      fontSize: 11,
                      fontWeight: 650,
                      color: "#5c564c",
                      transform: mark === 0 ? "none" : mark === 1 ? "translateX(-100%)" : "translateX(-50%)",
                      pointerEvents: "none",
                    }}
                  >
                    {clock(seconds * mark)}
                  </span>
                ))}
              </div>
            </div>
            {flick.tracks.map((track) => {
              const clips = flick.clips.filter((clip) => clip.trackId === track.id).sort((a, b) => a.startSec - b.startSec);
              const laneClass = laneKind(track.name);
              const laneSelected = selected?.trackId === track.id;
              const plateName = laneTitle(track.name, kind);
              return (
                <div className={laneSelected ? `track-row lane-${laneClass} is-selected` : `track-row lane-${laneClass}`} key={track.id} data-lane={plateName}>
                  <button
                    type="button"
                    className="lane-plate"
                    aria-pressed={track.muted}
                    aria-label={track.muted ? `${plateName} muted` : `${plateName} heard`}
                    title={track.muted ? `Hear ${plateName}` : `Mute ${plateName}`}
                    onClick={() =>
                      edit({
                        ...flick,
                        tracks: flick.tracks.map((item) => (item.id === track.id ? { ...item, muted: !item.muted } : item)),
                      })
                    }
                  >
                    <span className="lane-plate-name">{plateName}</span>
                    <span className="lane-plate-role">{track.muted ? "Muted" : "Heard"}</span>
                  </button>
                  <div className="lane" onClick={(event) => seekLane(event.currentTarget, event.clientX)}>
                    {clips.map((clip) => (
                      <button
                        key={clip.id}
                        className={clip.id === selectedClip ? "clip-block on" : "clip-block"}
                        style={{
                          left: `${(clip.startSec / seconds) * 100}%`,
                          width: `${(clipDuration(clip) / seconds) * 100}%`,
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          const handle = (event.target as HTMLElement).classList.contains("handle");
                          if (!handle) {
                            const lane = event.currentTarget.parentElement;
                            if (lane) seekLane(lane, event.clientX);
                          }
                          setSelectedClip(clip.id);
                          setSelectedRegion(
                            visibleSelection(
                              flick.regions,
                              flick.clips,
                              flick.regions.find((region) => region.trackId === clip.trackId)?.id ?? null,
                            ),
                          );
                        }}
                      >
                        <span className="handle left" onPointerDown={(event) => beginTrim(event, clip, "in")} />
                        {clip.id === selectedClip ? <span className="cut-mark cut-in">In</span> : null}
                        <span className="clip-title">
                          {blockTitle(clip.label, media.find((item) => item.id === clip.mediaId)?.name)}
                        </span>
                        {voiceUrl && clip.id === voiceOwner ? (
                          <button
                            type="button"
                            className="cut-hear"
                            onClick={(event) => {
                              event.stopPropagation();
                              const node = voiceAudio.current;
                              if (!node) return;
                              node.currentTime = 0;
                              void node.play();
                            }}
                          >
                            Hear it
                          </button>
                        ) : null}
                        {clip.id === selectedClip ? <span className="cut-mark cut-out">Out</span> : null}
                        <span className="handle right" onPointerDown={(event) => beginTrim(event, clip, "out")} />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {headlineText || wordClips.length ? (
              <div className="track-row words-row">
                <div className="lane-plate">
                  <span className="lane-plate-name">Captions</span>
                  <span className="lane-plate-role">On the phone</span>
                </div>
                <div
                  className="lane words-lane"
                  style={{ height: wordsLaneHeight }}
                  onClick={(event) => seekLane(event.currentTarget, event.clientX)}
                >
                  {headlineText ? (
                    <div className="word-span word-headline" title={headlineText}>
                      <span className="word-who">Headline</span>
                      <span className="word-line">{headlineText}</span>
                    </div>
                  ) : null}
                  {wordClips.map(({ clip, text }) => {
                    const track = flick.tracks.find((item) => item.id === clip.trackId);
                    const trackIndex = Math.max(0, wordTrackIds.indexOf(clip.trackId));
                    const wordKind = laneKind(track?.name ?? "");
                    return (
                      <div
                        key={clip.id}
                        className={clip.id === selectedClip ? `word-span word-${wordKind} on` : `word-span word-${wordKind}`}
                        title={`${laneTitle(track?.name ?? "", kind)} · ${text}`}
                        style={{
                          left: `${(clip.startSec / seconds) * 100}%`,
                          width: `${Math.max((clipDuration(clip) / seconds) * 100, 0)}%`,
                          top: (headlineText ? 30 : 8) + trackIndex * 26,
                        }}
                      >
                        <span className="word-who">{laneTitle(track?.name ?? "", kind)}</span>
                        <span className="word-line">
                          {text}
                          {clip.id === selectedClip ? ` · In ${clock(clip.inSec)} · Out ${clock(clip.outSec)}` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <p className="lane-note">
            {kind === "ranking"
              ? "These lanes are Clips, Background, and Captions."
              : kind === "dual"
                ? "These lanes are Face, Gameplay, and Captions."
                : kind === "split"
                  ? "These lanes are Top, Bottom, and Captions."
                  : "This lane is the video. Captions sit under it."}
          </p>
        </section>
      </div>
      {savingTemplate ? (
        <div className="modal-back">
          <div className="modal panel stack">
            <h2>Save as template</h2>
            <p className="muted">Saves this seam, this text, this order, and these cuts. The videos stay in the channel. Built-in templates stay as they shipped.</p>
            <label className="stack">
              <span>Name</span>
              <input className="field" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
            </label>
            <label className="stack">
              <span>Replace one you saved</span>
              <select className="field" value={replaceId} onChange={(event) => setReplaceId(event.target.value)}>
                <option value="">Save as new</option>
                {templates
                  .filter((template) => !template.builtin)
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="actions">
              <button className="btn-primary" onClick={() => void saveTemplate()}>
                Save template
              </button>
              <button className="btn" onClick={() => setSavingTemplate(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  function seekLane(lane: HTMLElement, clientX: number) {
    if (!flick) return;
    const bounds = lane.getBoundingClientRect();
    const ratio = (clientX - bounds.left) / Math.max(bounds.width, 1);
    const next = Math.min(1, Math.max(0, ratio)) * seconds;
    const frame = Math.max(0, Math.min(frames - 1, Math.round(next * flick.fps)));
    playerRef.current?.seekTo(frame);
    setPlayhead(frame / flick.fps);
  }

  function beginScrub(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const lane = event.currentTarget;
    seekLane(lane, event.clientX);
    const move = (ev: PointerEvent) => seekLane(lane, ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginTrim(event: React.PointerEvent, clip: Clip, edge: "in" | "out") {
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    const startIn = clip.inSec;
    const startOut = clip.outSec;
    const limit = mediaLimit(media, clip.mediaId);
    const lane = (event.currentTarget.parentElement?.parentElement as HTMLElement | null)?.getBoundingClientRect();
    const width = lane?.width || 1;
    let pushed = false;
    const move = (ev: PointerEvent) => {
      const current = flickRef.current;
      if (!current) return;
      const delta = ((ev.clientX - startX) / width) * Math.max(timelineEnd(current.clips), 1);
      const value = edge === "in" ? startIn + delta : startOut + delta;
      edit({ ...current, clips: trimClip(current.clips, clip.id, edge, value, limit) }, pushed ? "replace" : "push");
      pushed = true;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
