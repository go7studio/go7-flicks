import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  accentOnPaper,
  assignLinesInOrder,
  builtinTemplates,
  flickFromTemplate,
  importedLines,
  LINE_SIZE_MAX,
  LINE_SIZE_MIN,
  lineColorOf,
  lineSizeOf,
  overlayPlaceOf,
  playbackOrder,
  RANK_SIZE_DEFAULT,
  RANK_SIZE_MAX,
  RANK_SIZE_MIN,
  rankColorOf,
  rankSizeOf,
  rankingClipRange,
  readableOn,
  shuffleIds,
  slotRank,
  spokenLine,
  storedLineColor,
  storedLineSize,
  storedOverlayPlace,
  storedRankColor,
  storedRankSize,
  storedTitleFont,
  storedWarmth,
  type OverlayPlace,
  titleFontFamily,
  titleFontOf,
  warmthOf,
  warmthWash,
  fullFrame,
  type PlaybackMode,
} from "../shared/canvas";
import { round3, uid, type Clip, type Flick, type Template } from "../shared/model";
import type { ResolvedMedia } from "../shared/api";
import { captionFromFile, headlineFromFlick, openDeskFlick, titleFromClip } from "../remotion/FlickComposition";
import type { AssistClip } from "../shared/assist";
import { fitHandRange, fitRankingSlots, formatClock, nextSequenceRange, playbackSentence, rankingStartId, rankingStep, setHandLength, shiftHandRange, slotListTitle, slotTimeLine } from "../shared/desk";
import { clipLink } from "../shared/link";
import { placeFoundClips, SUBJECT_CLIP_COUNT, subjectLine } from "../shared/subject";
import { whenPhrase } from "../shared/when";
import "./polish-desks.css";
import { StyleFields } from "./StyleFields";
import { WhichClip } from "./WhichClip";

type Slot = {
  id: string;
  rank: number;
  title: string;
  note: string;
  inSec: number;
  outSec: number;
  duration: number;
  mediaId: string | null;
  mediaName: string;
  madeAt?: string;
  previewUrl: string | null;
  focus: number;
  /** An empty slot someone asked for, so a later tidy does not remove it. */
  keepEmpty?: boolean;
};

const RANKING_HEADLINE = "Ranking the funniest\ncartoon moments";

function makeSlots(count: number): Slot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: uid(),
    rank: slotRank(undefined, index, count),
    title: "",
    note: "",
    inSec: 0,
    outSec: 3,
    duration: 0,
    mediaId: null,
    mediaName: "",
    previewUrl: null,
    focus: 0.5,
  }));
}

function renumberSlots(rows: Slot[]): Slot[] {
  return rows.map((item, index) => ({
    ...item,
    rank: slotRank(undefined, index, rows.length),
  }));
}

function deckTarget(mode: "file" | "cut", item: Slot): number {
  return mode === "cut" ? Math.max(0, item.inSec) : 0;
}

function waitFor(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener(event, done);
      resolve();
    };
    video.addEventListener(event, done);
  });
}

function uploadNote(message: string | undefined): string {
  const line = (message ?? "").replace(/\s+/g, " ").trim();
  if (!line || line === "No file chosen." || line === "No clip chosen.") return "Upload canceled.";
  return line.length > 80 ? "Could not add that file." : line;
}

function linkNote(message: string | undefined): string {
  const line = (message ?? "").replace(/\s+/g, " ").trim();
  if (!line || line === "No file chosen.") return "Could not get that clip.";
  return line.length > 80 ? "Could not get that clip." : line;
}

function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

function deskStorageKey(channelDir?: string): string {
  return `go7-flicks-desk:${channelDir || "none"}:ranking`;
}

/** Window session, same idea as the canvas timeline height. */
const RANK_CLIPS_KEY = "go7-ranking-clips";
/** Slot controls plus one full clip row. The handle sits outside this. */
const RANK_CLIPS_MIN = 176;
const RANK_CLIPS_HANDLE = 12;
/** Play order keeps a strip when the clips list is dragged open. */
const RANK_CLIPS_REST_MIN = 96;

function clampRankClips(height: number, railHeight: number): number {
  const max = Math.max(RANK_CLIPS_MIN, Math.round(railHeight - RANK_CLIPS_HANDLE - RANK_CLIPS_REST_MIN));
  const value = Number.isFinite(height) ? height : RANK_CLIPS_MIN;
  return Math.round(Math.min(max, Math.max(RANK_CLIPS_MIN, value)));
}

function readRankClips(): number | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(RANK_CLIPS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { height?: unknown };
    const height = Number(parsed.height);
    if (!Number.isFinite(height)) return null;
    return clampRankClips(height, 4000);
  } catch {
    return null;
  }
}

function rememberRankClips(height: number) {
  try {
    sessionStorage.setItem(RANK_CLIPS_KEY, JSON.stringify({ height }));
  } catch {
    /* This window may block storage. The drag still works until reload. */
  }
}

/** Look and More start closed. This window remembers which one the person opened. */
const RANK_SECTIONS_KEY = "go7-ranking-sections";

function readRankSections(): { look: boolean; more: boolean } {
  try {
    if (typeof sessionStorage === "undefined") return { look: false, more: false };
    const raw = sessionStorage.getItem(RANK_SECTIONS_KEY);
    if (!raw) return { look: false, more: false };
    const parsed = JSON.parse(raw) as { look?: unknown; more?: unknown };
    return { look: parsed.look === true, more: parsed.more === true };
  } catch {
    return { look: false, more: false };
  }
}

function rememberRankSections(next: { look: boolean; more: boolean }) {
  try {
    sessionStorage.setItem(RANK_SECTIONS_KEY, JSON.stringify({ look: next.look === true, more: next.more === true }));
  } catch {
    /* This window may block storage. The sections still open until reload. */
  }
}

type RankingDraft = {
  headline?: string;
  accentWords?: string;
  color?: string;
  stroke?: number;
  showRank?: boolean;
  showCaptions?: boolean;
  font?: string;
  lineSize?: number;
  lineColor?: string;
  rankSize?: number;
  rankColor?: string;
  rankPlace?: OverlayPlace;
  linePlace?: OverlayPlace;
  warmth?: number;
  pasted?: string;
  subject?: string;
  playback?: PlaybackMode;
  orderIds?: string[];
  slots?: Slot[];
  selected?: number;
  dir?: string | null;
};

