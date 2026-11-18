import {
  type Clip,
  type Flick,
  type Region,
  type Template,
  type Track,
  FRAME,
  clipDuration,
  round3,
  timelineEnd,
  uid,
} from "./model";

export type PlaybackMode = "countdown" | "listed" | "shuffle" | "skip";

export const DUAL_FACE = "track-face";
export const DUAL_GAME = "track-game";

export type DualArrangement = "face-top" | "game-top";
export type DualPreset = "half" | "face-larger" | "game-larger";

export function playbackOrder<T extends { id: string; rank: number }>(
  slots: T[],
  mode: PlaybackMode,
  shuffleIds: string[] = [],
): T[] {
  if (mode === "countdown") return [...slots].sort((a, b) => b.rank - a.rank);
  if (mode === "skip") return skipAround(slots);
  if (mode === "shuffle") {
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const ordered = shuffleIds.map((id) => byId.get(id)).filter((slot): slot is T => Boolean(slot));
    const seen = new Set(ordered.map((slot) => slot.id));
    return [...ordered, ...slots.filter((slot) => !seen.has(slot.id))];
  }
  return [...slots];
}

/** Outside-in by rank number. Five ranks play 1, 5, 2, 4, 3. Three play 1, 3, 2. */
export function skipAround<T extends { rank: number }>(slots: T[]): T[] {
  const byRank = [...slots].sort((a, b) => a.rank - b.rank);
  const next: T[] = [];
  let left = 0;
  let right = byRank.length - 1;
  while (left <= right) {
    next.push(byRank[left]);
    left += 1;
    if (left <= right) {
      next.push(byRank[right]);
      right -= 1;
    }
  }
  return next;
}

