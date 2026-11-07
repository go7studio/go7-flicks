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

export type PlaybackMode = "countdown" | "listed" | "shuffle";

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
  if (mode === "shuffle") {
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const ordered = shuffleIds.map((id) => byId.get(id)).filter((slot): slot is T => Boolean(slot));
    const seen = new Set(ordered.map((slot) => slot.id));
    return [...ordered, ...slots.filter((slot) => !seen.has(slot.id))];
  }
  return [...slots];
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

export function flickFromTemplate(template: Template, name: string): Flick {
  return {
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
      line: undefined,
    })),
    templateId: template.id,
  };
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
    })),
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

export function trimClip(clips: Clip[], clipId: string, edge: "in" | "out", sourceSec: number): Clip[] {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return clips;
  const next = clips.map((item) => {
    if (item.id !== clipId) return item;
    if (edge === "in") {
      const inSec = round3(Math.min(Math.max(0, sourceSec), item.outSec - 0.1));
      return { ...item, inSec };
    }
    const outSec = round3(Math.max(sourceSec, item.inSec + 0.1));
    return { ...item, outSec };
  });
  return packTrack(next, clip.trackId);
}

export function placeClip(clips: Clip[], trackId: string, clip: Clip): Clip[] {
  const end = timelineEnd(clips.filter((item) => item.trackId === trackId));
  return packTrack([...clips, { ...clip, trackId, startSec: end }], trackId);
}

export function visibleRegions(regions: Region[]): Region[] {
  return regions.filter((region) => !region.hidden && region.height > 0.01).sort((a, b) => a.y - b.y);
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

export function applyDualLayout(regions: Region[], arrangement: DualArrangement, preset: DualPreset): Region[] {
  const face = regions.find((item) => item.trackId === DUAL_FACE);
  const game = regions.find((item) => item.trackId === DUAL_GAME);
  if (!face || !game) return regions;
  const topHeight = dualTopHeight(arrangement, preset);
  const topId = arrangement === "face-top" ? face.id : game.id;
  const bottomId = arrangement === "face-top" ? game.id : face.id;
  return regions.map((item) => {
    if (item.id === topId) return { ...item, x: 0, y: 0, width: 1, height: topHeight, hidden: false };
    if (item.id === bottomId) {
      return { ...item, x: 0, y: topHeight, width: 1, height: round3(1 - topHeight), hidden: false };
    }
    return item;
  });
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