function readRankingDraft(channelDir?: string): RankingDraft | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(deskStorageKey(channelDir));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RankingDraft;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.slots)) return null;
    if (!parsed.slots.every((item) => item && typeof item.id === "string" && typeof item.title === "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function slotsFromFlick(flick: Flick, media: ResolvedMedia[]): Slot[] {
  const ranked = flick.clips
    .filter((clip) => clip.label !== "Loop" && clip.trackId !== "track-bottom")
    .slice()
    .sort((a, b) => a.startSec - b.startSec);
  const count = ranked.length;
  return fitRankingSlots(
    ranked.map((clip, index) => {
      const asset = media.find((item) => item.id === clip.mediaId);
      const duration = asset && asset.durationSec > 0 ? asset.durationSec : 0;
      return {
        id: uid(),
        rank: slotRank(clip.label, index, count),
        title: clip.line ?? "",
        note: clip.sourceUrl ?? "",
        inSec: clip.inSec,
        outSec: clip.outSec,
        duration,
        mediaId: clip.mediaId,
        mediaName: asset?.name ?? "",
        madeAt: asset?.madeAt,
        previewUrl: asset?.previewUrl ?? null,
        focus: typeof clip.focus === "number" ? clip.focus : 0.5,
      };
    }),
  );
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

export function RankingStudio({
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
  const [headline, setHeadline] = useState(RANKING_HEADLINE);
  const [accentWords, setAccentWords] = useState("funniest");
  const [color, setColor] = useState("#e2b340");
  const [stroke, setStroke] = useState(6);
  const [showRank, setShowRank] = useState(true);
  const [showCaptions, setShowCaptions] = useState(true);
  const [font, setFont] = useState("Segoe UI");
  const [lineSize, setLineSize] = useState(72);
  const [lineColor, setLineColor] = useState("#ffffff");
  const [rankSize, setRankSize] = useState(RANK_SIZE_DEFAULT);
  const [rankColor, setRankColor] = useState("#e2b340");
  const [rankPlace, setRankPlace] = useState<OverlayPlace>("top");
  const [linePlace, setLinePlace] = useState<OverlayPlace>("bottom");
  const [warmth, setWarmth] = useState(0);
  const [pasted, setPasted] = useState("");
  const [subject, setSubject] = useState("");
  const [linkText, setLinkText] = useState("");
  const [addNote, setAddNote] = useState("");
  const [playback, setPlayback] = useState<PlaybackMode>("countdown");
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slot[]>(() => makeSlots(5));
  const [selected, setSelected] = useState(0);
  const [message, setMessageState] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipes, setRecipes] = useState<Template[]>([]);
  const [clipsHeight, setClipsHeight] = useState<number | null>(readRankClips);
  const [sectionMemory] = useState(() => readRankSections());
  const [more, setMore] = useState(sectionMemory.more);
  const [look, setLook] = useState(sectionMemory.look);
  const [playing, setPlaying] = useState(false);
  const [playKind, setPlayKind] = useState<"ranking" | "clip" | null>(null);
  const [looping, setLooping] = useState(false);
  const [nowSec, setNowSec] = useState(0);
  const [liveFace, setLiveFace] = useState<0 | 1>(0);
  const slot = slots[selected];

  useEffect(() => {
    const next = fitRankingSlots(slots);
    if (next === slots) return;
    setSlots(next);
    setSelected((index) => (next.length ? Math.min(Math.max(0, index), next.length - 1) : 0));
  }, [slots]);

  useEffect(() => {
    rememberRankSections({ look, more });
  }, [look, more]);
  const deckA = useRef<HTMLVideoElement>(null);
  const deckB = useRef<HTMLVideoElement>(null);
  const liveDeck = useRef<0 | 1>(0);
  const deckMeta = useRef<Array<{ slotId: string; url: string } | null>>([null, null]);
  const prepGen = useRef<[number, number]>([0, 0]);
  const wantPlay = useRef(false);
  const playAll = useRef(false);
  const playQueue = useRef<string[]>([]);
  const holding = useRef(false);
  const skipPark = useRef(false);
  const span = useRef<"file" | "cut">("file");
  const loopCut = useRef(false);
  const readySlot = useRef<string | null>(null);
  const frameWatch = useRef(0);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const noteTimer = useRef(0);
  const messageTimer = useRef(0);
  const headlineRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      window.clearTimeout(noteTimer.current);
      window.clearTimeout(messageTimer.current);
    },
    [],
  );
  const railRef = useRef<HTMLElement>(null);
  const clipsPaneRef = useRef<HTMLDivElement>(null);
  const clipsHeightRef = useRef(clipsHeight);
  clipsHeightRef.current = clipsHeight;
  const keepDraft = useRef(true);
  const draftKey = deskStorageKey(channelDir);
  const [boundKey, setBoundKey] = useState<string | null>(null);
  const folderLabel = announced || (dir ? folderName(dir) : "");

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const fit = () => {
      const stored = clipsHeightRef.current;
      if (stored == null) return;
      const next = clampRankClips(stored, rail.clientHeight);
      if (next === clipsHeightRef.current) return;
      clipsHeightRef.current = next;
      rememberRankClips(next);
      setClipsHeight(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  function applyClipsHeight(next: number) {
    clipsHeightRef.current = next;
    rememberRankClips(next);
    setClipsHeight(next);
  }

  function beginClipsDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const rail = railRef.current;
    const clips = clipsPaneRef.current;
    if (!rail || !clips) return;
    const originY = event.clientY;
    const start = clips.getBoundingClientRect().height;
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* The listeners below still follow the pointer when capture is unavailable. */
    }
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      // The handle is the top of the clips list. Pointer up grows it toward the top of the window.
      const next = clampRankClips(start - (ev.clientY - originY), rail.clientHeight);
      if (next === clipsHeightRef.current) return;
      applyClipsHeight(next);
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

  function nudgeClips(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    let delta = 0;
    if (event.key === "ArrowUp") delta = step;
    else if (event.key === "ArrowDown") delta = -step;
    if (!delta) return;
    event.preventDefault();
    const rail = railRef.current;
    const clips = clipsPaneRef.current;
    if (!rail || !clips) return;
    const start = clipsHeightRef.current ?? clips.getBoundingClientRect().height;
    applyClipsHeight(clampRankClips(start + delta, rail.clientHeight));
  }

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
      setAnnounced((current) => current || "Ranking");
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
          setHeadline(headlineFromFlick(flick.headline, RANKING_HEADLINE));
          if (flick.headlineColor) setColor(flick.headlineColor);
          if (flick.accentWords !== undefined) setAccentWords(flick.accentWords);
          if (flick.titleStroke !== undefined) setStroke(flick.titleStroke);
          setShowRank(flick.showRank !== false);
          setShowCaptions(flick.showCaptions !== false);
          setFont(titleFontOf(flick.titleFont));
          setLineSize(lineSizeOf(flick.lineSize));
          setLineColor(flick.lineColor && /^#[0-9a-fA-F]{6}$/.test(flick.lineColor) ? flick.lineColor : "#ffffff");
          setRankSize(rankSizeOf(flick.rankSize));
          setRankColor(rankColorOf(flick.rankColor));
          setRankPlace(overlayPlaceOf(flick.rankPlace, "top"));
          setLinePlace(overlayPlaceOf(flick.linePlace, "bottom"));
          setWarmth(warmthOf(flick.pictureWarmth));
          setSlots(slotsFromFlick(flick, result.media ?? []));
          setPlayback("listed");
          setOrderIds([]);
          setSelected(0);
          setDir(channelDir);
        } else if (result.message) {
          flashMessage(result.message);
        }
        if (!cancel) setBoundKey(draftKey);
      });
      return () => {
        cancel = true;
      };
    }
    const stored = readRankingDraft(channelDir);
    if (stored) {
      if (typeof stored.headline === "string") setHeadline(stored.headline);
      if (typeof stored.accentWords === "string") setAccentWords(stored.accentWords);
      if (typeof stored.color === "string") setColor(stored.color);
      if (typeof stored.stroke === "number") setStroke(stored.stroke);
      if (typeof stored.showRank === "boolean") setShowRank(stored.showRank);
      if (typeof stored.showCaptions === "boolean") setShowCaptions(stored.showCaptions);
      if (typeof stored.font === "string") setFont(stored.font);
      if (typeof stored.lineSize === "number") setLineSize(stored.lineSize);
      if (typeof stored.lineColor === "string") setLineColor(stored.lineColor);
      if (typeof stored.rankSize === "number") setRankSize(stored.rankSize);
      if (typeof stored.rankColor === "string") setRankColor(stored.rankColor);
      if (stored.rankPlace === "top" || stored.rankPlace === "middle" || stored.rankPlace === "bottom") setRankPlace(stored.rankPlace);
      if (stored.linePlace === "top" || stored.linePlace === "middle" || stored.linePlace === "bottom") setLinePlace(stored.linePlace);
      if (typeof stored.warmth === "number") setWarmth(stored.warmth);
      if (typeof stored.pasted === "string") setPasted(stored.pasted);
      if (typeof stored.subject === "string") setSubject(stored.subject);
      if (stored.playback === "countdown" || stored.playback === "listed" || stored.playback === "skip" || stored.playback === "shuffle") {
        setPlayback(stored.playback);
      }
      if (Array.isArray(stored.orderIds)) setOrderIds(stored.orderIds.filter((item) => typeof item === "string"));
      if (stored.slots?.length) {
        const fitted = fitRankingSlots(
          stored.slots.map((item) => ({
            id: item.id,
            rank: typeof item.rank === "number" ? item.rank : 1,
            title: item.title ?? "",
            note: typeof item.note === "string" ? item.note : "",
            inSec: typeof item.inSec === "number" ? item.inSec : 0,
            outSec: typeof item.outSec === "number" ? item.outSec : 3,
            duration: typeof item.duration === "number" ? item.duration : 0,
            mediaId: typeof item.mediaId === "string" ? item.mediaId : null,
            mediaName: typeof item.mediaName === "string" ? item.mediaName : "",
            madeAt: typeof item.madeAt === "string" ? item.madeAt : undefined,
            previewUrl: typeof item.previewUrl === "string" ? item.previewUrl : null,
            focus: typeof item.focus === "number" ? item.focus : 0.5,
            keepEmpty: item.keepEmpty === true,
          })),
        );
        setSlots(fitted);
        if (typeof stored.selected === "number") setSelected(fitted.length ? Math.min(stored.selected, fitted.length - 1) : 0);
      } else if (typeof stored.selected === "number") {
        setSelected(stored.selected);
      }
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
      const payload: RankingDraft = {
        headline,
        accentWords,
        color,
        stroke,
        showRank,
        showCaptions,
        font,
        lineSize,
        lineColor,
        rankSize,
        rankColor,
        rankPlace,
        linePlace,
        warmth,
        pasted,
        subject,
        playback,
        orderIds,
        slots,
        selected,
        dir: channelDir || dir,
      };
      sessionStorage.setItem(draftKey, JSON.stringify(payload));
    } catch {
      // The desk still works when the browser refuses the draft.
    }
  }, [
    boundKey,
    draftKey,
    channelDir,
    dir,
    headline,
    accentWords,
    color,
    stroke,
    showRank,
    showCaptions,
    font,
    lineSize,
    lineColor,
    rankSize,
    rankColor,
    rankPlace,
    linePlace,
    warmth,
    pasted,
    subject,
    playback,
    orderIds,
    slots,
    selected,
  ]);

  function nodeAt(index: 0 | 1): HTMLVideoElement | null {
    return index === 0 ? deckA.current : deckB.current;
  }

  function hiddenIndex(): 0 | 1 {
    return liveDeck.current === 0 ? 1 : 0;
  }

  function raise(index: 0 | 1) {
    liveDeck.current = index;
    const front = nodeAt(index);
    const back = nodeAt(index === 0 ? 1 : 0);
    if (front) front.style.zIndex = "1";
    if (back) back.style.zIndex = "0";
    setLiveFace(index);
  }

  async function prepare(index: 0 | 1, item: Slot, mode: "file" | "cut"): Promise<boolean> {
    const video = nodeAt(index);
    if (!video || !item.previewUrl) return false;
    const generation = ++prepGen.current[index];
    const target = deckTarget(mode, item);
    const same = (video.currentSrc || video.src) === item.previewUrl;
    video.style.objectPosition = `${(item.focus ?? 0.5) * 100}% center`;
    if (!same) {
      video.pause();
      video.src = item.previewUrl;
      await waitFor(video, "loadeddata");
    } else if (video.readyState < 2) {
      await waitFor(video, "loadeddata");
    }
    if (prepGen.current[index] !== generation) return false;
    if (Math.abs(video.currentTime - target) >= 0.05) {
      video.pause();
      const seeked = waitFor(video, "seeked");
      video.currentTime = target;
      await seeked;
    }
    if (prepGen.current[index] !== generation) return false;
    deckMeta.current[index] = { slotId: item.id, url: item.previewUrl };
    if (index !== liveDeck.current) video.pause();
    video.muted = false;
    return video.readyState >= 2 && video.videoWidth > 0;
  }

  function deckReady(index: 0 | 1, item: Slot, mode: "file" | "cut"): boolean {
    const video = nodeAt(index);
    if (!video || deckMeta.current[index]?.slotId !== item.id) return false;
    const target = deckTarget(mode, item);
    return video.readyState >= 2 && video.videoWidth > 0 && Math.abs(video.currentTime - target) < 0.08;
  }

  function unlockNext(item: Slot | undefined) {
    if (!item?.previewUrl) return;
    const hidden = hiddenIndex();
    const video = nodeAt(hidden);
    if (!video) return;
    if ((video.currentSrc || video.src) !== item.previewUrl) video.src = item.previewUrl;
    video.muted = true;
    const started = video.play();
    void started
      .then(() => {
        if (liveDeck.current !== hidden) video.pause();
        video.muted = false;
      })
      .catch(() => {
        video.muted = false;
      });
  }

  useEffect(() => {
    if (skipPark.current) {
      skipPark.current = false;
      return;
    }
    const item = slotsRef.current[selected];
    const index = liveDeck.current;
    if (!item?.previewUrl) {
      setPlaying(false);
      setNowSec(0);
      return;
    }
    let cancel = false;
    const mode = span.current;
    void prepare(index, item, mode).then((ok) => {
      if (cancel || !ok) return;
      const video = nodeAt(index);
      if (!video) return;
      readySlot.current = item.id;
      setNowSec(deckTarget(mode, item));
      if (!wantPlay.current) {
        video.pause();
        setPlaying(false);
        return;
      }
      void video.play().then(() => {
        if (cancel) return;
        setPlaying(true);
        preloadUpcoming();
        watchFrames();
      }).catch(() => {
        wantPlay.current = false;
        setPlaying(false);
        setPlayKind(null);
      });
    });
    return () => {
      cancel = true;
    };
  }, [slot?.id, slot?.previewUrl, slot?.inSec, selected]);

  useEffect(() => () => cancelAnimationFrame(frameWatch.current), []);

  function filledIds(): string[] {
    return playbackOrder(slots, playback, orderIds)
      .filter((item) => item.previewUrl)
      .map((item) => item.id);
  }

  function stopSequence() {
    playAll.current = false;
    loopCut.current = false;
    setLooping(false);
    playQueue.current = [];
    holding.current = false;
    cancelAnimationFrame(frameWatch.current);
    setPlayKind(null);
  }

  function watchFrames() {
    cancelAnimationFrame(frameWatch.current);
    const tick = () => {
      const video = nodeAt(liveDeck.current);
      const current = slotsRef.current.find((item) => item.id === readySlot.current);
      if (!video || !current || video.paused || holding.current || !wantPlay.current) return;
      if (span.current === "cut" && video.currentTime + 0.05 < current.inSec) {
        frameWatch.current = requestAnimationFrame(tick);
        return;
      }
      const end = endSec(current, video);
      if (video.currentTime >= end - 0.02) {
        advanceOrStop(current);
        return;
      }
      frameWatch.current = requestAnimationFrame(tick);
    };
    frameWatch.current = requestAnimationFrame(tick);
  }

  function endSec(current: Slot, video: HTMLVideoElement): number {
    if (span.current === "cut") return current.outSec;
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    if (current.duration > 0) return current.duration;
    return current.outSec;
  }

  function nextQueued(): { item: Slot; index: number } | null {
    const rows = slotsRef.current;
    for (const id of playQueue.current) {
      const index = rows.findIndex((item) => item.id === id && item.previewUrl);
      if (index >= 0) return { item: rows[index], index };
    }
    return null;
  }

  function preloadUpcoming() {
    if (!playAll.current) return;
    const next = nextQueued();
    if (!next) return;
    const hidden = hiddenIndex();
    if (deckReady(hidden, next.item, "cut")) return;
    void prepare(hidden, next.item, "cut");
  }

  function cutTo(index: 0 | 1, nextIndex: number) {
    const next = slotsRef.current[nextIndex];
    const nextVideo = nodeAt(index);
    const oldVideo = nodeAt(liveDeck.current);
    if (!next?.previewUrl || !nextVideo || index === liveDeck.current) return;
    const at = playQueue.current.indexOf(next.id);
    if (at >= 0) playQueue.current.splice(0, at + 1);
    holding.current = false;
    skipPark.current = true;
    span.current = "cut";
    wantPlay.current = true;
    readySlot.current = next.id;
    nextVideo.muted = false;
    raise(index);
    setNowSec(Math.max(0, next.inSec));
    setPlayKind("ranking");
    setPlaying(true);
    setSelected(nextIndex);
    void nextVideo.play().catch(() => {
      wantPlay.current = false;
      setPlaying(false);
      setPlayKind(null);
    });
    oldVideo?.pause();
    preloadUpcoming();
    watchFrames();
  }

  async function startPlay(id: string, mode: "file" | "cut") {
    const rows = slotsRef.current;
    const index = rows.findIndex((item) => item.id === id);
    const target = index >= 0 ? rows[index] : undefined;
    if (!target?.previewUrl) return;
    span.current = mode;
    wantPlay.current = true;
    setPlayKind(playAll.current ? "ranking" : "clip");
    if (index !== selected) {
      readySlot.current = null;
      setSelected(index);
      return;
    }
    const videoIndex = liveDeck.current;
    const ok = await prepare(videoIndex, target, mode);
    if (!ok || !wantPlay.current) return;
    const video = nodeAt(videoIndex);
    if (!video) return;
    readySlot.current = target.id;
    setNowSec(deckTarget(mode, target));
    try {
      await video.play();
      setPlaying(true);
      preloadUpcoming();
      watchFrames();
    } catch {
      wantPlay.current = false;
      setPlaying(false);
      setPlayKind(null);
    }
  }

  function pausePreview() {
    stopSequence();
    wantPlay.current = false;
    nodeAt(liveDeck.current)?.pause();
    setPlaying(false);
  }

  function playRanking() {
    loopCut.current = false;
    setLooping(false);
    if (playing && playKind === "ranking") {
      pausePreview();
      return;
    }
    const order = filledIds();
    const startId = rankingStartId(slots[selected]?.id, order);
    if (!startId) {
      flashMessage(slots.some((item) => item.mediaId) ? "That clip has no preview yet." : "This rank has no clip.");
      return;
    }
    const startAt = Math.max(0, order.indexOf(startId));
    playAll.current = true;
    holding.current = false;
    playQueue.current = [...order.slice(startAt + 1), ...order.slice(0, startAt)];
    const next = nextQueued();
    unlockNext(next?.item);
    if (next) void prepare(hiddenIndex(), next.item, "cut");
    void startPlay(startId, "cut");
  }

  function playThisClip() {
    if (playing && playKind === "clip" && !looping) {
      pausePreview();
      return;
    }
    stopSequence();
    const current = slots[selected];
    if (!current?.previewUrl) {
      flashMessage(current?.mediaId ? "That clip has no preview yet." : "This rank has no clip.");
      return;
    }
    void startPlay(current.id, "file");
  }

  function previewSelection() {
    const current = slots[selected];
    if (!current?.previewUrl) {
      flashMessage(current?.mediaId ? "That clip has no preview yet." : "This rank has no clip.");
      return;
    }
    if (playing && looping) {
      pausePreview();
      return;
    }
    stopSequence();
    loopCut.current = true;
    setLooping(true);
    void startPlay(current.id, "cut");
  }

  function commitRange(id: string, range: { inSec: number; outSec: number }, seekTo: number) {
    skipPark.current = true;
    span.current = "cut";
    writeSlot(id, () => range);
    const video = nodeAt(liveDeck.current);
    const at = Math.max(0, seekTo);
    if (video) {
      try {
        video.currentTime = at;
      } catch {
        // The file may still be opening.
      }
    }
    setNowSec(at);
  }

  function advanceOrStop(current: Slot, forceEnd = false) {
    if (holding.current || readySlot.current !== current.id) return;
    const video = nodeAt(liveDeck.current);
    const end = video ? endSec(current, video) : current.outSec;
    const next = playAll.current ? nextQueued() : null;
    const hidden = hiddenIndex();
    const step = rankingStep({
      mode: span.current,
      sequencing: playAll.current,
      currentTime: forceEnd ? end : video?.currentTime ?? end,
      endSec: end,
      hasNext: Boolean(next),
      nextReady: Boolean(next && deckReady(hidden, next.item, "cut")),
    });
    if (step === "play") return;
    if (step === "cut" && next) {
      cutTo(hidden, next.index);
      return;
    }
    if (step === "hold" && next) {
      holding.current = true;
      if (video && !video.paused) video.pause();
      setNowSec(Math.min(video?.currentTime ?? end, end));
      void prepare(hidden, next.item, "cut").then((ok) => {
        if (!ok || !holding.current || !playAll.current) return;
        cutTo(hidden, next.index);
      });
      return;
    }
    if (loopCut.current && span.current === "cut" && !playAll.current) {
      const live = video ?? nodeAt(liveDeck.current);
      if (!live) return;
      const at = Math.max(0, current.inSec);
      holding.current = false;
      wantPlay.current = true;
      live.currentTime = at;
      setNowSec(at);
      void live.play().catch(() => {
        loopCut.current = false;
        setLooping(false);
        wantPlay.current = false;
        setPlaying(false);
        setPlayKind(null);
      });
      watchFrames();
      return;
    }
    stopSequence();
    wantPlay.current = false;
    video?.pause();
    setPlaying(false);
    setNowSec(end);
  }

  function onPreviewTime(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (video !== nodeAt(liveDeck.current) || holding.current) return;
    const current = slotsRef.current[selected];
    if (!current?.previewUrl || readySlot.current !== current.id) return;
    if (span.current === "cut" && video.currentTime + 0.05 < current.inSec) return;
    const end = endSec(current, video);
    const next = playAll.current ? nextQueued() : null;
    const step = rankingStep({
      mode: span.current,
      sequencing: playAll.current,
      currentTime: video.currentTime,
      endSec: end,
      hasNext: Boolean(next),
      nextReady: Boolean(next && deckReady(hiddenIndex(), next.item, "cut")),
    });
    if (step === "play") {
      setNowSec(video.currentTime);
      return;
    }
    advanceOrStop(current);
  }

  function onPreviewEnded(event: React.SyntheticEvent<HTMLVideoElement>) {
    if (event.currentTarget !== nodeAt(liveDeck.current) || holding.current) return;
    const current = slotsRef.current.find((item) => item.id === readySlot.current);
    if (!current?.previewUrl) return;
    advanceOrStop(current, true);
  }

  function onDeckPause(event: React.SyntheticEvent<HTMLVideoElement>) {
    if (event.currentTarget !== nodeAt(liveDeck.current)) return;
    if (holding.current || wantPlay.current) return;
    setPlaying(false);
  }

  function onDeckPlay(event: React.SyntheticEvent<HTMLVideoElement>) {
    if (event.currentTarget !== nodeAt(liveDeck.current)) return;
    setPlaying(true);
  }

  function patch(next: Partial<Slot>) {
    setSlots((rows) => rows.map((item, index) => (index === selected ? { ...item, ...next } : item)));
  }

  function setCount(count: number) {
    const lastMedia = slots.reduce((end, item, index) => (item.mediaId ? index : end), -1);
    const nextCount = Math.max(count, lastMedia + 1);
    if (nextCount === slots.length) {
      if (count < slots.length) flashMessage("The clips already here stay.");
      return;
    }
    pausePreview();
    setSlots((rows) => {
      const added =
        nextCount > rows.length
          ? Array.from({ length: nextCount - rows.length }, () => ({ ...makeSlots(1)[0], keepEmpty: true }))
          : [];
      const next = nextCount > rows.length ? [...rows, ...added] : rows.slice(0, nextCount);
      return renumberSlots(next);
    });
    setSelected((index) => Math.min(nextCount - 1, Math.max(0, index)));
  }

  function addSlot() {
    pausePreview();
    setSlots((rows) => renumberSlots([...rows, { ...makeSlots(1)[0], keepEmpty: true }]));
    setSelected(slots.length);
  }

  function startFresh() {
    pausePreview();
    setSlots(makeSlots(5));
    setSelected(0);
    setHeadline(RANKING_HEADLINE);
    setAccentWords("funniest");
    setSubject("");
    setPasted("");
    setPlayback("countdown");
    setOrderIds([]);
    flashMessage("Started over. Rankings you already saved stay in this channel.");
  }

  function shuffle() {
    const ids = slots.map((item) => item.id);
    const previous = playback === "shuffle" && orderIds.length === ids.length ? orderIds : ids;
    let next = shuffleIds(ids);
    if (ids.length > 1 && next.every((id, index) => id === previous[index])) {
      const first = next[0];
      next = [next[1], first, ...next.slice(2)];
    }
    setOrderIds(next);
    setPlayback("shuffle");
  }

  useEffect(() => {
    void window.flicks?.templates().then((items) => {
      setRecipes(items.filter((item) => !item.builtin && item.headline));
    });
  }, []);

  async function saveRecipe() {
    const ranking = builtinTemplates().find((item) => item.id === "builtin-ranking");
    if (!ranking) return;
    const title = headline.split("\n")[0]?.trim() || "Ranking";
    const base = flickFromTemplate(ranking, title);
    const ordered = playbackOrder(slots, playback, orderIds);
    let cursor = 0;
    const clips = ordered.map((item) => {
      const length = Math.max(0.4, item.outSec - item.inSec);
      const clip = {
        id: uid(),
        mediaId: null,
        trackId: "track-top",
        startSec: cursor,
        inSec: 0,
        outSec: round3(length),
        label: showRank ? `#${item.rank}` : item.title || "Clip",
        line: item.title || undefined,
      };
      cursor += length;
      return clip;
    });
    const loop = base.clips.find((clip) => clip.label === "Loop");
    base.clips = loop ? [...clips, { ...loop, id: uid(), startSec: 0, outSec: round3(cursor || 3) }] : clips;
    base.headline = headline;
    base.headlineColor = color;
    base.accentWords = accentWords;
    base.titleStroke = stroke;
    base.showRank = showRank;
    base.showCaptions = showCaptions;
    base.titleFont = storedTitleFont(font);
    base.lineColor = storedLineColor(lineColor);
    base.lineSize = storedLineSize(lineSize);
    base.rankSize = storedRankSize(rankSize);
    base.rankColor = storedRankColor(rankColor);
    base.rankPlace = storedOverlayPlace(rankPlace, "top");
    base.linePlace = storedOverlayPlace(linePlace, "bottom");
    base.pictureWarmth = storedWarmth(warmth);
    const result = await window.flicks!.saveTemplate(base, title);
    flashMessage(result.ok ? `Saved “${title}”. This order and these words can run again.` : result.message ?? "Could not save that template.");
    if (result.ok) {
      const items = await window.flicks!.templates();
      setRecipes(items.filter((item) => !item.builtin && item.headline));
    }
  }

  function loadRecipe(template: Template) {
    if (template.headline) setHeadline(template.headline);
    if (template.headlineColor) setColor(template.headlineColor);
    if (template.accentWords !== undefined) setAccentWords(template.accentWords);
    if (template.titleStroke !== undefined) setStroke(template.titleStroke);
    if (template.showRank !== undefined) setShowRank(template.showRank);
    setShowCaptions(template.showCaptions !== false);
    setFont(titleFontOf(template.titleFont));
    setLineSize(lineSizeOf(template.lineSize));
    setLineColor(template.lineColor && /^#[0-9a-fA-F]{6}$/.test(template.lineColor) ? template.lineColor : "#ffffff");
    setRankSize(rankSizeOf(template.rankSize));
    setRankColor(rankColorOf(template.rankColor));
    setRankPlace(overlayPlaceOf(template.rankPlace, "top"));
    setLinePlace(overlayPlaceOf(template.linePlace, "bottom"));
    setWarmth(warmthOf(template.pictureWarmth));
    const ranked = template.clips.filter((clip) => clip.label !== "Loop" && clip.trackId !== "track-bottom");
    if (!ranked.length) return;
    setSlots(
      ranked.map((clip, index) => {
        return {
          id: uid(),
          rank: slotRank(clip.label, index, ranked.length),
          title: titleFromClip(clip),
          note: "",
          inSec: 0,
          outSec: Math.max(0.4, clip.outSec - clip.inSec),
          duration: 0,
          mediaId: null,
          mediaName: "",
          previewUrl: null,
          focus: 0.5,
        };
      }),
    );
    setPlayback("listed");
    setOrderIds([]);
    setSelected(0);
    flashMessage(`Loaded “${template.name}”. Add the clips, then open the timeline.`);
  }

  function pasteLines() {
    const lines = importedLines(pasted);
    if (!lines.length) {
      flashMessage("Paste one caption per clip.");
      return;
    }
    const ids = slots.map((item) => item.id);
    const startId = slots[selected]?.id ?? ids[0] ?? "";
    const assigned = assignLinesInOrder(ids, lines, startId);
    setSlots((rows) => rows.map((item) => (assigned.has(item.id) ? { ...item, title: assigned.get(item.id) ?? item.title } : item)));
    flashMessage(assigned.size === 1 ? "Put 1 caption on the clips." : `Put ${assigned.size} captions on the clips.`);
  }

  function move(step: number) {
    const current = slots[selected];
    if (!current) return;
    const target = selected + step;
    if (target < 0 || target >= slots.length) return;
    setSlots((rows) => {
      const from = rows.findIndex((item) => item.id === current.id);
      const to = from + step;
      if (from < 0 || to < 0 || to >= rows.length) return rows;
      const copy = [...rows];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    setSelected(target);
  }

  function writeSlot(id: string, change: (row: Slot) => Partial<Slot>) {
    setSlots((rows) => rows.map((item) => (item.id === id ? { ...item, ...change(item) } : item)));
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
    setAnnounced("Ranking");
    const parent = await window.flicks!.pickDirectory();
    if (!parent) return null;
    const created = await window.flicks!.createChannel(parent, "Ranking");
    if (!created.ok || !created.dir) {
      flashMessage(created.message ?? "Could not create the channel.");
      return null;
    }
    setDir(created.dir);
    setAnnounced(folderName(created.dir));
    return created.dir;
  }

  async function findClips() {
    const name = subject.trim();
    if (!name) {
      flashMessage("Name a subject.");
      return;
    }
    const empty = slots.filter((item) => !item.mediaId).length;
    if (!empty) {
      flashMessage("Every rank already has a clip.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      setMessage("Finding clips…");
      const result = await window.flicks!.findClips(folder, name, Math.min(SUBJECT_CLIP_COUNT, empty));
      if (!result.ok || !result.clips?.length) {
        flashMessage(result.message ?? "Could not find clips for that subject.");
        return;
      }
      let placed = 0;
      let first = -1;
      flushSync(() => {
        setSlots((rows) => {
          const before = rows.map((item) => item.mediaId);
          const found = placeFoundClips(rows, result.clips!);
          const next = fitRankingSlots(found.slots, false);
          placed = found.placed;
          first = next.findIndex((item, index) => item.mediaId && item.mediaId !== before[index]);
          return next;
        });
      });
      if (first >= 0) setSelected(first);
      if (!placed) {
        flashMessage("Every rank already has a clip.");
        return;
      }
      const line = subjectLine(name);
      setHeadline(line.headline);
      setAccentWords(line.accent);
      flashMessage(result.workingCopy ? "Working copies are on this computer." : result.message ?? `Found ${placed} clips.`);
    } finally {
      setBusy(false);
      dropProgress();
    }
  }

  function fillSlot(index: number, next: Partial<Slot>) {
    setSlots((rows) => rows.map((item, row) => (row === index ? { ...item, ...next } : item)));
  }

  function selectRank(index: number) {
    if (index !== selected) {
      stopSequence();
      wantPlay.current = false;
      span.current = "file";
      nodeAt(liveDeck.current)?.pause();
    }
    setSelected(index);
  }

  function setMessage(text: string) {
    window.clearTimeout(messageTimer.current);
    setMessageState(text);
  }

  function flashNote(text: string) {
    window.clearTimeout(noteTimer.current);
    setAddNote(text);
    noteTimer.current = window.setTimeout(() => setAddNote(""), 3400);
  }

  function flashMessage(text: string) {
    window.clearTimeout(messageTimer.current);
    setMessageState(text);
    messageTimer.current = window.setTimeout(() => setMessageState(""), 3400);
  }

  function dropProgress() {
    setMessageState((current) => (current === "Downloading…" || current === "Getting the clip…" || current === "Finding clips…" ? "" : current));
  }

  function clearAddNote() {
    window.clearTimeout(noteTimer.current);
    setAddNote("");
  }

  function focusHeadlineField(event: { stopPropagation(): void }) {
    event.stopPropagation();
    headlineRef.current?.focus();
  }

  function focusCaptionField(event: { stopPropagation(): void }) {
    event.stopPropagation();
    if (!more) {
      setMore(true);
      window.setTimeout(() => captionRef.current?.focus(), 0);
      return;
    }
    captionRef.current?.focus();
  }

  /** Keep the empty phone line clear of the rank shield for every place. */
  function emptyLineStyle(place: OverlayPlace): { paddingTop?: string; paddingBottom?: string; zIndex: number } | undefined {
    if (!showRank) return undefined;
    if (place === "middle") return { paddingBottom: "36%", zIndex: 5 };
    if (place === "top") return { paddingTop: "20%", zIndex: 5 };
    return { paddingBottom: "20%", zIndex: 5 };
  }

  /** The selected rank when it is empty, otherwise the next empty rank. */
  function rankForNewClip(): number {
    const rows = slotsRef.current;
    if (!rows.length) return -1;
    const start = rows[selected] && !rows[selected].mediaId ? selected : selected + 1;
    for (let step = 0; step < rows.length; step += 1) {
      const index = (start + step) % rows.length;
      if (!rows[index]?.mediaId) return index;
    }
    return -1;
  }

  function landClip(
    index: number,
    asset: { id: string; name: string; durationSec: number },
    media: ResolvedMedia[] | undefined,
    sourceUrl?: string,
  ) {
    const current = slotsRef.current[index];
    const resolved = media?.find((item) => item.id === asset.id);
    const duration = asset.durationSec > 0 ? asset.durationSec : 3;
    const range = fitHandRange(0, duration, duration);
    fillSlot(index, {
      mediaId: asset.id,
      mediaName: asset.name,
      madeAt: resolved?.madeAt,
      previewUrl: resolved?.previewUrl ?? null,
      duration,
      inSec: range.inSec,
      outSec: range.outSec,
      title: captionFromFile(current?.title, asset.name),
      focus: 0.5,
      ...(sourceUrl ? { note: sourceUrl } : {}),
    });
  }

  async function addLink() {
    if (busy) return;
    let url = "";
    try {
      url = clipLink(linkText);
    } catch (error) {
      flashNote(error instanceof Error ? error.message : "Paste a link.");
      return;
    }
    const index = rankForNewClip();
    if (index < 0) {
      flashNote("Every rank already has a clip.");
      return;
    }
    selectRank(index);
    clearAddNote();
    setBusy(true);
    setMessage("Downloading…");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const result = await window.flicks!.downloadMedia(folder, url);
      if (!result.ok || !result.asset) {
        setMessage("");
        flashNote(linkNote(result.message));
        return;
      }
      landClip(index, result.asset, result.media, result.sourceUrl || url);
      setLinkText("");
      flashMessage(result.workingCopy ? "Downloaded. Clip the sequence. The working copy is on this computer." : "Downloaded. Clip the sequence.");
    } finally {
      setBusy(false);
      dropProgress();
    }
  }

  async function uploadClip() {
    if (busy) return;
    const index = rankForNewClip();
    if (index < 0) {
      flashNote("Every rank already has a clip.");
      return;
    }
    selectRank(index);
    clearAddNote();
    setBusy(true);
    setMessage("");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const result = await window.flicks!.importMedia(folder, "copy");
      if (!result.ok || !result.asset) {
        flashNote(uploadNote(result.message));
        return;
      }
      landClip(index, result.asset, result.media);
      flashMessage(result.workingCopy ? "Added. Clip the sequence. The working copy is on this computer." : "Added. Clip the sequence.");
    } finally {
      setBusy(false);
    }
  }

  function clipAnotherSequence() {
    const rows = slotsRef.current;
    const current = rows[selected];
    if (!current?.mediaId) {
      flashMessage("Download a video first.");
      return;
    }
    pausePreview();
    const range = nextSequenceRange(current.inSec, current.outSec, current.duration);
    let empty = -1;
    for (let step = 1; step <= rows.length; step += 1) {
      const index = (selected + step) % rows.length;
      if (!rows[index]?.mediaId) {
        empty = index;
        break;
      }
    }
    if (empty >= 0) {
      setSlots(
        rows.map((item, index) =>
          index === empty
            ? {
                ...item,
                note: current.note,
                inSec: range.inSec,
                outSec: range.outSec,
                duration: current.duration,
                mediaId: current.mediaId,
                mediaName: current.mediaName,
                madeAt: current.madeAt,
                previewUrl: current.previewUrl,
                focus: current.focus,
              }
            : item,
        ),
      );
      setSelected(empty);
    } else {
      const added: Slot = {
        ...makeSlots(1)[0],
        note: current.note,
        inSec: range.inSec,
        outSec: range.outSec,
        duration: current.duration,
        mediaId: current.mediaId,
        mediaName: current.mediaName,
        madeAt: current.madeAt,
        previewUrl: current.previewUrl,
        focus: current.focus,
        keepEmpty: true,
      };
      setSlots(renumberSlots([...rows, added]));
      setSelected(rows.length);
    }
    flashMessage("Same download. Clip this sequence.");
  }

  async function openTimeline() {
    if (!slots.some((item) => item.mediaId)) {
      flashMessage("Choose at least one clip.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const name = headline.split("\n")[0]?.trim() || "Ranking";
      let existing: Flick | null = null;
      if (flickId) {
        const loaded = await window.flicks!.readFlick(folder, flickId);
        if (!loaded.ok || !loaded.flick) {
          flashMessage(loaded.message ?? "Could not open the timeline.");
          return;
        }
        existing = loaded.flick;
      }
      let shell = existing;
      if (!shell) {
        const created = await window.flicks!.createFlick(folder, name, "builtin-ranking");
        if (!created.ok || !created.flick) {
          flashMessage(created.message ?? "Could not open the timeline.");
          return;
        }
        shell = created.flick;
      }
      const ordered = playbackOrder(slots, playback, orderIds);
      let cursor = 0;
      const rankClips: Clip[] = ordered
        .filter((item) => item.mediaId)
        .map((item) => {
          const range = rankingClipRange(item.inSec, item.outSec, item.duration);
          const clip: Clip = {
            id: uid(),
            mediaId: item.mediaId,
            trackId: "track-top",
            startSec: cursor,
            inSec: range.inSec,
            outSec: range.outSec,
            label: showRank ? `#${item.rank}` : item.title || "Clip",
            line: item.title || undefined,
            focus: item.focus,
            sourceUrl: item.note.trim() || undefined,
          };
          cursor += range.outSec - range.inSec;
          return clip;
        });
      const deskClips: Clip[] = [...rankClips];
      if (!existing) {
        const loop = shell.clips.find((clip) => clip.label === "Loop");
        if (loop) deskClips.push({ ...loop, id: uid(), startSec: 0, outSec: round3(cursor || 3) });
      }
      const outside = (existing ?? shell).clips.filter((clip) => clip.trackId !== "track-top");
      const loopHasMedia = outside.some((clip) => (clip.trackId === "track-bottom" || clip.label === "Loop") && clip.mediaId);
      const loopBare = !loopHasMedia && outside.some((clip) => clip.trackId === "track-bottom" || clip.label === "Loop");
      const rankRegion =
        shell.regions.find((region) => region.trackId === "track-top") ??
        shell.regions.find((region) => region.id === "region-rank");
      const regions = loopBare && rankRegion ? fullFrame(shell.regions, rankRegion.id) : shell.regions;
      const plan = openDeskFlick(existing, {
        name,
        editedTrackIds: ["track-top"],
        clips: deskClips,
        regions,
        tracks: shell.tracks,
        headline,
        headlineColor: color,
        accentWords,
        titleStroke: stroke,
        showRank,
        showCaptions,
        titleFont: storedTitleFont(font),
        lineColor: storedLineColor(lineColor),
        lineSize: storedLineSize(lineSize),
        rankSize: storedRankSize(rankSize),
        rankColor: storedRankColor(rankColor),
        rankPlace: storedOverlayPlace(rankPlace, "top"),
        linePlace: storedOverlayPlace(linePlace, "bottom"),
        pictureWarmth: storedWarmth(warmth),
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
        flashMessage(saved.message ?? "Could not save the ranking.");
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

  const assistClips: AssistClip[] = slots.flatMap((item) => {
    const line = item.title.trim();
    const name = slotListTitle(item.title, item.mediaName);
    if (!name) return [];
    return [
      {
        id: item.id,
        name,
        line,
        lengthSec: Math.max(0, item.outSec - item.inSec),
        date: item.madeAt ? whenPhrase("Made", item.madeAt) ?? "no date" : "no date",
      },
    ];
  });
  const phoneCaption = spokenLine(slot?.title, slot?.mediaName);
  const headlineOnPhone = headline.replace(/\r/g, "").trim();
  const rankPx = rankSizeOf(rankSize);
  const captionPx = lineSizeOf(lineSize);
  const rankSwatch = rankColorOf(rankColor);
  const captionSwatch = lineColorOf(lineColor);
  const sequence = playbackOrder(slots, playback, orderIds).filter((item) => item.previewUrl);
  const filmOrder = playbackOrder(slots, playback, orderIds).filter((item) => item.mediaId && item.duration > 0);
  const playAt = new Map(sequence.map((item, index) => [item.id, index + 1]));
  const swatch = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#e2b340";
  const wash = warmthWash(warmth);

  return (
    <div className="studio ranking">
      <header className="toolbar rank-toolbar">
        <button className="home-back" onClick={onBack}>
          <HomeIcon />
          Home
        </button>
        <div className="rank-title">
          <strong>Video ranking</strong>
          {folderLabel ? <span className="timeline-hint">{folderLabel}</span> : null}
        </div>
        <div className="timeline-open">
          <button className="btn-gold" disabled={busy} onClick={() => void openTimeline()}>
            <TimelineIcon />
            Open timeline
          </button>
          <span className="timeline-hint">Opens the full timeline</span>
        </div>
      </header>
      {message && message !== "No file chosen." ? (
        <p className="banner" role="status" style={{ pointerEvents: "none" }}>
          {message}
        </p>
      ) : null}
      <div className="studio-body">
        <aside
          className="rail stack rank-rail clip-rail"
          ref={railRef}
          data-clips-sized={clipsHeight != null ? "" : undefined}
          style={clipsHeight != null ? { ["--rank-clips-height" as string]: `${clipsHeight}px` } : undefined}
        >
          <div className="rank-rest rank-rest-quiet">
            <p className="rail-label">Ranks</p>
          </div>
          <div
            className="rank-clips-split"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Clips list height"
            aria-valuemin={RANK_CLIPS_MIN}
            aria-valuenow={clipsHeight ?? undefined}
            tabIndex={0}
            title="Drag up to expand the clips"
            onPointerDown={beginClipsDrag}
            onKeyDown={nudgeClips}
          />
          <div className="rank-clips" ref={clipsPaneRef}>
            <div className="slot-list">
              {slots.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={index === selected ? (item.mediaId ? "slot on" : "slot is-empty on") : item.mediaId ? "slot" : "slot is-empty"}
                  aria-pressed={index === selected}
                  onClick={(event) => {
                    selectRank(index);
                    const named = event.target instanceof Element ? event.target.closest(".slot-name") : null;
                    if (named && (item.title.trim() || item.mediaId)) focusCaptionField(event);
                  }}
                >
                  <b>#{item.rank}</b>
                  <span className="slot-copy">
                    <span className="slot-name" style={item.title.trim() || item.mediaId ? { cursor: "text" } : undefined}>
                      {item.mediaId ? slotListTitle(item.title, item.mediaName) || "Clip" : "Empty"}
                    </span>
                    {item.mediaId ? (
                      <span className="slot-time">{slotTimeLine(item.outSec - item.inSec, item.duration)}</span>
                    ) : null}
                  </span>
                  {item.mediaId ? <em>Play {playAt.get(item.id)}</em> : null}
                </button>
              ))}
            </div>
            {slots.some((item) => item.mediaId) ? (
              <button type="button" className="slot-add" onClick={addSlot}>
                Add another slot
              </button>
            ) : null}
          </div>
        </aside>
        <div className="stage-wrap">
          <div className="phone-stage">
            <div
              className={slot?.previewUrl ? "phone phone-play" : "phone"}
              onClick={slot?.mediaId ? () => playRanking() : undefined}
              onKeyDown={
                slot?.mediaId
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        playRanking();
                      }
                    }
                  : undefined
              }
              role={slot?.mediaId ? "button" : undefined}
              tabIndex={slot?.mediaId ? 0 : undefined}
              aria-label={slot?.mediaId ? (playing && playKind === "ranking" ? "Pause the ranking" : "Play the ranking") : undefined}
              style={{ ["--rank-size" as string]: String(rankPx), ["--line-size" as string]: String(captionPx) }}
            >
              {slot?.previewUrl ? (
                <>
                  <video
                    ref={deckA}
                    data-deck={liveFace === 0 ? "live" : "next"}
                    playsInline
                    preload="auto"
                    style={{ zIndex: liveFace === 0 ? 1 : 0 }}
                    onTimeUpdate={onPreviewTime}
                    onEnded={onPreviewEnded}
                    onPlay={onDeckPlay}
                    onPause={onDeckPause}
                  />
                  <video
                    ref={deckB}
                    data-deck={liveFace === 1 ? "live" : "next"}
                    playsInline
                    preload="auto"
                    style={{ zIndex: liveFace === 1 ? 1 : 0 }}
                    onTimeUpdate={onPreviewTime}
                    onEnded={onPreviewEnded}
                    onPlay={onDeckPlay}
                    onPause={onDeckPause}
                  />
                </>
              ) : (
                <p className="phone-empty" style={emptyLineStyle(rankPlace)}>
                  {slot?.mediaId ? "No preview yet" : "Paste a link or upload a file."}
                </p>
              )}
              {wash ? <div className="phone-warmth" style={{ background: wash }} /> : null}
              {showRank ? (
                <div
                  className={`phone-rank place-${rankPlace}`}
                  style={{ fontFamily: titleFontFamily(font), background: rankSwatch, color: readableOn(rankSwatch) }}
                >
                  {slot?.rank}
                </div>
              ) : null}
              {headlineOnPhone ? (
                <div
                  className={showRank && rankPlace === "top" ? "phone-title under-rank" : "phone-title"}
                  style={{
                    fontFamily: titleFontFamily(font),
                    top:
                      showRank && rankPlace === "top"
                        ? `calc(${36 + Math.round(rankPx * 1.9) + 16} * 100cqh / 1920)`
                        : undefined,
                    cursor: "text",
                  }}
                  onClick={focusHeadlineField}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      focusHeadlineField(event);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="Edit headline"
                >
                  {paint(headlineOnPhone, swatch, accentWords)}
                </div>
              ) : null}
              {showCaptions && phoneCaption ? (
                <div
                  className={`phone-clip place-${linePlace}`}
                  style={{ fontFamily: titleFontFamily(font), color: captionSwatch, cursor: "text" }}
                  onClick={focusCaptionField}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      focusCaptionField(event);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="Edit caption"
                >
                  {phoneCaption}
                </div>
              ) : null}
            </div>
          </div>
          <div className="desk-play">
            <button type="button" className="btn-gold" onClick={playRanking}>
              {playing && playKind === "ranking" ? "Pause" : "Play ranking"}
            </button>
            <span className="desk-clock">{formatClock(slot?.previewUrl ? nowSec : 0)}</span>
          </div>
          {slot && slot.duration > 0 ? (
            <ClipRange
              slotId={slot.id}
              duration={slot.duration}
              inSec={slot.inSec}
              outSec={slot.outSec}
              nowSec={slot.previewUrl ? nowSec : 0}
              looping={playing && looping}
              canPreview={Boolean(slot.previewUrl)}
              previewUrl={slot.previewUrl}
              onStart={(sec) => {
                const range = fitHandRange(sec, slot.outSec, slot.duration);
                commitRange(slot.id, range, range.inSec);
              }}
              onEnd={(sec) => {
                const range = fitHandRange(slot.inSec, sec, slot.duration);
                commitRange(slot.id, range, range.outSec);
              }}
              onShift={(delta, originIn, originOut) => {
                const range = shiftHandRange(originIn, originOut, delta, slot.duration);
                commitRange(slot.id, range, range.inSec);
              }}
              onLength={(next) => {
                const range = setHandLength(slot.inSec, next, slot.duration);
                commitRange(slot.id, range, range.inSec);
              }}
              onPreview={previewSelection}
              onAnother={clipAnotherSequence}
              onPlace={(sec, span) => {
                const range = setHandLength(sec, span, slot.duration);
                commitRange(slot.id, range, range.inSec);
              }}
              onPick={(id) => {
                const index = slots.findIndex((item) => item.id === id);
                if (index >= 0) selectRank(index);
              }}
              sequence={filmOrder.map((item) => ({
                id: item.id,
                label: `#${item.rank}`,
                name: slotListTitle(item.title, item.mediaName),
                lengthSec: Math.max(0, item.outSec - item.inSec),
                active: item.id === slot.id,
              }))}
              others={slots
                .filter((item) => item.mediaId && item.mediaId === slot.mediaId && item.id !== slot.id)
                .map((item) => ({ id: item.id, inSec: item.inSec, outSec: item.outSec }))}
            />
          ) : null}
        </div>
        <aside className="inspector stack rank-inspector">
          <div className="desk-focus clip-add">
            <label className="stack">
              <span>Paste a link</span>
              <input
                className="field"
                value={linkText}
                placeholder="Paste a link"
                aria-label="Paste a link"
                spellCheck={false}
                onChange={(event) => setLinkText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addLink();
                }}
              />
            </label>
            <button className="btn-primary" type="button" disabled={busy} onClick={() => void addLink()}>
              Add link
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => void uploadClip()}>
              Upload a file
            </button>
            {addNote ? (
              <p className="desk-note" role="status">
                {addNote}
              </p>
            ) : null}
          </div>
          <div className="desk-focus find-subject">
            <label className="stack">
              <span>Subject</span>
              <input
                className="field"
                value={subject}
                placeholder="Name a subject"
                onChange={(event) => setSubject(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void findClips();
                }}
              />
            </label>
            <button className="btn-primary" type="button" disabled={busy} onClick={() => void findClips()}>
              Find clips
            </button>
            <p className="desk-note">Type a topic. This finds up to three short clips.</p>
          </div>
          <div className="desk-focus">
            <label className="stack">
              <span>Headline</span>
              <textarea
                ref={headlineRef}
                className="field"
                rows={2}
                value={headline}
                aria-label="Headline"
                onChange={(event) => setHeadline(event.target.value)}
              />
            </label>
            <div className="toggle-line">
              <span>Show the rank number</span>
              <button
                type="button"
                className={showRank ? "switch on" : "switch"}
                role="switch"
                aria-checked={showRank}
                aria-label="Show the rank number"
                onClick={() => setShowRank((value) => !value)}
              />
            </div>
            <div className="toggle-line">
              <span>Show captions</span>
              <button type="button" className={showCaptions ? "switch on" : "switch"} role="switch" aria-checked={showCaptions} aria-label="Show captions" onClick={() => setShowCaptions((value) => !value)} />
            </div>
          </div>
          <button
            type="button"
            className="more-toggle"
            aria-expanded={look}
            aria-controls="ranking-look"
            onClick={() => setLook((value) => !value)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            Look
            <span aria-hidden="true">{look ? "▾" : "▸"}</span>
          </button>
          {look ? (
            <LookPanel
              showRank={showRank}
              showCaptions={showCaptions}
              rankSize={rankPx}
              captionSize={captionPx}
              rankPlace={rankPlace}
              linePlace={linePlace}
              rankColor={rankColor}
              captionColor={lineColor}
              onShowRank={() => setShowRank((value) => !value)}
              onShowCaptions={() => setShowCaptions((value) => !value)}
              onRankSize={(size) => setRankSize(rankSizeOf(size))}
              onCaptionSize={(size) => setLineSize(lineSizeOf(size))}
              onRankPlace={setRankPlace}
              onLinePlace={setLinePlace}
              onRankColor={setRankColor}
              onCaptionColor={setLineColor}
            />
          ) : null}
          <button
            type="button"
            className="more-toggle"
            aria-expanded={more}
            aria-controls="ranking-more"
            onClick={() => setMore((value) => !value)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            More
            <span aria-hidden="true">{more ? "▾" : "▸"}</span>
          </button>
          {more ? (
            <div className="more-panel" id="ranking-more">
              <p className="rail-label">Play order</p>
              <div className="order-stack">
                <button className={playback === "countdown" ? "order-btn on" : "order-btn"} onClick={() => setPlayback("countdown")}>
                  <ClockIcon />
                  Countdown
                </button>
                {playback === "countdown" ? <p className="order-hint">{playbackSentence(playback, slots, orderIds)}</p> : null}
                <button className={playback === "listed" ? "order-btn on" : "order-btn"} onClick={() => setPlayback("listed")}>
                  <ListIcon />
                  Listed
                </button>
                {playback === "listed" ? <p className="order-hint">{playbackSentence(playback, slots, orderIds)}</p> : null}
                <button className={playback === "skip" ? "order-btn on" : "order-btn"} onClick={() => setPlayback("skip")}>
                  <SkipIcon />
                  Skip around
                </button>
                {playback === "skip" ? <p className="order-hint">{playbackSentence(playback, slots, orderIds)}</p> : null}
                <button className={playback === "shuffle" ? "order-btn on" : "order-btn"} onClick={shuffle}>
                  <ShuffleIcon />
                  Shuffle
                </button>
                {playback === "shuffle" ? <p className="order-hint">{playbackSentence(playback, slots, orderIds)}</p> : null}
              </div>
              <button type="button" className="desk-play-all" onClick={playThisClip}>
                {playing && playKind === "clip" ? "Pause" : "This clip"}
              </button>
              <button className="btn desk-save" onClick={() => void saveRecipe()}>
                Save template
              </button>
              <p className="desk-note">Saves this order and these words. The video files stay off it.</p>
              {recipes.length ? (
                <div className="order-stack">
                  {recipes.map((recipe) => (
                    <button key={recipe.id} className="choice" onClick={() => loadRecipe(recipe)}>
                      {recipe.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="count-row" role="group" aria-label="How many ranks">
                {[5, 6, 7].map((count) => (
                  <button
                    key={count}
                    className={slots.length === count ? "count-btn on" : "count-btn"}
                    aria-pressed={slots.length === count}
                    onClick={() => setCount(count)}
                  >
                    {count} ranks
                  </button>
                ))}
              </div>
              <WhichClip
                clips={assistClips}
                disabled={busy}
                onHeadline={setHeadline}
                onTitle={(id, title) => setSlots((rows) => rows.map((item) => (item.id === id ? { ...item, title } : item)))}
              />
              <label className="stack">
                <span>Accent words</span>
                <input className="field" aria-label="Accent words" value={accentWords} onChange={(event) => setAccentWords(event.target.value)} />
              </label>
              <label className="stack">
                <span>Highlight color</span>
                <span className="color-line">
                  <input type="color" value={swatch} aria-label="Color" onChange={(event) => setColor(event.target.value)} />
                  <input
                    className="field hex"
                    spellCheck={false}
                    aria-label="Highlight color hex"
                    value={color.toUpperCase()}
                    onChange={(event) => {
                      const next = event.target.value.trim();
                      setColor(next.startsWith("#") ? next : `#${next}`);
                    }}
                  />
                </span>
              </label>
              <label className="stack">
                <span>Title stroke</span>
                <p className="muted tiny">A thicker stroke makes the title easier to read.</p>
                <span className="stroke-line">
                  <input type="range" min={0} max={12} value={stroke} aria-label="Title stroke" onChange={(event) => setStroke(Number(event.target.value))} />
                  <input
                    className="field stroke-num"
                    type="number"
                    min={0}
                    max={12}
                    value={stroke}
                    aria-label="Title stroke amount"
                    onChange={(event) => setStroke(Math.min(12, Math.max(0, Number(event.target.value) || 0)))}
                  />
                </span>
              </label>
              <StyleFields
                font={font}
                lineSize={lineSize}
                lineColor={lineColor}
                warmth={warmth}
                pasted={pasted}
                pasteHint="One caption per clip, starting with the one you picked."
                onFont={setFont}
                onLineSize={(size) => setLineSize(lineSizeOf(size))}
                onLineColor={setLineColor}
                onWarmth={setWarmth}
                onPasted={setPasted}
                onPaste={pasteLines}
              />
              {slot ? (
                <>
                  {slot.mediaName ? <p className="file-note">{slot.mediaName}</p> : null}
                  <label className="stack">
                    <span>Caption</span>
                    <input
                      ref={captionRef}
                      className="field"
                      aria-label="Caption"
                      value={slot.title}
                      onChange={(event) => patch({ title: event.target.value })}
                    />
                  </label>
                  <div className="stack">
                    <span className="field-label">Start and end</span>
                    <div className="inout">
                      <ClockField
                        key={`${slot.id}-in`}
                        label="Start"
                        value={slot.inSec}
                        onCommit={(next) => {
                          const range = fitHandRange(next, slot.outSec, slot.duration);
                          commitRange(slot.id, range, range.inSec);
                        }}
                      />
                      <span className="inout-dash">–</span>
                      <ClockField
                        key={`${slot.id}-out`}
                        label="End"
                        value={slot.outSec}
                        onCommit={(next) => {
                          const range = fitHandRange(slot.inSec, next, slot.duration);
                          commitRange(slot.id, range, range.outSec);
                        }}
                      />
                      <ClockField
                        key={`${slot.id}-length`}
                        label="Length"
                        ariaLabel="Total clip length"
                        value={Math.max(0, slot.outSec - slot.inSec)}
                        onCommit={(next) => {
                          const range = setHandLength(slot.inSec, next, slot.duration);
                          commitRange(slot.id, range, range.inSec);
                        }}
                      />
                    </div>
                    {slot.duration > 0 ? <p className="muted">This file is {formatClock(slot.duration)}. The cut can be any part of it.</p> : null}
                  </div>
                  <div className="nudge-row">
                    <span>Earlier</span>
                    <button className="nudge" aria-label="Earlier" onClick={() => move(-1)}>
                      ←
                    </button>
                    <span className="grow" />
                    <span>Later</span>
                    <button className="nudge" aria-label="Later" onClick={() => move(1)}>
                      →
                    </button>
                  </div>
                </>
              ) : null}
              <button type="button" className="btn" onClick={startFresh}>
                New ranking
              </button>
              <p className="desk-note">Starts over. Rankings you already saved stay in this channel.</p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function shortClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.round(safe);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Still frames across the whole file, so the strip shows the scenes being cut. */
function useClipFrames(url: string | null, duration: number): string[] {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!url || !(duration > 0)) {
      setFrames([]);
      return;
    }
    let cancel = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    const count = Math.min(18, Math.max(8, Math.ceil(duration / 3)));
    const canvas = document.createElement("canvas");
    const shots: string[] = [];
    const finish = () => {
      if (!cancel) setFrames(shots.filter(Boolean));
      video.removeAttribute("src");
      video.load();
    };
    const draw = (index: number) => {
      if (cancel) return;
      const width = video.videoWidth || 160;
      const height = video.videoHeight || 90;
      const scale = 96 / Math.max(height, 1);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        shots.push(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        shots.push("");
      }
      grab(index + 1);
    };
    const grab = (index: number) => {
      if (cancel || index >= count) {
        finish();
        return;
      }
      const t = Math.min(Math.max(duration - 0.05, 0), ((index + 0.5) / count) * Math.max(duration - 0.05, 0));
      if (video.readyState >= 2 && Math.abs(video.currentTime - t) < 0.04) {
        draw(index);
        return;
      }
      const onSeek = () => {
        video.removeEventListener("seeked", onSeek);
        if (!cancel) draw(index);
      };
      video.addEventListener("seeked", onSeek);
      try {
        video.currentTime = t;
      } catch {
        video.removeEventListener("seeked", onSeek);
        finish();
      }
    };
    const onReady = () => {
      video.removeEventListener("loadeddata", onReady);
      if (!cancel) grab(0);
    };
    video.addEventListener("loadeddata", onReady);
    video.src = url;
    return () => {
      cancel = true;
      video.removeAttribute("src");
      video.load();
    };
  }, [url, duration]);
  return frames;
}

function ClipRange({
  slotId,
  duration,
  inSec,
  outSec,
  nowSec,
  looping,
  canPreview,
  previewUrl,
  onStart,
  onEnd,
  onShift,
  onLength,
  onPreview,
  onAnother,
  onPlace,
  onPick,
  sequence,
  others,
}: {
  slotId: string;
  duration: number;
  inSec: number;
  outSec: number;
  nowSec: number;
  looping: boolean;
  canPreview: boolean;
  previewUrl: string | null;
  onStart: (sec: number) => void;
  onEnd: (sec: number) => void;
  onShift: (delta: number, originIn: number, originOut: number) => void;
  onLength: (length: number) => void;
  onPreview: () => void;
  onAnother: () => void;
  onPlace: (sec: number, span: number) => void;
  onPick: (id: string) => void;
  sequence: { id: string; label: string; name: string; lengthSec: number; active: boolean }[];
  others: { id: string; inSec: number; outSec: number }[];
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLVideoElement>(null);
  const peekBusy = useRef(false);
  const peekWant = useRef<number | null>(null);
  const dragging = useRef(false);
  const overFilm = useRef(false);
  const frames = useClipFrames(previewUrl, duration);
  const [peek, setPeek] = useState<{ x: number; sec: number } | null>(null);
  const span = Math.max(duration, 0.001);
  const startPct = (Math.min(span, Math.max(0, inSec)) / span) * 100;
  const endPct = (Math.min(span, Math.max(0, outSec)) / span) * 100;
  const nowPct = (Math.min(span, Math.max(0, nowSec)) / span) * 100;
  const peekStill = peek && frames.length ? frames[Math.min(frames.length - 1, Math.max(0, Math.floor((peek.sec / span) * frames.length)))] : "";

  useEffect(() => {
    const video = peekRef.current;
    if (!video || !previewUrl) return;
    if (video.src !== previewUrl) video.src = previewUrl;
  }, [previewUrl]);

  function seekPeek(sec: number) {
    const video = peekRef.current;
    if (!video || !previewUrl) return;
    const safe = Math.min(Math.max(sec, 0), Math.max(duration - 0.05, 0));
    peekWant.current = safe;
    if (peekBusy.current) return;
    const step = () => {
      const next = peekWant.current;
      const node = peekRef.current;
      if (next == null || !node) {
        peekBusy.current = false;
        return;
      }
      peekWant.current = null;
      if (node.readyState < 1) {
        peekBusy.current = true;
        const onLoad = () => {
          node.removeEventListener("loadeddata", onLoad);
          peekBusy.current = false;
          peekWant.current = next;
          step();
        };
        node.addEventListener("loadeddata", onLoad);
        return;
      }
      if (Math.abs(node.currentTime - next) < 0.07) {
        peekBusy.current = false;
        return;
      }
      peekBusy.current = true;
      const finish = () => {
        node.removeEventListener("seeked", finish);
        peekBusy.current = false;
        if (peekWant.current != null) step();
      };
      node.addEventListener("seeked", finish);
      try {
        node.currentTime = next;
      } catch {
        node.removeEventListener("seeked", finish);
        peekBusy.current = false;
      }
    };
    step();
  }

  function reveal(clientX: number, sec: number) {
    const bar = barRef.current;
    if (!bar || !previewUrl) return;
    const bounds = bar.getBoundingClientRect();
    const x = clientX - bounds.left;
    setPeek({ x: Math.min(Math.max(bounds.width - 84, 84), Math.max(84, x)), sec });
    seekPeek(sec);
  }

  function secondsAt(clientX: number): number {
    const bar = barRef.current;
    if (!bar) return 0;
    const bounds = bar.getBoundingClientRect();
    const ratio = (clientX - bounds.left) / Math.max(bounds.width, 1);
    return Math.min(duration, Math.max(0, ratio * duration));
  }

  function begin(event: React.PointerEvent, kind: "start" | "end" | "window" | "place") {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const originIn = inSec;
    const originOut = outSec;
    const clipSpan = Math.max(0.1, originOut - originIn);
    dragging.current = true;
    const sec = secondsAt(event.clientX);
    if (kind === "place") onPlace(sec, clipSpan);
    reveal(event.clientX, sec);
    const move = (ev: PointerEvent) => {
      const at = secondsAt(ev.clientX);
      reveal(ev.clientX, at);
      if (kind === "window") {
        const bar = barRef.current;
        if (!bar) return;
        const width = Math.max(bar.getBoundingClientRect().width, 1);
        onShift(((ev.clientX - originX) / width) * duration, originIn, originOut);
        return;
      }
      if (kind === "place") onPlace(at, clipSpan);
      else if (kind === "start") onStart(at);
      else onEnd(at);
    };
    const up = () => {
      dragging.current = false;
      if (!overFilm.current) setPeek(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function nudge(edge: "start" | "end", event: React.KeyboardEvent) {
    const step = event.shiftKey ? 1 : 0.1;
    const sign = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!sign) return;
    event.preventDefault();
    if (edge === "start") onStart(inSec + sign * step);
    else onEnd(outSec + sign * step);
  }

  return (
    <div className="clip-range">
      <div className="clip-film">
        <div
          className={peek ? "clip-peek" : "clip-peek is-hidden"}
          style={peek ? { left: peek.x } : undefined}
          aria-hidden="true"
        >
          <div className="clip-peek-stage">
            {peekStill ? <img src={peekStill} alt="" /> : null}
            <video ref={peekRef} muted playsInline preload="auto" />
          </div>
          <span>{peek ? formatClock(peek.sec) : ""}</span>
        </div>
        <div
          className="clip-film-well"
          ref={barRef}
          role="group"
          aria-label="Clip range"
          onPointerEnter={() => {
            overFilm.current = true;
          }}
          onPointerLeave={() => {
            overFilm.current = false;
            if (!dragging.current) setPeek(null);
          }}
          onPointerMove={(event) => {
            if (dragging.current) return;
            reveal(event.clientX, secondsAt(event.clientX));
          }}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest(".clip-film-other, .clip-range-handle")) return;
            const sec = secondsAt(event.clientX);
            if (sec >= inSec && sec <= outSec) begin(event, "window");
            else begin(event, "place");
          }}
        >
          <div className="clip-film-frames">
            {frames.length ? frames.map((src, index) => <img key={index} src={src} alt="" />) : null}
          </div>
          <div className="clip-film-shade" style={{ width: `${startPct}%` }} />
          <div className="clip-film-shade is-right" style={{ left: `${endPct}%`, width: `${Math.max(0, 100 - endPct)}%` }} />
          {others.map((item) => {
            const left = (Math.min(span, Math.max(0, item.inSec)) / span) * 100;
            const right = (Math.min(span, Math.max(0, item.outSec)) / span) * 100;
            return (
              <button
                key={item.id}
                type="button"
                className="clip-film-other"
                style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
                aria-label="Other sequence on this video"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onPick(item.id);
                }}
              />
            );
          })}
          <div className="clip-film-window" style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}>
            {endPct - startPct > 18 ? <span>Clip</span> : null}
          </div>
          <span className="clip-range-playhead" style={{ left: `${nowPct}%` }} />
          <span className="clip-film-clock is-start">{shortClock(0)}</span>
          <span className="clip-film-clock is-end">{shortClock(duration)}</span>
        </div>
        <button
          type="button"
          className="clip-range-handle is-start"
          style={{ left: `${startPct}%` }}
          aria-label="Clip start"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={inSec}
          aria-valuetext={formatClock(inSec)}
          onPointerDown={(event) => begin(event, "start")}
          onKeyDown={(event) => nudge("start", event)}
        />
        <button
          type="button"
          className="clip-range-handle is-end"
          style={{ left: `${endPct}%` }}
          aria-label="Clip end"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={outSec}
          aria-valuetext={formatClock(outSec)}
          onPointerDown={(event) => begin(event, "end")}
          onKeyDown={(event) => nudge("end", event)}
        />
      </div>
      {sequence.length > 1 ? (
        <div className="clip-sequence" role="list" aria-label="Clip sequence">
          {sequence.map((item) => (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={item.active ? "clip-sequence-block on" : "clip-sequence-block"}
              style={{ flexGrow: Math.max(item.lengthSec, 0.4) }}
              aria-pressed={item.active}
              onClick={() => onPick(item.id)}
            >
              <b>{item.label}</b>
              {item.name ? <span className="clip-sequence-name">{item.name}</span> : null}
              <span>{shortClock(item.lengthSec)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="clip-range-times">
        <ClockField key={`${slotId}-start`} label="Start" value={inSec} onCommit={onStart} />
        <ClockField key={`${slotId}-end`} label="End" value={outSec} onCommit={onEnd} />
        <ClockField
          key={`${slotId}-len`}
          label="Length"
          ariaLabel="Total clip length"
          value={Math.max(0, outSec - inSec)}
          onCommit={onLength}
        />
      </div>
      <p className="clip-range-note">The pictures are the whole video. Point along them to see that moment, then drag the ends around the part you want.</p>
      <div className="clip-range-actions">
        <button type="button" className="btn clip-range-preview" disabled={!canPreview} onClick={onPreview}>
          {looping ? "Pause" : "Preview selection"}
        </button>
        <button type="button" className="btn clip-range-preview" onClick={onAnother}>
          Clip another sequence
        </button>
      </div>
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
  ariaLabel?: string;
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
        aria-label={ariaLabel ?? label}
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

const LOOK_SWATCHES = ["#e2b340", "#ffffff", "#1c1915", "#e23b3b", "#2a6fdb"] as const;

function LookPanel({
  showRank,
  showCaptions,
  rankSize,
  captionSize,
  rankPlace,
  linePlace,
  rankColor,
  captionColor,
  onShowRank,
  onShowCaptions,
  onRankSize,
  onCaptionSize,
  onRankPlace,
  onLinePlace,
  onRankColor,
  onCaptionColor,
}: {
  showRank: boolean;
  showCaptions: boolean;
  rankSize: number;
  captionSize: number;
  rankPlace: OverlayPlace;
  linePlace: OverlayPlace;
  rankColor: string;
  captionColor: string;
  onShowRank: () => void;
  onShowCaptions: () => void;
  onRankSize: (size: number) => void;
  onCaptionSize: (size: number) => void;
  onRankPlace: (place: OverlayPlace) => void;
  onLinePlace: (place: OverlayPlace) => void;
  onRankColor: (color: string) => void;
  onCaptionColor: (color: string) => void;
}) {
  return (
    <div className="look-panel" id="ranking-look">
      <div className="toggle-line">
        <span>Show the rank number</span>
        <button type="button" className={showRank ? "switch on" : "switch"} role="switch" aria-checked={showRank} aria-label="Show the rank number" onClick={onShowRank} />
      </div>
      <div className="toggle-line">
        <span>Show the caption</span>
        <button type="button" className={showCaptions ? "switch on" : "switch"} role="switch" aria-checked={showCaptions} aria-label="Show the caption" onClick={onShowCaptions} />
      </div>
      <LookSize label="Rank number size" min={RANK_SIZE_MIN} max={RANK_SIZE_MAX} value={rankSize} onChange={onRankSize} />
      <LookSize label="Caption size" min={LINE_SIZE_MIN} max={LINE_SIZE_MAX} value={captionSize} onChange={onCaptionSize} />
      <LookPlace label="Rank number place" value={rankPlace} onChange={onRankPlace} />
      <LookPlace label="Caption place" value={linePlace} onChange={onLinePlace} />
      <LookColor label="Rank number color" value={rankColor} onChange={onRankColor} />
      <LookColor label="Caption color" value={captionColor} onChange={onCaptionColor} />
    </div>
  );
}

function LookSize({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (size: number) => void;
}) {
  return (
    <label className="stack">
      <span>{label}</span>
      <span className="stroke-line">
        <input type="range" min={min} max={max} value={value} aria-label={label} onChange={(event) => onChange(Number(event.target.value))} />
        <input
          className="field stroke-num"
          type="number"
          min={min}
          max={max}
          value={value}
          aria-label={`${label} amount`}
          onChange={(event) => onChange(Number(event.target.value) || min)}
        />
      </span>
    </label>
  );
}

function LookPlace({ label, value, onChange }: { label: string; value: OverlayPlace; onChange: (place: OverlayPlace) => void }) {
  const places: { id: OverlayPlace; name: string }[] = [
    { id: "top", name: "Top" },
    { id: "middle", name: "Middle" },
    { id: "bottom", name: "Bottom" },
  ];
  return (
    <div className="stack">
      <span className="field-label">{label}</span>
      <div className="look-places" role="group" aria-label={label}>
        {places.map((place) => (
          <button
            key={place.id}
            type="button"
            className={value === place.id ? "count-btn on" : "count-btn"}
            aria-pressed={value === place.id}
            onClick={() => onChange(place.id)}
          >
            {place.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function LookColor({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const swatch = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#e2b340";
  return (
    <label className="stack">
      <span>{label}</span>
      <span className="look-swatches">
        {LOOK_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            className={swatch.toLowerCase() === hex ? "look-swatch on" : "look-swatch"}
            style={{ background: hex }}
            aria-label={`${label} ${hex}`}
            aria-pressed={swatch.toLowerCase() === hex}
            onClick={() => onChange(hex)}
          />
        ))}
      </span>
      <span className="color-line">
        <input type="color" value={swatch} aria-label={label} onChange={(event) => onChange(event.target.value)} />
        <input
          className="field hex"
          spellCheck={false}
          aria-label={`${label} hex`}
          value={(value.trim() || swatch).toUpperCase()}
          onChange={(event) => {
            const next = event.target.value.trim();
            onChange(next.startsWith("#") ? next : `#${next}`);
          }}
        />
      </span>
    </label>
  );
}

function paint(text: string, color: string, words: string) {
  const mark = accentOnPaper(color);
  const keys = words
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  return text.split("\n").map((line, lineIndex) => (
    <div key={lineIndex}>
      {line.split(/(\s+)/).map((part, index) => {
        const hit = keys.some((key) => part.toLowerCase().includes(key));
        return (
          <span
            key={index}
            style={{
              color: hit ? mark.color : "#1c1915",
              background: hit ? mark.background : undefined,
              borderRadius: hit && mark.background ? 6 : undefined,
              padding: hit && mark.background ? "0 4px" : undefined,
            }}
          >
            {part}
          </span>
        );
      })}
    </div>
  ));
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
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

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 7v10M8 8.5 14 12 8 15.5zM15 8.5 21 12l-6 3.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 7h3l10 10h3M14 7h6M17 4l3 3-3 3M4 17h3l3.2-3.2M14 17h6M17 14l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