export function shuffleIds(ids: string[]): string[] {
  const next = [...ids];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

export function builtinTemplates(): Template[] {
  const top = "track-top";
  const bottom = "track-bottom";
  const video = "track-video";
  const splitClips: Clip[] = [
    slot("hook", top, 0, 3, "Hook"),
    slot("beat", top, 3, 3, "Beat"),
    slot("payoff", top, 6, 3, "Payoff"),
    slot("loop", bottom, 0, 9, "Loop"),
  ];
  return [
    {
      id: "builtin-split",
      name: "Split screen",
      builtin: true,
      ...FRAME,
      regions: [
        region("region-top", top, 0, 0.6),
        region("region-bottom", bottom, 0.6, 0.4),
      ],
      tracks: [
        track(top, "Top", false),
        track(bottom, "Bottom", true),
      ],
      clips: splitClips,
    },
    {
      id: "builtin-dual",
      name: "Dual video",
      builtin: true,
      ...FRAME,
      regions: [
        region("region-face", DUAL_FACE, 0, 0.5),
        region("region-game", DUAL_GAME, 0.5, 0.5),
      ],
      tracks: [
        track(DUAL_FACE, "Face", false),
        track(DUAL_GAME, "Gameplay", false),
      ],
      clips: [
        slot("dual-face", DUAL_FACE, 0, 8, "Face"),
        slot("dual-game", DUAL_GAME, 0, 8, "Gameplay"),
      ],
    },
    {
      id: "builtin-ranking",
      name: "Video ranking",
      builtin: true,
      ...FRAME,
      regions: [
        region("region-rank", top, 0, 0.62),
        region("region-loop", bottom, 0.62, 0.38),
      ],
      tracks: [
        track(top, "Rank", false),
        track(bottom, "Loop", true),
      ],
      clips: [
        slot("rank-5", top, 0, 2.4, "#5"),
        slot("rank-4", top, 2.4, 2.4, "#4"),
        slot("rank-3", top, 4.8, 2.4, "#3"),
        slot("rank-2", top, 7.2, 2.4, "#2"),
        slot("rank-1", top, 9.6, 2.4, "#1"),
        slot("rank-loop", bottom, 0, 12, "Loop"),
      ],
    },
    {
      id: "builtin-blank",
      name: "Blank",
      builtin: true,
      ...FRAME,
      regions: [region("region-full", video, 0, 1)],
      tracks: [track(video, "Video", false)],
      clips: [],
    },
  ];
}

export const TITLE_FONTS = ["Segoe UI", "Arial", "Georgia", "Impact"] as const;

export const LINE_SIZE_MIN = 48;
export const LINE_SIZE_MAX = 120;
export const LINE_SIZE_DEFAULT = 72;
export const WARMTH_MIN = -40;
export const WARMTH_MAX = 40;

export function titleFontOf(value: string | undefined): (typeof TITLE_FONTS)[number] {
  return (TITLE_FONTS as readonly string[]).includes(value ?? "") ? (value as (typeof TITLE_FONTS)[number]) : "Segoe UI";
}

export function storedTitleFont(value: string | undefined): string | undefined {
  return (TITLE_FONTS as readonly string[]).includes(value ?? "") ? value : undefined;
}

export function titleFontFamily(value: string | undefined): string {
  const face = titleFontOf(value);
  return `"${face}", ${face === "Georgia" ? "serif" : "sans-serif"}`;
}

export function lineSizeOf(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return LINE_SIZE_DEFAULT;
  return Math.min(LINE_SIZE_MAX, Math.max(LINE_SIZE_MIN, Math.round(value)));
}

export function storedLineSize(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return lineSizeOf(value);
}

export function lineColorOf(value: string | undefined): string {
  return /^#[0-9a-fA-F]{6}$/.test(value?.trim() ?? "") ? (value as string).trim() : "#ffffff";
}

/** A paper pill. Light colors, including the default white, become ink so the words stay readable. */
export function inkOnPaper(value: string | undefined): string {
  const hex = lineColorOf(value).toLowerCase();
  return lightOnPaper(hex) ? "#1c1915" : hex;
}

/**
 * Accent words on a paper pill.
 * A dark chosen color stays the text. Gold, white, and other light colors become a highlight behind ink.
 */
export function accentOnPaper(value: string | undefined): { color: string; background?: string } {
  const raw = value?.trim() ?? "";
  const hex = (/^#[0-9a-fA-F]{6}$/.test(raw) ? raw : "#e2b340").toLowerCase();
  if (!lightOnPaper(hex)) return { color: hex };
  const background = hex === "#ffffff" || hex === "#fffdf8" ? "#e2b340" : hex;
  return { color: "#1c1915", background };
}

function lightOnPaper(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return true;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62;
}

export function storedLineColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : undefined;
}

export function warmthOf(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(WARMTH_MAX, Math.max(WARMTH_MIN, Math.round(value)));
}

export function storedWarmth(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const next = warmthOf(value);
  return next === 0 ? undefined : next;
}

/** A soft wash over the picture. Cool is blue. Warm is orange. Zero leaves the picture alone. */
export function warmthWash(value: number | undefined): string | null {
  const amount = warmthOf(value);
  if (!amount) return null;
  const alpha = Math.abs(amount) / 80;
  const rgb = amount > 0 ? "255, 148, 46" : "64, 140, 255";
  return `rgba(${rgb}, ${alpha.toFixed(3)})`;
}

export function importedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** One pasted line per id, starting at startId and moving forward. */
export function assignLinesInOrder(ids: string[], lines: string[], startId: string): Map<string, string> {
  const start = ids.indexOf(startId);
  const from = start < 0 ? 0 : start;
  const assigned = new Map<string, string>();
  ids.slice(from).forEach((id, index) => {
    if (index < lines.length) assigned.set(id, lines[index]);
  });
  return assigned;
}

export function flickFromTemplate(template: Template, name: string): Flick {
  const flick: Flick = {
    id: uid(),
    name,
    fps: template.fps,
    width: template.width,
    height: template.height,
    regions: template.regions.map((item) => ({ ...item, id: uid() })),
    tracks: template.tracks.map((item) => ({ ...item })),
    clips: template.clips.map((item) => ({
      ...item,
      id: uid(),
      mediaId: null,
      sourceUrl: undefined,
      line: item.line?.trim() || undefined,
    })),
    templateId: template.id,
    headline: template.headline,
    headlineColor: template.headlineColor,
    accentWords: template.accentWords,
    titleStroke: template.titleStroke,
    showRank: template.showRank,
    showCaptions: template.showCaptions,
    titleFont: template.titleFont,
    lineColor: template.lineColor,
    lineSize: template.lineSize,
    pictureWarmth: template.pictureWarmth,
  };
  if (template.id !== "builtin-ranking") return flick;
  return { ...flick, regions: frameForClips(flick.regions, flick.clips) };
}

export function templateFromFlick(flick: Flick, name: string, id = uid()): Template {
  const order = new Map(flick.tracks.map((trackItem, index) => [trackItem.id, index]));
  const clips = [...flick.clips].sort((a, b) => {
    const trackDelta = (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0);
    return trackDelta || a.startSec - b.startSec;
  });
  return {
    id,
    name,
    builtin: false,
    fps: flick.fps,
    width: flick.width,
    height: flick.height,
    regions: flick.regions.map((item) => ({ ...item })),
    tracks: flick.tracks.map((item) => ({ ...item })),
    clips: clips.map((item) => ({
      id: uid(),
      mediaId: null,
      trackId: item.trackId,
      startSec: item.startSec,
      inSec: 0,
      outSec: round3(clipDuration(item)),
      label: item.label,
      line: item.line?.trim() || undefined,
    })),
    headline: flick.headline?.trim() || undefined,
    headlineColor: flick.headlineColor?.trim() || undefined,
    accentWords: flick.accentWords?.trim() || undefined,
    titleStroke: flick.titleStroke,
    showRank: flick.showRank,
    showCaptions: flick.showCaptions,
    titleFont: storedTitleFont(flick.titleFont),
    lineColor: storedLineColor(flick.lineColor),
    lineSize: storedLineSize(flick.lineSize),
    pictureWarmth: storedWarmth(flick.pictureWarmth),
  };
}

export function packTrack(clips: Clip[], trackId: string): Clip[] {
  const mine = clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
  let cursor = 0;
  const packed = mine.map((clip) => {
    const next = { ...clip, startSec: round3(cursor) };
    cursor += clipDuration(clip);
    return next;
  });
  return [...clips.filter((clip) => clip.trackId !== trackId), ...packed];
}

export function splitClip(clips: Clip[], clipId: string, playheadSec: number): Clip[] {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return clips;
  const local = playheadSec - clip.startSec;
  const duration = clipDuration(clip);
  if (local <= 0.05 || local >= duration - 0.05) return clips;
  const splitAt = round3(clip.inSec + local);
  const left: Clip = { ...clip, outSec: splitAt };
  const right: Clip = {
    ...clip,
    id: uid(),
    startSec: round3(playheadSec),
    inSec: splitAt,
  };
  const next = clips.flatMap((item) => (item.id === clipId ? [left, right] : [item]));
  return packTrack(next, clip.trackId);
}

export function deleteClip(clips: Clip[], clipId: string): Clip[] {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return clips;
  return packTrack(
    clips.filter((item) => item.id !== clipId),
    clip.trackId,
  );
}

export function moveClip(clips: Clip[], clipId: string, direction: -1 | 1): Clip[] {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return clips;
  const mine = clips
    .filter((item) => item.trackId === clip.trackId)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
    .map((item) => ({ ...item }));
  const index = mine.findIndex((item) => item.id === clipId);
  const swap = index + direction;
  if (index < 0 || swap < 0 || swap >= mine.length) return clips;
  const reordered = [...mine];
  const [picked] = reordered.splice(index, 1);
  reordered.splice(swap, 0, picked);
  reordered.forEach((item, order) => {
    item.startSec = order;
  });
  return packTrack(
    [...clips.filter((item) => item.trackId !== clip.trackId), ...reordered],
    clip.trackId,
  );
}

/** Keep a ranking in/out inside the file. A short tail stays at least a tenth, and grows toward 0.4s only while the file has room. */
export function rankingClipRange(inSec: number, outSec: number, duration: number): { inSec: number; outSec: number } {
  const limit = duration > 0 ? duration : null;
  const endCap = limit === null ? Math.max(outSec, inSec + 0.1) : Math.min(Math.max(outSec, 0), limit);
  let start = Math.min(Math.max(0, inSec), Math.max(0, endCap - 0.1));
  let end = Math.max(endCap, start + 0.1);
  if (limit !== null) end = Math.min(end, limit);
  if (end - start < 0.4) {
    const want = limit === null ? 0.4 : Math.min(0.4, Math.max(0.1, limit));
    end = limit === null ? start + want : Math.min(limit, start + want);
    start = Math.max(0, end - want);
  }
  if (end < start + 0.1) start = Math.max(0, end - 0.1);
  return { inSec: round3(start), outSec: round3(Math.max(start + 0.1, end)) };
}

export function trimClip(clips: Clip[], clipId: string, edge: "in" | "out", sourceSec: number, mediaSec?: number): Clip[] {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return clips;
  const limit = mediaSec && mediaSec > 0 ? mediaSec : null;
  const next = clips.map((item) => {
    if (item.id !== clipId) return item;
    if (edge === "in") {
      const ceiling = (limit === null ? item.outSec : Math.min(item.outSec, limit)) - 0.1;
      const inSec = round3(Math.min(Math.max(0, sourceSec), Math.max(0, ceiling)));
      return { ...item, inSec };
    }
    const outSec = round3(Math.min(limit ?? Number.POSITIVE_INFINITY, Math.max(sourceSec, item.inSec + 0.1)));
    return { ...item, outSec };
  });
  return packTrack(next, clip.trackId);
}

export function fitClipsToMedia(clips: Clip[], limits: ReadonlyMap<string, number>): Clip[] {
  let changed = false;
  const fitted = clips.map((clip) => {
    const limit = clip.mediaId ? limits.get(clip.mediaId) : undefined;
    if (!limit || limit <= 0) return clip;
    const outSec = round3(Math.min(clip.outSec, limit));
    const inSec = round3(Math.min(Math.max(0, clip.inSec), Math.max(0, outSec - 0.1)));
    if (inSec === clip.inSec && outSec === clip.outSec) return clip;
    changed = true;
    return { ...clip, inSec, outSec };
  });
  if (!changed) return clips;
  const tracks = [...new Set(fitted.map((clip) => clip.trackId))];
  return tracks.reduce((packed, trackId) => packTrack(packed, trackId), fitted);
}

export type PlaceOptions = {
  mode?: "place" | "append";
  replaceId?: string;
};

/** Append stays the default so older callers keep adding at the end of the track. Place fills or replaces. */
export function placeClip(clips: Clip[], trackId: string, clip: Clip, options?: PlaceOptions): Clip[] {
  if ((options?.mode ?? "append") === "place") {
    const target = placeTarget(clips, trackId, options?.replaceId);
    if (target) {
      const next = clips.map((item) => (item.id === target.id ? writeMedia(target, clip) : item));
      return packTrack(next, trackId);
    }
  }
  const end = timelineEnd(clips.filter((item) => item.trackId === trackId));
  return packTrack([...clips, { ...clip, trackId, startSec: end }], trackId);
}

function placeTarget(clips: Clip[], trackId: string, replaceId?: string): Clip | null {
  if (replaceId) {
    const chosen = clips.find((item) => item.id === replaceId && item.trackId === trackId);
    if (chosen) return chosen;
  }
  return (
    clips
      .filter((item) => item.trackId === trackId && !item.mediaId)
      .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))[0] ?? null
  );
}

