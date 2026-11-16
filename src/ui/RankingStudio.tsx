import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  assignLinesInOrder,
  builtinTemplates,
  flickFromTemplate,
  importedLines,
  lineSizeOf,
  playbackOrder,
  rankingClipRange,
  shelfName,
  shuffleIds,
  storedLineColor,
  storedLineSize,
  storedTitleFont,
  storedWarmth,
  titleFontFamily,
  titleFontOf,
  warmthOf,
  warmthWash,
  type PlaybackMode,
} from "../shared/canvas";
import { round3, uid, type Flick, type Template } from "../shared/model";
import type { AssistClip } from "../shared/assist";
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

function makeSlots(count: number): Slot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: uid(),
    rank: count - index,
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

function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function orderWords(mode: PlaybackMode, rows: { id: string; rank: number }[]): string {
  if (mode === "countdown") return "Plays the highest rank first.";
  if (mode === "listed") return "Plays the slots from the top of the list.";
  if (mode === "shuffle") return "Plays a mixed order. Rank numbers stay.";
  const ranks = playbackOrder(rows, "skip").map((item) => item.rank);
  return `Plays ${ranks.join(", then ")}.`;
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

function clampOut(next: number, inSec: number, duration: number): number {
  const cap = duration > 0 ? duration : next;
  return round3(Math.max(inSec + 0.1, Math.min(Math.max(0, next), cap)));
}

function clampIn(next: number, outSec: number, duration: number): number {
  const end = duration > 0 ? Math.min(outSec, duration) : outSec;
  return round3(Math.min(Math.max(0, next), Math.max(0, end - 0.1)));
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
}: {
  onBack: () => void;
  onOpen: (dir: string, flickId: string) => void;
}) {
  const [dir, setDir] = useState<string | null>(null);
  const [headline, setHeadline] = useState("Ranking the funniest\ncartoon moments");
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
  const slot = slots[selected];
  const preview = useRef<HTMLVideoElement>(null);
  const wantPlay = useRef(false);
  const playAll = useRef(false);
  const playQueue = useRef<string[]>([]);
  const handingOff = useRef(false);
  const span = useRef<"file" | "cut">("file");
  const readySlot = useRef<string | null>(null);

  useEffect(() => {
    const video = preview.current;
    if (!video || !slot?.previewUrl) {
      setPlaying(false);
      setNowSec(0);
      return;
    }
    let cancel = false;
    handingOff.current = false;
    readySlot.current = null;
    const park = () => {
      if (cancel) return;
      const target = span.current === "cut" ? Math.max(0, slot.inSec) : 0;
      const go = () => {
        if (cancel) return;
        readySlot.current = slot.id;
        setNowSec(target);
        if (wantPlay.current) {
          void video.play().then(() => setPlaying(true)).catch(() => {
            wantPlay.current = false;
            setPlaying(false);
          });
          return;
        }
        video.pause();
        setPlaying(false);
      };
      if (Math.abs(video.currentTime - target) < 0.05) {
        go();
        return;
      }
      const done = () => {
        video.removeEventListener("seeked", done);
        if (!cancel) go();
      };
      video.addEventListener("seeked", done);
      video.currentTime = target;
    };
    if (video.readyState >= 1) park();
    else video.addEventListener("loadeddata", park);
    return () => {
      cancel = true;
      video.removeEventListener("loadeddata", park);
    };
  }, [slot?.id, slot?.previewUrl, slot?.inSec]);

  function filledIds(): string[] {
    return playbackOrder(slots, playback, orderIds)
      .filter((item) => item.previewUrl)
      .map((item) => item.id);
  }

  function stopSequence() {
    playAll.current = false;
    playQueue.current = [];
    handingOff.current = false;
    setPlayKind(null);
  }

  function endSec(current: Slot, video: HTMLVideoElement): number {
    if (span.current === "cut") return current.outSec;
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    if (current.duration > 0) return current.duration;
    return current.outSec;
  }

  async function startPlay(id: string, mode: "file" | "cut", fromStart: boolean) {
    const index = slots.findIndex((item) => item.id === id);
    const target = index >= 0 ? slots[index] : undefined;
    if (!target?.previewUrl) return;
    span.current = mode;
    wantPlay.current = true;
    setPlayKind(playAll.current ? "ranking" : "clip");
    if (index !== selected) {
      readySlot.current = null;
      setSelected(index);
      return;
    }
    const video = preview.current;
    if (!video) return;
    const start = mode === "cut" ? Math.max(0, target.inSec) : 0;
    const end = mode === "cut" ? target.outSec : (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : target.duration || target.outSec);
    const outside = video.currentTime < start - 0.05 || video.currentTime >= end - 0.08;
    if ((fromStart || outside) && Math.abs(video.currentTime - start) >= 0.05) {
      readySlot.current = null;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener("seeked", finish);
          window.clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(finish, 800);
        video.addEventListener("seeked", finish);
        video.currentTime = start;
      });
    }
    if (fromStart || outside) setNowSec(start);
    readySlot.current = target.id;
    try {
      await video.play();
      setPlaying(true);
    } catch {
      wantPlay.current = false;
      setPlaying(false);
      setPlayKind(null);
    }
  }

  function pausePreview() {
    stopSequence();
    wantPlay.current = false;
    preview.current?.pause();
    setPlaying(false);
  }

  function playRanking() {
    if (playing && playKind === "ranking") {
      pausePreview();
      return;
    }
    const order = filledIds();
    if (!order.length) {
      setMessage(slots.some((item) => item.mediaId) ? "That clip has no preview yet." : "Add a clip to play.");
      return;
    }
    playAll.current = true;
    playQueue.current = order.slice(1);
    handingOff.current = false;
    void startPlay(order[0], "cut", true);
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
    void startPlay(current.id, "file", true);
  }

  function advanceOrStop(current: Slot) {
    if (handingOff.current) return;
    while (playAll.current && playQueue.current.length) {
      const nextId = playQueue.current.shift();
      const next = nextId ? slots.findIndex((item) => item.id === nextId && item.previewUrl) : -1;
      if (next < 0) continue;
      handingOff.current = true;
      readySlot.current = null;
      span.current = "cut";
      wantPlay.current = true;
      preview.current?.pause();
      setSelected(next);
      return;
    }
    stopSequence();
    preview.current?.pause();
    wantPlay.current = false;
    setPlaying(false);
    const video = preview.current;
    const end = video ? endSec(current, video) : current.duration;
    setNowSec(end);
  }

  function onPreviewTime() {
    const video = preview.current;
    const current = slots[selected];
    if (!video || !current?.previewUrl || handingOff.current) return;
    if (readySlot.current !== current.id) return;
    if (span.current === "cut" && video.currentTime + 0.05 < current.inSec) return;
    const end = endSec(current, video);
    const slack = span.current === "cut" ? 0.02 : 0.08;
    if (video.currentTime >= end - slack) {
      advanceOrStop(current);
      return;
    }
    setNowSec(video.currentTime);
  }

  function onPreviewEnded() {
    const current = slots[selected];
    if (!current?.previewUrl) return;
    advanceOrStop(current);
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
        rank: count - index,
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
        const rankMatch = /^#(\d+)$/.exec(clip.label);
        return {
          id: uid(),
          rank: rankMatch ? Number(rankMatch[1]) : ranked.length - index,
          title: clip.line || (rankMatch ? "" : clip.label),
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
      setMessage("Paste one line per slot.");
      return;
    }
    const ids = slots.map((item) => item.id);
    const startId = slots[selected]?.id ?? ids[0] ?? "";
    const assigned = assignLinesInOrder(ids, lines, startId);
    setSlots((rows) => rows.map((item) => (assigned.has(item.id) ? { ...item, title: assigned.get(item.id) ?? item.title } : item)));
    setMessage(assigned.size === 1 ? "Put 1 line on the slots." : `Put ${assigned.size} lines on the slots.`);
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
    if (dir) return dir;
    const recent = await window.flicks!.recent();
    const existing = recent[0]?.path;
    if (existing) {
      setDir(existing);
      return existing;
    }
    const parent = await window.flicks!.pickDirectory();
    if (!parent) return null;
    const created = await window.flicks!.createChannel(parent, "Ranking");
    if (!created.ok || !created.dir) {
      setMessage(created.message ?? "Could not create the channel.");
      return null;
    }
    setDir(created.dir);
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
        title: current.title || result.asset.name.replace(/\.[^.]+$/, ""),
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
        title: current?.title || result.asset.name.replace(/\.[^.]+$/, ""),
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
      const created = await window.flicks!.createFlick(folder, name, "builtin-ranking");
      if (!created.ok || !created.flick) {
        setMessage(created.message ?? "Could not open the timeline.");
        return;
      }
      const ordered = playbackOrder(slots, playback, orderIds);
      let cursor = 0;
      const clips = ordered
        .filter((item) => item.mediaId)
        .map((item) => {
          const range = rankingClipRange(item.inSec, item.outSec, item.duration);
          const clip = {
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
      const loop = created.flick.clips.find((clip) => clip.label === "Loop");
      const flick: Flick = {
        ...created.flick,
        name,
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
        clips: loop ? [...clips, { ...loop, id: uid(), startSec: 0, outSec: round3(cursor || 3) }] : clips,
      };
      const saved = await window.flicks!.saveFlick(folder, flick);
      if (!saved.ok || !saved.flick) {
        setMessage(saved.message ?? "Could not save the ranking.");
        return;
      }
      onOpen(folder, saved.flick.id);
    } finally {
      setBusy(false);
    }
  }

  const assistClips: AssistClip[] = slots.flatMap((item) => {
    const line = item.title.trim();
    const fromFile = item.mediaName ? shelfName(item.mediaName).title : "";
    const name = line || fromFile;
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
                  }
                  setSelected(index);
                }}
              >
                <b>#{item.rank}</b>
                <span className="slot-copy">
                  <span className="slot-name">{item.mediaId ? item.title || item.mediaName || "Clip" : "Empty slot"}</span>
                  {item.mediaId ? (
                    <span className="slot-time">
                      Cut {formatSpan(item.outSec - item.inSec)} · File {formatSpan(item.duration)}
                    </span>
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
            <div className="phone-scene">
              <span className="scene-path" />
              <span className="scene-tree" />
            </div>
            {slot?.previewUrl ? (
              <video
                ref={preview}
                src={slot.previewUrl}
                playsInline
                style={{ objectPosition: `${(slot.focus ?? 0.5) * 100}% center` }}
                onTimeUpdate={onPreviewTime}
                onEnded={onPreviewEnded}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            ) : null}
            {wash ? <div className="phone-warmth" style={{ background: wash }} /> : null}
            {headline.trim() ? (
              <div className="phone-title" style={{ fontFamily: titleFontFamily(font) }}>
                {paint(headline, swatch, accentWords)}
              </div>
            ) : null}
            {showRank ? (
              <div className="phone-rank" style={{ fontFamily: titleFontFamily(font) }}>
                #{slot?.rank}
              </div>
            ) : null}
            {showCaptions && slot?.title ? (
              <div
                className="phone-clip"
                style={{
                  fontFamily: titleFontFamily(font),
                  color: /^#[0-9a-fA-F]{6}$/.test(lineColor) ? lineColor : "#fff",
                  fontSize: Math.round(lineSizeOf(lineSize) * 0.36),
                  WebkitTextStroke: `${stroke}px #111`,
                }}
              >
                {slot.title}
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
  const ink = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#e2b340";
  const keys = words
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  return text.split("\n").map((line, lineIndex) => (
    <div key={lineIndex}>
      {line.split(/(\s+)/).map((part, index) => (
        <span key={index} style={{ color: keys.some((key) => part.toLowerCase().includes(key)) ? ink : "#fff" }}>
          {part}
        </span>
      ))}
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
