import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  accentOnPaper,
  assignLinesInOrder,
  builtinTemplates,
  flickFromTemplate,
  inkOnPaper,
  importedLines,
  lineSizeOf,
  playbackOrder,
  rankingClipRange,
  shuffleIds,
  slotRank,
  spokenLine,
  storedLineColor,
  storedLineSize,
  storedTitleFont,
  storedWarmth,
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
import { formatClock, phoneHeadline, rankingStartId, rankingStep, slotListTitle, slotTimeLine } from "../shared/desk";
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

function orderWords(mode: PlaybackMode, rows: { id: string; rank: number }[]): string {
  if (mode === "countdown") return "Plays the highest rank first.";
  if (mode === "listed") return "Plays the slots from the top of the list.";
  if (mode === "shuffle") return "Plays a mixed order. Rank numbers stay.";
  const ranks = playbackOrder(rows, "skip").map((item) => item.rank);
  return `Plays ${ranks.join(", then ")}.`;
}

function clampOut(next: number, inSec: number, duration: number): number {
  const cap = duration > 0 ? duration : next;
  return round3(Math.max(inSec + 0.1, Math.min(Math.max(0, next), cap)));
}

function clampIn(next: number, outSec: number, duration: number): number {
  const end = duration > 0 ? Math.min(outSec, duration) : outSec;
  return round3(Math.min(Math.max(0, next), Math.max(0, end - 0.1)));
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

function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

function deskStorageKey(channelDir?: string): string {
  return `go7-flicks-desk:${channelDir || "none"}:ranking`;
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
  const count = ranked.length > 7 ? ranked.length : Math.min(7, Math.max(5, ranked.length || 5));
  return Array.from({ length: count }, (_, index) => {
    const clip = ranked[index];
    const blank = makeSlots(1)[0];
    if (!clip) return { ...blank, rank: slotRank(undefined, index, count) };
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
  });
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
  const [warmth, setWarmth] = useState(0);
  const [pasted, setPasted] = useState("");
  const [subject, setSubject] = useState("");
  const [playback, setPlayback] = useState<PlaybackMode>("countdown");
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slot[]>(() => makeSlots(5));
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipes, setRecipes] = useState<Template[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playKind, setPlayKind] = useState<"ranking" | "clip" | null>(null);
  const [nowSec, setNowSec] = useState(0);
  const [liveFace, setLiveFace] = useState<0 | 1>(0);
  const slot = slots[selected];
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
  const readySlot = useRef<string | null>(null);
  const frameWatch = useRef(0);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const keepDraft = useRef(true);
  const draftKey = deskStorageKey(channelDir);
  const [boundKey, setBoundKey] = useState<string | null>(null);
  const folderLabel = announced || (dir ? folderName(dir) : "");

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
          setWarmth(warmthOf(flick.pictureWarmth));
          setSlots(slotsFromFlick(flick, result.media ?? []));
          setPlayback("listed");
          setOrderIds([]);
          setSelected(0);
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
      if (typeof stored.warmth === "number") setWarmth(stored.warmth);
      if (typeof stored.pasted === "string") setPasted(stored.pasted);
      if (typeof stored.subject === "string") setSubject(stored.subject);
      if (stored.playback === "countdown" || stored.playback === "listed" || stored.playback === "skip" || stored.playback === "shuffle") {
        setPlayback(stored.playback);
      }
      if (Array.isArray(stored.orderIds)) setOrderIds(stored.orderIds.filter((item) => typeof item === "string"));
      if (stored.slots?.length) {
        setSlots(
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
          })),
        );
      }
      if (typeof stored.selected === "number") setSelected(stored.selected);
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
    if (playing && playKind === "ranking") {
      pausePreview();
      return;
    }
    const order = filledIds();
    const startId = rankingStartId(slots[selected]?.id, order);
    if (!startId) {
      setMessage(slots.some((item) => item.mediaId) ? "That clip has no preview yet." : "Add a clip to play.");
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
    if (playing && playKind === "clip") {
      pausePreview();
      return;
    }
    stopSequence();
    const current = slots[selected];
    if (!current?.previewUrl) {
      setMessage(current?.mediaId ? "That clip has no preview yet." : "This slot has no clip.");
      return;
    }
    void startPlay(current.id, "file");
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
    if (count === slots.length) return;
    pausePreview();
    setSlots((rows) =>
      makeSlots(count).map((item, index) => ({
        ...item,
        ...(rows[index] ?? {}),
        rank: slotRank(undefined, index, count),
        id: rows[index]?.id ?? item.id,
      })),
    );
    setSelected((index) => Math.min(count - 1, Math.max(0, index)));
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
    base.pictureWarmth = storedWarmth(warmth);
    const result = await window.flicks!.saveTemplate(base, title);
    setMessage(result.ok ? `Saved “${title}”. This order and these words can run again.` : result.message ?? "Could not save that template.");
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
    setMessage(`Loaded “${template.name}”. Add the clips, then open the timeline.`);
  }

  function pasteLines() {
    const lines = importedLines(pasted);
    if (!lines.length) {
      setMessage("Paste one caption per slot.");
      return;
    }
    const ids = slots.map((item) => item.id);
    const startId = slots[selected]?.id ?? ids[0] ?? "";
    const assigned = assignLinesInOrder(ids, lines, startId);
    setSlots((rows) => rows.map((item) => (assigned.has(item.id) ? { ...item, title: assigned.get(item.id) ?? item.title } : item)));
    setMessage(assigned.size === 1 ? "Put 1 caption on the slots." : `Put ${assigned.size} captions on the slots.`);
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
      setMessage(created.message ?? "Could not create the channel.");
      return null;
    }
    setDir(created.dir);
    setAnnounced(folderName(created.dir));
    return created.dir;
  }

  async function findClips() {
    const name = subject.trim();
    if (!name) {
      setMessage("Name a subject.");
      return;
    }
    const empty = slots.filter((item) => !item.mediaId).length;
    if (!empty) {
      setMessage("Those slots are already filled.");
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
        setMessage(result.message ?? "Could not find clips for that subject.");
        return;
      }
      let placed = 0;
      let first = -1;
      flushSync(() => {
        setSlots((rows) => {
          const before = rows.map((item) => item.mediaId);
          const next = placeFoundClips(rows, result.clips!);
          placed = next.placed;
          first = next.slots.findIndex((item, index) => item.mediaId && item.mediaId !== before[index]);
          return next.slots;
        });
      });
      if (first >= 0) setSelected(first);
      if (!placed) {
        setMessage("Those slots are already filled.");
        return;
      }
      const line = subjectLine(name);
      setHeadline(line.headline);
      setAccentWords(line.accent);
      setMessage(result.workingCopy ? "Working copies are on this computer." : result.message ?? `Found ${placed} clips.`);
    } finally {
      setBusy(false);
    }
  }

  function fillSlot(index: number, next: Partial<Slot>) {
    setSlots((rows) => rows.map((item, row) => (row === index ? { ...item, ...next } : item)));
  }

  async function getClip() {
    const index = selected;
    const current = slots[index];
    if (!current?.note.trim()) {
      setMessage("Paste a link.");
      return;
    }
    setBusy(true);
    setMessage("Getting the clip…");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const result = await window.flicks!.downloadMedia(folder, current.note);
      if (!result.ok || !result.asset) {
        setMessage(result.message ?? "Could not get that clip.");
        return;
      }
      const resolved = result.media?.find((item) => item.id === result.asset?.id);
      const duration = result.asset.durationSec || 3;
      fillSlot(index, {
        mediaId: result.asset.id,
        mediaName: result.asset.name,
        madeAt: resolved?.madeAt,
        previewUrl: resolved?.previewUrl ?? null,
        duration,
        inSec: 0,
        outSec: Math.min(4, Math.max(0.4, duration)),
        title: captionFromFile(current.title, result.asset.name),
        focus: 0.5,
        note: result.sourceUrl || current.note,
      });
      setMessage(result.workingCopy ? "Working copy is on this computer." : result.asset.name);
    } finally {
      setBusy(false);
    }
  }

  async function addClip() {
    const index = selected;
    const current = slots[index];
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
      const duration = result.asset.durationSec || 3;
      fillSlot(index, {
        mediaId: result.asset.id,
        mediaName: result.asset.name,
        madeAt: resolved?.madeAt,
        previewUrl: resolved?.previewUrl ?? null,
        duration,
        inSec: 0,
        outSec: Math.min(4, Math.max(0.4, duration)),
        title: captionFromFile(current?.title, result.asset.name),
        focus: 0.5,
      });
      if (result.workingCopy) setMessage("Working copy is on this computer.");
    } finally {
      setBusy(false);
    }
  }

  async function openTimeline() {
    if (!slots.some((item) => item.mediaId)) {
      setMessage("Add at least one clip.");
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
          setMessage(loaded.message ?? "Could not open the timeline.");
          return;
        }
        existing = loaded.flick;
      }
      let shell = existing;
      if (!shell) {
        const created = await window.flicks!.createFlick(folder, name, "builtin-ranking");
        if (!created.ok || !created.flick) {
          setMessage(created.message ?? "Could not open the timeline.");
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
        setMessage(saved.message ?? "Could not save the ranking.");
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
  const headlineOnPhone = phoneHeadline(headline);
  const sequence = playbackOrder(slots, playback, orderIds);
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
        <strong>Video ranking</strong>
        {folderLabel ? <span className="timeline-hint">{folderLabel}</span> : null}
        <div className="timeline-open">
          <button className="btn-gold" disabled={busy} onClick={() => void openTimeline()}>
            <TimelineIcon />
            Open timeline
          </button>
          <span className="timeline-hint">Opens the full timeline</span>
        </div>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="studio-body">
        <aside className="rail stack rank-rail">
          <p className="rail-label">Slots</p>
          <div className="count-row" role="group" aria-label="How many slots">
            {[5, 6, 7].map((count) => (
              <button
                key={count}
                className={slots.length === count ? "count-btn on" : "count-btn"}
                aria-pressed={slots.length === count}
                onClick={() => setCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <div className="slot-list">
            {slots.map((item, index) => (
              <button
                key={item.id}
                className={index === selected ? "slot on" : "slot"}
                onClick={() => {
                  if (index !== selected) {
                    stopSequence();
                    wantPlay.current = false;
                    span.current = "file";
                    nodeAt(liveDeck.current)?.pause();
                  }
                  setSelected(index);
                }}
              >
                <b>#{item.rank}</b>
                <span className="slot-copy">
                  <span className="slot-name">
                    {item.mediaId ? slotListTitle(item.title, item.mediaName) || "Clip" : "Empty slot"}
                  </span>
                  {item.mediaId ? (
                    <span className="slot-time">{slotTimeLine(item.outSec - item.inSec, item.duration)}</span>
                  ) : null}
                </span>
                {item.mediaId ? <em>Play {playAt.get(item.id)}</em> : null}
              </button>
            ))}
          </div>
          <div className="order-stack">
            <button className={playback === "countdown" ? "order-btn on" : "order-btn"} onClick={() => setPlayback("countdown")}>
              <ClockIcon />
              Countdown
            </button>
            <button className={playback === "listed" ? "order-btn on" : "order-btn"} onClick={() => setPlayback("listed")}>
              <ListIcon />
              Listed
            </button>
            <button className={playback === "skip" ? "order-btn on" : "order-btn"} onClick={() => setPlayback("skip")}>
              <SkipIcon />
              Skip around
            </button>
            <button className={playback === "shuffle" ? "order-btn on" : "order-btn"} onClick={shuffle}>
              <ShuffleIcon />
              Shuffle
            </button>
          </div>
          <p className="order-hint">{orderWords(playback, slots)}</p>
          <button className="btn desk-save" onClick={() => void saveRecipe()}>
            Save template
          </button>
          {recipes.length ? (
            <div className="order-stack">
              {recipes.map((recipe) => (
                <button key={recipe.id} className="choice" onClick={() => loadRecipe(recipe)}>
                  {recipe.name}
                </button>
              ))}
            </div>
          ) : null}
        </aside>
        <div className="stage-wrap">
          <div className="phone-stage">
            <div
              className={slot?.previewUrl ? "phone phone-play" : "phone"}
              onClick={playRanking}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  playRanking();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={playing && playKind === "ranking" ? "Pause the ranking" : "Play the ranking"}
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
                <p className="phone-empty">{slot?.mediaId ? "No preview yet" : "Add a clip"}</p>
              )}
              {wash ? <div className="phone-warmth" style={{ background: wash }} /> : null}
              {headlineOnPhone ? (
                <div className="phone-title" style={{ fontFamily: titleFontFamily(font) }}>
                  {paint(headlineOnPhone, swatch, accentWords)}
                </div>
              ) : null}
              {showCaptions && phoneCaption ? (
                <div
                  className="phone-clip"
                  style={{
                    fontFamily: titleFontFamily(font),
                    color: inkOnPaper(lineColor),
                    fontSize: Math.min(18, Math.max(14, Math.round(lineSizeOf(lineSize) * 0.22))),
                  }}
                >
                  {phoneCaption}
                </div>
              ) : null}
            </div>
            {showRank ? (
              <div className="phone-rank" style={{ fontFamily: titleFontFamily(font) }}>
                {slot?.rank}
              </div>
            ) : null}
          </div>
          <div className="desk-play">
            <button type="button" className="btn-gold" onClick={playRanking}>
              {playing && playKind === "ranking" ? "Pause" : "Play ranking"}
            </button>
            <button type="button" className="desk-play-all" onClick={playThisClip}>
              {playing && playKind === "clip" ? "Pause" : "This clip"}
            </button>
            <span className="desk-clock">{formatClock(slot?.previewUrl ? nowSec : 0)}</span>
          </div>
        </div>
        <aside className="inspector stack rank-inspector">
          <div className="desk-focus find-subject">
            <label className="stack">
              <span>Subject</span>
              <span className="link-line">
                <input
                  className="field"
                  value={subject}
                  placeholder="Name a subject"
                  onChange={(event) => setSubject(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void findClips();
                  }}
                />
                <button className="btn-primary" type="button" disabled={busy} onClick={() => void findClips()}>
                  Find clips
                </button>
              </span>
            </label>
          </div>
          <div className="desk-focus">
            <label className="stack">
              <span>Headline</span>
              <textarea className="field" rows={2} value={headline} onChange={(event) => setHeadline(event.target.value)} />
            </label>
            <label className="stack">
              <span>Accent words</span>
              <input className="field" value={accentWords} onChange={(event) => setAccentWords(event.target.value)} />
            </label>
            <div className="toggle-line">
              <span>Show the rank number</span>
              <button type="button" className={showRank ? "switch on" : "switch"} role="switch" aria-checked={showRank} onClick={() => setShowRank((value) => !value)} />
            </div>
            <div className="toggle-line">
              <span>Show captions</span>
              <button type="button" className={showCaptions ? "switch on" : "switch"} role="switch" aria-checked={showCaptions} aria-label="Show captions" onClick={() => setShowCaptions((value) => !value)} />
            </div>
          </div>
          <WhichClip
            clips={assistClips}
            disabled={busy}
            onHeadline={setHeadline}
            onTitle={(id, title) => setSlots((rows) => rows.map((item) => (item.id === id ? { ...item, title } : item)))}
          />
          <label className="stack">
            <span>Highlight color</span>
            <span className="color-line">
              <input type="color" value={swatch} aria-label="Color" onChange={(event) => setColor(event.target.value)} />
              <input
                className="field hex"
                spellCheck={false}
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
            <p className="muted tiny">Saved on the flick. The paper pill keeps the words clear.</p>
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
            pasteHint="One caption per slot, from the selected slot down."
            onFont={setFont}
            onLineSize={(size) => setLineSize(lineSizeOf(size))}
            onLineColor={setLineColor}
            onWarmth={setWarmth}
            onPasted={setPasted}
            onPaste={pasteLines}
          />
          {slot ? (
            <>
              <div className="add-line">
                <span>Add clip</span>
                <button className="plus" disabled={busy} aria-label="Add clip" onClick={() => void addClip()}>
                  +
                </button>
              </div>
              {slot.mediaName ? <p className="file-note">{slot.mediaName}</p> : null}
              <label className="stack">
                <span>Caption</span>
                <input className="field" aria-label="Caption" value={slot.title} onChange={(event) => patch({ title: event.target.value })} />
              </label>
              <label className="stack">
                <span>Link</span>
                <span className="link-line">
                  <input
                    className="field"
                    value={slot.note}
                    placeholder="Paste a link"
                    onChange={(event) => patch({ note: event.target.value })}
                  />
                  <button className="btn-small btn" disabled={busy} onClick={() => void getClip()}>
                    Get
                  </button>
                </span>
              </label>
              <div className="stack">
                <span className="field-label">In and Out</span>
                <div className="inout">
                  <ClockField
                    key={`${slot.id}-in`}
                    label="In"
                    value={slot.inSec}
                    onCommit={(next) => writeSlot(slot.id, (row) => ({ inSec: clampIn(next, row.outSec, row.duration) }))}
                  />
                  <span className="inout-dash">–</span>
                  <ClockField
                    key={`${slot.id}-out`}
                    label="Out"
                    value={slot.outSec}
                    onCommit={(next) => writeSlot(slot.id, (row) => ({ outSec: clampOut(next, row.inSec, row.duration) }))}
                  />
                </div>
                {slot.duration > 0 ? <p className="muted">This file is {slot.duration.toFixed(1)}s. In and out stay inside it.</p> : null}
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
        </aside>
      </div>
    </div>
  );
}

function ClockField({ label, value, onCommit }: { label: string; value: number; onCommit: (next: number) => void }) {
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