function assetSeconds(incoming: Clip): number {
  const span = incoming.outSec - Math.max(0, Math.min(incoming.inSec, incoming.outSec));
  return Math.max(0.1, span);
}

function writeMedia(target: Clip, incoming: Clip): Clip {
  const assetSec = assetSeconds(incoming);
  const filled = Boolean(target.mediaId);
  const range = filled ? { inSec: 0, outSec: round3(assetSec) } : clampWindow(target.inSec, target.outSec, assetSec);
  const focus = filled
    ? typeof incoming.focus === "number" && Number.isFinite(incoming.focus)
      ? incoming.focus
      : 0.5
    : target.focus;
  return {
    ...target,
    mediaId: incoming.mediaId,
    label: target.label.trim() ? target.label : incoming.label,
    sourceUrl: incoming.sourceUrl,
    inSec: range.inSec,
    outSec: range.outSec,
    startSec: target.startSec,
    line: target.line,
    focus,
  };
}

/** A shelf remove runs only after the flick save succeeds. */
export function shelfRemovePlan(save: { ok: boolean; message?: string }): { remove: boolean; message: string } {
  if (save.ok) return { remove: true, message: "" };
  return { remove: false, message: save.message?.trim() || "Could not save the flick." };
}

/** Keep a selected region only when it is still on screen and has a picture. */
export function visibleSelection(regions: Region[], clips: Clip[], preferredId: string | null): string | null {
  const shown = (region: Region) =>
    !region.hidden && region.height > 0.01 && clips.some((clip) => clip.trackId === region.trackId && Boolean(clip.mediaId));
  const preferred = preferredId ? regions.find((region) => region.id === preferredId) : undefined;
  if (preferred && shown(preferred)) return preferred.id;
  return regions.find(shown)?.id ?? null;
}

