import { shelfName, spokenLine } from "./canvas";

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
