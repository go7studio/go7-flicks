import { round3 } from "./model";

export type Level = { sec: number; db: number };

/**
 * Loud peaks and scene changes, at least a second apart, after the opening frame.
 * Find clips cuts on these moments on this computer.
 */
export function impactMoments(levels: Level[], scenes: number[], durationSec: number): number[] {
  const buckets = new Map<number, number>();
  for (const level of levels) {
    if (!Number.isFinite(level.sec) || !Number.isFinite(level.db) || level.db < -70) continue;
    if (level.sec < 0 || level.sec > durationSec) continue;
    const key = Math.round(level.sec * 2) / 2;
    const prev = buckets.get(key);
    if (prev === undefined || level.db > prev) buckets.set(key, level.db);
  }
  const points = [...buckets.entries()].map(([sec, db]) => ({ sec, db })).sort((a, b) => a.sec - b.sec);
  const dbs = points.map((point) => point.db).sort((a, b) => a - b);
  const median = dbs[Math.floor(dbs.length / 2)] ?? -50;
  function loudnessAt(sec: number): number {
    let best = -120;
    for (const point of points) {
      if (Math.abs(point.sec - sec) <= 0.6) best = Math.max(best, point.db);
    }
    return best;
  }
  const peaks = points.filter((point, index) => {
    if (point.sec < 0.8 || point.db < median + 3) return false;
    const prev = points[index - 1];
    const next = points[index + 1];
    return (!prev || point.db >= prev.db) && (!next || point.db >= next.db);
  });
  const sceneHits = scenes.filter((sec) => sec >= 0.8 && sec <= durationSec && loudnessAt(sec) > -70);
  const ranked = [...peaks.map((point) => point.sec), ...sceneHits]
    .map((sec) => ({ sec, db: loudnessAt(sec) }))
    .sort((a, b) => b.db - a.db || a.sec - b.sec);
  const kept: number[] = [];
  for (const item of ranked) {
    if (kept.some((sec) => Math.abs(sec - item.sec) < 1.25)) continue;
    kept.push(Math.round(item.sec * 100) / 100);
    if (kept.length >= 7) break;
  }
  return kept.sort((a, b) => a - b);
}

/** A few seconds that begin on the moment. The first frame is the action, not the wind-up. */
export function actionWindow(momentSec: number, durationSec: number): { inSec: number; outSec: number } {
  const duration = Math.max(0.4, durationSec);
  const moment = Math.min(Math.max(0, momentSec), Math.max(0, duration - 0.1));
  const span = Math.min(4, Math.max(0.4, duration - moment));
  const start = moment;
  const end = Math.min(duration, start + span);
  return { inSec: round3(start), outSec: round3(Math.max(start + 0.1, end)) };
}

/** Where the person sits across the frame. 0 is the left edge, 1 is the right. */
export function pictureFocus(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return round3(Math.min(1, Math.max(0, number)));
}

/** The nearest allowed impact. */
export function snapMoment(momentSec: number, impacts: number[]): number | null {
  let best: number | null = null;
  let gap = 0.8;
  for (const impact of impacts) {
    const next = Math.abs(impact - momentSec);
    if (next <= gap) {
      gap = next;
      best = impact;
    }
  }
  return best;
}