function clampWindow(inSec: number, outSec: number, assetSec: number): { inSec: number; outSec: number } {
  const limit = Math.max(assetSec, 0.1);
  const endCap = Math.min(Math.max(outSec, 0.1), limit);
  let start = Math.min(Math.max(0, inSec), Math.max(0, endCap - 0.1));
  let end = Math.min(limit, Math.max(endCap, start + 0.1));
  if (end < start + 0.1) start = Math.max(0, end - 0.1);
  return { inSec: round3(start), outSec: round3(Math.max(start + 0.1, end)) };
}

/** The path the save dialog should open on. Keeps the channel's own slash, so Windows does not treat the folder as part of the file name. */
export function exportSavePath(dir: string, name: string): string {
  const slash = dir.includes("\\") ? "\\" : "/";
  const root = dir.replace(/[\\/]+$/, "");
  const safe = name.replace(/[<>:"|?*]/g, "").trim() || "Cut";
  return `${root}${slash}exports${slash}${safe}.mp4`;
}

export function visibleRegions(regions: Region[]): Region[] {
  return regions.filter((region) => !region.hidden && region.height > 0.01).sort((a, b) => a.y - b.y);
}

/** Hide a region until its track has a picture, then stack the regions that remain so they fill the frame. */
export function frameForClips(regions: Region[], clips: Clip[]): Region[] {
  const occupied = new Set(clips.filter((clip) => clip.mediaId).map((clip) => clip.trackId));
  const order = new Map(regions.map((region, index) => [region.id, index]));
  const shown = regions
    .filter((region) => occupied.has(region.trackId))
    .sort((a, b) => a.y - b.y || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (shown.length === 0) {
    const next = regions.map((region) => (region.hidden ? region : { ...region, hidden: true }));
    return sameRegions(regions, next) ? regions : next;
  }
  if (shown.length === 1) {
    const only = shown[0];
    const next = regions.map((region) =>
      region.id === only.id
        ? { ...region, x: 0, y: 0, width: 1, height: 1, hidden: false }
        : region.hidden
          ? region
          : { ...region, hidden: true },
    );
    return sameRegions(regions, next) ? regions : next;
  }
  const weights = designWeights(shown);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let y = 0;
  const placed = new Map<string, Region>();
  shown.forEach((region, index) => {
    const height = index === shown.length - 1 ? round3(1 - y) : round3(weights[index] / total);
    placed.set(region.id, { ...region, x: 0, y: round3(y), width: 1, height, hidden: false });
    y = round3(y + height);
  });
  const next = regions.map((region) => placed.get(region.id) ?? (region.hidden ? region : { ...region, hidden: true }));
  return sameRegions(regions, next) ? regions : next;
}

function designWeights(shown: Region[]): number[] {
  return shown.map((region) => {
    const others = shown.filter((item) => item.id !== region.id);
    const othersSum = others.reduce((sum, item) => sum + item.height, 0);
    const collapsed =
      region.height >= 0.99 && others.every((item) => item.height < 0.99) && othersSum > 0.05 && othersSum < 0.99;
    if (collapsed) return Math.max(0.12, round3(1 - othersSum));
    return Math.max(region.height, 0.01);
  });
}

function sameRegions(prev: Region[], next: Region[]): boolean {
  return next.length === prev.length && next.every((region, index) => {
    const before = prev[index];
    return (
      before.id === region.id &&
      before.trackId === region.trackId &&
      before.x === region.x &&
      before.y === region.y &&
      before.width === region.width &&
      before.height === region.height &&
      before.hidden === region.hidden
    );
  });
}

export function fullFrame(regions: Region[], regionId: string): Region[] {
  return regions.map((region) =>
    region.id === regionId
      ? { ...region, x: 0, y: 0, width: 1, height: 1, hidden: false }
      : { ...region, hidden: true },
  );
}

export function dualTopHeight(arrangement: DualArrangement, preset: DualPreset): number {
  if (preset === "half") return 0.5;
  const faceShare = preset === "face-larger" ? 0.6 : 0.4;
  return arrangement === "face-top" ? faceShare : round3(1 - faceShare);
}

export function applyDualShare(regions: Region[], arrangement: DualArrangement, topHeight: number): Region[] {
  const face = regions.find((item) => item.trackId === DUAL_FACE);
  const game = regions.find((item) => item.trackId === DUAL_GAME);
  if (!face || !game) return regions;
  const height = round3(Math.min(0.88, Math.max(0.12, topHeight)));
  const topId = arrangement === "face-top" ? face.id : game.id;
  const bottomId = arrangement === "face-top" ? game.id : face.id;
  return regions.map((item) => {
    if (item.id === topId) return { ...item, x: 0, y: 0, width: 1, height, hidden: false };
    if (item.id === bottomId) {
      return { ...item, x: 0, y: height, width: 1, height: round3(1 - height), hidden: false };
    }
    return item;
  });
}

export function applyDualLayout(regions: Region[], arrangement: DualArrangement, preset: DualPreset): Region[] {
  return applyDualShare(regions, arrangement, dualTopHeight(arrangement, preset));
}

export function splitEvenly(regions: Region[]): Region[] {
  const shown = regions.map((region) => ({ ...region, hidden: false }));
  const count = shown.length || 1;
  return shown.map((region, index) => ({
    ...region,
    x: 0,
    width: 1,
    y: round3(index / count),
    height: round3(1 / count),
  }));
}

export function dragSeam(regions: Region[], upperId: string, nextHeight: number): Region[] {
  const visible = visibleRegions(regions);
  const index = visible.findIndex((region) => region.id === upperId);
  if (index < 0 || index >= visible.length - 1) return regions;
  const upper = visible[index];
  const lower = visible[index + 1];
  const pair = upper.height + lower.height;
  const height = Math.min(Math.max(nextHeight, 0.12), pair - 0.12);
  const updates = new Map<string, Region>([
    [upper.id, { ...upper, height: round3(height) }],
    [lower.id, { ...lower, y: round3(upper.y + height), height: round3(pair - height) }],
  ]);
  return regions.map((region) => updates.get(region.id) ?? region);
}

export function clipAt(clips: Clip[], trackId: string, playheadSec: number): Clip | null {
  return (
    clips.find(
      (clip) =>
        clip.trackId === trackId &&
        playheadSec >= clip.startSec &&
        playheadSec < clip.startSec + clipDuration(clip),
    ) ?? null
  );
}

function region(id: string, trackId: string, y: number, height: number): Region {
  return { id, trackId, x: 0, y, width: 1, height, hidden: false };
}

function track(id: string, name: string, muted: boolean): Track {
  return { id, name, kind: "video", muted };
}

const MACHINE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMERA_STAMP = /^(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})?$/;

export function fileStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").trim();
  return stem || name.trim();
}

export function isMachineStem(value: string): boolean {
  const stem = fileStem(value);
  return !stem || MACHINE_UUID.test(stem) || CAMERA_STAMP.test(stem);
}

export function spokenLine(value: string | undefined, mediaName?: string): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!text || isMachineStem(text) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(text)) return "";
  if (!/\s/.test(text) && /[_-]/.test(text)) return "";
  if (mediaName && sameMediaName(text, mediaName)) return "";
  return text;
}

function sameMediaName(text: string, mediaName: string): boolean {
  const named = mediaName.trim();
  if (!named) return false;
  const lower = text.toLowerCase();
  if (lower === named.toLowerCase()) return true;
  const stem = fileStem(named);
  if (!stem || /\s/.test(stem)) return false;
  return lower === stem.toLowerCase();
}

export function shelfName(
  fileName: string,
  peers: { id: string; name: string }[] = [],
  selfId = "",
): { title: string; mark: string } {
  const stem = fileStem(fileName);
  if (stem && !isMachineStem(stem)) return { title: stem.replace(/_+/g, " "), mark: "" };
  const twins = peers.filter((peer) => fileStem(peer.name).toLowerCase() === stem.toLowerCase());
  if (twins.length < 2 || !selfId) return { title: "Clip", mark: "" };
  const place = twins
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .findIndex((peer) => peer.id === selfId);
  return { title: "Clip", mark: place >= 0 ? String(place + 1) : "" };
}

function slot(id: string, trackId: string, startSec: number, duration: number, label: string): Clip {
  return {
    id,
    mediaId: null,
    trackId,
    startSec,
    inSec: 0,
    outSec: duration,
    label,
  };
}
