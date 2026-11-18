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
import { clipDuration, storedVoiceStart, timelineEnd, uid, type CallResult, type Clip, type ConnectionPublic, type Flick, type ShelfEntry, type Template } from "../shared/model";
import type { ResolvedMedia } from "../shared/api";
import type { AssistClip } from "../shared/assist";
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

function laneKind(name: string): LaneKind {
  const key = name.trim().toLowerCase();
  if (key === "rank" || key === "top") return "rank";
  if (key === "loop" || key === "bottom") return "loop";
  if (key === "face") return "face";
  if (key === "gameplay") return "game";
  if (key === "video") return "video";
  return "other";
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
  const [accent, setAccent] = useState("#e2b340");
  const [channelName, setChannelName] = useState("");
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
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
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [replaceId, setReplaceId] = useState("");
  const [pasted, setPasted] = useState("");
  const playerRef = useRef<PlayerRef>(null);
  const flickRef = useRef<Flick | null>(null);
  const dirty = useRef(false);
  const saveChain = useRef(Promise.resolve());
  const saveTimer = useRef(0);
  const saveWave = useRef(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const past = useRef<Flick[]>([]);
  const future = useRef<Flick[]>([]);
  const [pastCount, setPastCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);

  function remember(nextPast: Flick[], nextFuture: Flick[]) {
    past.current = nextPast;
    future.current = nextFuture;
    setPastCount(nextPast.length);
    setFutureCount(nextFuture.length);
  }

  useEffect(() => {
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
      })),
    };
  }, [flick, media, accent, voiceUrl]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!flick) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
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
    if (!current || !chosen) return;
    if (!voiceId) {
      setMessage("Add and test an ElevenLabs or MiniMax connection first.");
      return;
    }
    const startSec = chosen.startSec;
    setBusy("Making voice…");
    const result = await window.flicks!.makeVoice(voiceId, dir, current.id, chosen.line || chosen.label, startSec);
    setBusy("");
    if (!result.ok) {
      setMessage(result.message ?? "Voice failed.");
      return;
    }
    const previewUrl = "previewUrl" in result ? (result.previewUrl as string | undefined) : undefined;
    if (previewUrl) setVoiceUrl(previewUrl);
    const latest = flickRef.current ?? current;
    edit({ ...latest, voiceRelative: "voice.mp3", voiceStartSec: storedVoiceStart(startSec) });
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
    const primed = await flushSave(dir);
    if (!primed.ok) {
      setMessage(primed.message || "Could not save the flick before export.");
      return;
    }
    const output = await window.flicks!.pickSave(exportSavePath(dir, named.name));
    if (!output) return;
    const flushed = await flushSave(dir);
    if (!flushed.ok) {
      setMessage(flushed.message || "Could not save the flick before export.");
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
      setMessage(result.ok ? `Saved ${output}` : result.message ?? "Export failed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy("");
    }
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
  const selectedTrackName = flick.tracks.find((track) => track.id === selected?.trackId)?.name.trim() || "This cut";
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
          aria-label="Flick name"
          value={flick.name}
          onChange={(event) => edit({ ...flick, name: event.target.value })}
        />
        <span className="muted tiny">Encoder: {encoder}</span>
        <span className="spacer" />
        <button className="btn" onClick={onConnections}>
          Connections
        </button>
        {DESK_TEMPLATES.has(flick.templateId ?? "") ? (
          <button type="button" className="btn" onClick={() => onOpenDesk?.()}>
            Desk
          </button>
        ) : null}
        <button
          className="btn"
          title="Writes the top picture. Captions, headlines, ranks, and clip audio are not in that file. Sound is the voice and the music."
          aria-label="Export top picture"
          disabled={encoder === "ffmpeg missing" || Boolean(busy)}
          onClick={() => void exportFlick("cut")}
        >
          Export top picture
        </button>
        <button className="btn-primary" disabled={Boolean(busy)} onClick={() => void exportFlick("styled")}>
          Export styled
        </button>
      </header>
      {busy ? <p className="banner">{busy}</p> : message ? <p className="banner">{message}</p> : null}
      <div className="workspace">
        <aside className="rail shelf-rail">
          <div className="shelf-sticky">
            <div className="shelf-head">
              <h2>Clips</h2>
              <p className="shelf-purpose">Place these on the timeline.</p>
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
                      const where = track.name.trim() || "Track";
                      const placeLabel = flick.tracks.length === 1 ? "Place" : `Place · ${where}`;
                      return (
                        <button
                          key={track.id}
                          type="button"
                          className={selectedHere ? "btn shelf-place on" : "btn shelf-place"}
                          title={`Fills the selected cut on ${where}, or the first empty cut. If that track is already full, this adds a cut at the end.`}
                          onClick={() => void addToTrack(asset, track.id, "place")}
                        >
                          {placeLabel}
                        </button>
                      );
                    })}
                  </div>
                  <div className="shelf-places">
                    {flick.tracks.map((track) => {
                      const where = track.name.trim() || "Track";
                      const appendLabel = flick.tracks.length === 1 ? "Append" : `Append · ${where}`;
                      return (
                        <button
                          key={track.id}
                          type="button"
                          className="btn shelf-place"
                          title={`Adds this clip after the last cut on ${where}.`}
                          onClick={() => void addToTrack(asset, track.id, "append")}
                        >
                          {appendLabel}
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
        <aside className="inspector stack">
          <p className="tiny muted">Canvas</p>
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
            <p className="muted tiny">Saved on the flick. The paper pill keeps the words clear.</p>
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
                    .filter((row) => row.kind !== "elevenlabs")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                        {row.connected ? "" : " (not tested)"}
                      </option>
                    ))}
                </select>
              </label>
              <label className="stack">
                <span>Voice with</span>
                <select className="field" value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
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
              <div className="row">
                <button className="btn" disabled={Boolean(busy)} onClick={() => void runLine()}>
                  Write line
                </button>
                <button className="btn" disabled={Boolean(busy)} onClick={() => void runVoice()}>
                  Make voice
                </button>
              </div>
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
            Export top picture keeps the top picture. Captions, headlines, ranks, and clip audio are not in that file. Its sound is the voice and the music. Export styled plays the clips as well.
          </p>
          <button className="btn" onClick={() => setSavingTemplate(true)}>
            Save as template
          </button>
          {flick.voiceRelative ? <p className="tiny muted">Voice is on this flick.</p> : null}
        </aside>
        <section className="timeline" aria-label="Clipping lane">
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
              const kind = laneKind(track.name);
              const laneSelected = selected?.trackId === track.id;
              const plateName = track.name.trim() || "Track";
              return (
                <div className={laneSelected ? `track-row lane-${kind} is-selected` : `track-row lane-${kind}`} key={track.id} data-lane={plateName}>
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
                  <span className="lane-plate-name">Words</span>
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
                    const kind = laneKind(track?.name ?? "");
                    return (
                      <div
                        key={clip.id}
                        className={clip.id === selectedClip ? `word-span word-${kind} on` : `word-span word-${kind}`}
                        title={`${track?.name ?? "Caption"} · ${text}`}
                        style={{
                          left: `${(clip.startSec / seconds) * 100}%`,
                          width: `${Math.max((clipDuration(clip) / seconds) * 100, 0)}%`,
                          top: (headlineText ? 30 : 8) + trackIndex * 26,
                        }}
                      >
                        <span className="word-who">{track?.name.trim() || "Caption"}</span>
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
          <p className="lane-note">A flick shows its own lanes: Rank and Loop, or Face and Gameplay, or Video alone.</p>
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
