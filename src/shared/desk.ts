import { playbackOrder, shelfName, slotRank, spokenLine, type PlaybackMode } from "./canvas";
import { round3 } from "./model";

/** The desk clock. Minutes, seconds, and hundredths, always the same width. */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalCs = Math.round(safe * 100);
  const cs = totalCs % 100;
  const totalSecs = Math.floor(totalCs / 100);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const SLOT_TITLE_MAX = 36;

/** One short line for a slot. A caption wins. Otherwise the file name, cut down. */
export function slotListTitle(caption: string, fileName: string): string {
  const spoken = spokenLine(caption, fileName);
  const raw = spoken || (fileName ? shelfName(fileName).title : "");
  return shortenSlotTitle(raw);
}

export function shortenSlotTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const first = clean.split(/\s*[|•]\s*/)[0]?.trim() || clean;
  if (first.length <= SLOT_TITLE_MAX) return first;
  const slice = first.slice(0, SLOT_TITLE_MAX);
  const breakAt = slice.lastIndexOf(" ");
  return (breakAt >= 12 ? slice.slice(0, breakAt) : slice).replace(/[\s,;:–—-]+$/g, "").trim();
}

/** Cut length and file length in the same clock style. */
export function slotTimeLine(cutSec: number, fileSec: number): string {
  return `Cut ${formatClock(cutSec)} · File ${formatClock(fileSec)}`;
}

/**
 * A headline stays in the inspector unless it is already one short line
 * that can sit beside the rank.
 */
export function phoneHeadline(headline: string): string {
  const text = headline.trim();
  if (!text || /[\r\n]/.test(text)) return "";
  const line = text.replace(/\s+/g, " ");
  if (line.length > 28) return "";
  return line;
}

/** Play ranking starts on the filled slot in front of the person. */
export function rankingStartId(selectedId: string | undefined, filledIds: readonly string[]): string | null {
  if (selectedId && filledIds.includes(selectedId)) return selectedId;
  return filledIds[0] ?? null;
}

export type RankingStep = "play" | "hold" | "cut" | "stop";

/**
 * A ranking cut keeps the last frame until the next file already has its first frame.
 * Stopping, pausing, or clearing the live picture is not a cut.
 */
export function rankingStep(input: {
  mode: "file" | "cut";
  sequencing: boolean;
  currentTime: number;
  endSec: number;
  hasNext: boolean;
  nextReady: boolean;
}): RankingStep {
  const slack = input.mode === "cut" ? 0.02 : 0.08;
  if (!(input.currentTime >= input.endSec - slack)) return "play";
  if (input.mode !== "cut" || !input.sequencing || !input.hasNext) return "stop";
  return input.nextReady ? "cut" : "hold";
}

type FittedSlot = {
  mediaId: string | null;
  rank: number;
  keepEmpty?: boolean;
};

/**
 * A search that filled the top of a longer list should not leave numbered holes at the end.
 * Slots with clips stay. A slot someone asked to add can stay empty. The set is numbered from the top.
 */
export function fitRankingSlots<T extends FittedSlot>(slots: T[], keepAsked = true): T[] {
  if (!slots.some((item) => item.mediaId)) return slots;
  let end = slots.length;
  while (end > 0 && !slots[end - 1].mediaId && !(keepAsked && slots[end - 1].keepEmpty)) end -= 1;
  if (end === slots.length) return slots;
  const kept = slots.slice(0, end);
  return kept.map((item, index) => ({
    ...item,
    rank: slotRank(undefined, index, kept.length),
  }));
}

/** One sentence for the selected play order. Skip names only the ranks that will be heard. */
export function playbackSentence(
  mode: PlaybackMode,
  slots: { id: string; rank: number; previewUrl: string | null }[],
  orderIds: string[] = [],
): string {
  const heard = playbackOrder(slots, mode, orderIds).filter((item) => item.previewUrl);
  const order = heard.map((item) => `#${item.rank}`).join(", then ");
  if (mode === "countdown") return order ? `Plays the highest rank first: ${order}.` : "Plays the highest rank first.";
  if (mode === "listed") return order ? `Plays from the top of the list: ${order}.` : "Plays from the top of the list.";
  if (mode === "shuffle") return order ? `Plays ${order}, and the rank numbers stay.` : "Plays a mixed order, and the rank numbers stay.";
  return order ? `Plays ${order}.` : "Plays from the outside in.";
}

/** The shortest cut set by hand. A file shorter than this stays whole. */
export const HAND_CLIP_MIN = 1;

function handLimit(duration: number, inSec: number, outSec: number): number {
  if (duration > 0 && Number.isFinite(duration)) return duration;
  const end = Number.isFinite(outSec) ? outSec : 0;
  const start = Number.isFinite(inSec) ? inSec : 0;
  return Math.max(end, start, HAND_CLIP_MIN);
}

/** Keep a typed or dragged cut inside the file. One second is the shortest cut when the file is longer. */
export function fitHandRange(inSec: number, outSec: number, duration: number): { inSec: number; outSec: number } {
  const limit = handLimit(duration, inSec, outSec);
  const minSpan = Math.min(HAND_CLIP_MIN, limit);
  let start = Number.isFinite(inSec) ? inSec : 0;
  let end = Number.isFinite(outSec) ? outSec : start + minSpan;
  start = Math.min(Math.max(0, start), limit);
  end = Math.min(Math.max(0, end), limit);
  if (end < start) end = start;
  if (end - start < minSpan - 0.0005) {
    end = Math.min(limit, start + minSpan);
    if (end - start < minSpan - 0.0005) start = Math.max(0, end - minSpan);
  }
  return { inSec: round3(start), outSec: round3(end) };
}

/** Slide the cut without changing its length. */
export function shiftHandRange(inSec: number, outSec: number, delta: number, duration: number): { inSec: number; outSec: number } {
  const fitted = fitHandRange(inSec, outSec, duration);
  const span = fitted.outSec - fitted.inSec;
  const limit = duration > 0 && Number.isFinite(duration) ? duration : Math.max(fitted.outSec, fitted.inSec + span);
  let start = fitted.inSec + (Number.isFinite(delta) ? delta : 0);
  if (start < 0) start = 0;
  if (start + span > limit) start = Math.max(0, limit - span);
  return { inSec: round3(start), outSec: round3(start + span) };
}

/** The next sequence starts where this one ended and keeps the same length. */
export function nextSequenceRange(inSec: number, outSec: number, duration: number): { inSec: number; outSec: number } {
  const fitted = fitHandRange(inSec, outSec, duration);
  const limit = duration > 0 && Number.isFinite(duration) ? duration : fitted.outSec;
  const span = fitted.outSec - fitted.inSec;
  if (span >= limit - 0.05) return fitHandRange(0, limit, limit);
  if (fitted.outSec >= limit - 0.05) return setHandLength(0, span, limit);
  return setHandLength(fitted.outSec, span, limit);
}

/** A typed length stays with the start, and slides earlier only when the file ends first. */
export function setHandLength(inSec: number, length: number, duration: number): { inSec: number; outSec: number } {
  const limit = handLimit(duration, inSec, inSec + (Number.isFinite(length) ? length : HAND_CLIP_MIN));
  const span = Math.min(Math.max(Number.isFinite(length) ? length : HAND_CLIP_MIN, Math.min(HAND_CLIP_MIN, limit)), limit);
  let start = Number.isFinite(inSec) ? Math.max(0, inSec) : 0;
  if (start + span > limit) start = Math.max(0, limit - span);
  return fitHandRange(start, start + span, limit);
}
