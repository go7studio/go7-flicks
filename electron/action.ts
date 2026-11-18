import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { actionWindow, impactMoments, type Level } from "../src/shared/action";
import { round3 } from "../src/shared/model";

const exec = promisify(execFile);

export type ActionCut = {
  inSec: number;
  outSec: number;
  momentSec: number;
  focus: number;
  what: string;
  model: string;
};

/** Keep a still inside the file. A seek on the last frame of an AV1 clip comes back empty. */
export function frameSeek(sec: number, durationSec: number): number {
  const limit = Math.max(0, durationSec - 0.25);
  return Math.min(Math.max(0, sec), limit);
}

/** One sentence for a log or a screen. ffmpeg banners and raw JSON stay out of it. */
export function failureLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/connection refused|actively refused|ECONNREFUSED/i.test(text)) return "The call could not connect.";
  const embedded = text.match(/"(?:error|message)"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  if (embedded) return embedded[1].replace(/\\n/g, " ").replace(/\\"/g, '"').slice(0, 180);
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim().replace(/\s*\{$/, ""))
    .find((item) => item && !item.startsWith("{") && !item.startsWith("}") && !item.startsWith('"') && !/^(ffmpeg version|built with|configuration:|libav|Input #|Stream |Metadata:|Press |frame=|Duration:|Stream mapping|Conversion failed)/i.test(item));
  return (line || "That step stopped.").slice(0, 180);
}

/**
 * A detected impact cuts on that moment. No impact keeps the file:
 * from 0 through at most four seconds. Focus stays at 0.5.
 */
export function cutFromImpacts(impacts: number[], durationSec: number): ActionCut {
  if (!impacts.length) {
    const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
    return {
      inSec: 0,
      outSec: round3(Math.min(4, duration)),
      momentSec: 0,
      focus: 0.5,
      what: "The opening of the clip.",
      model: "impact",
    };
  }
  const moment = impacts.find((sec) => sec >= 1) ?? impacts[impacts.length - 1];
  const range = actionWindow(moment, durationSec);
  return {
    ...range,
    momentSec: moment,
    focus: 0.5,
    what: "The loudest moment in the clip.",
    model: "impact",
  };
}

/** Cut on the loudest later moment in the file. This stays on this computer. */
export async function trimToAction(file: string, ffmpegPath: string, durationSec: number): Promise<ActionCut> {
  const impacts = await findImpacts(file, ffmpegPath, durationSec);
  return cutFromImpacts(impacts, durationSec);
}

async function findImpacts(file: string, ffmpegPath: string, durationSec: number): Promise<number[]> {
  const [levels, scenes] = await Promise.all([
    readLevels(file, ffmpegPath),
    readScenes(file, ffmpegPath),
  ]);
  return impactMoments(levels, scenes, durationSec);
}

async function readLevels(file: string, ffmpegPath: string): Promise<Level[]> {
  const text = await ffmpegText(ffmpegPath, [
    "-hide_banner",
    "-i",
    file,
    "-vn",
    "-af",
    "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f",
    "null",
    "-",
  ]);
  const levels: Level[] = [];
  let sec = 0;
  for (const line of text.split(/\r?\n/)) {
    const time = line.match(/pts_time:([0-9.]+)/);
    if (time) sec = Number(time[1]);
    const level = line.match(/RMS_level=(-?[0-9.]+)/);
    if (level) levels.push({ sec, db: Number(level[1]) });
  }
  return levels;
}

async function readScenes(file: string, ffmpegPath: string): Promise<number[]> {
  const text = await ffmpegText(ffmpegPath, [
    "-hide_banner",
    "-i",
    file,
    "-vf",
    "select='gt(scene,0.3)',showinfo",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const scenes: number[] = [];
  for (const match of text.matchAll(/pts_time:([0-9.]+)/g)) scenes.push(Number(match[1]));
  return scenes;
}

async function ffmpegText(ffmpegPath: string, args: string[]): Promise<string> {
  try {
    const result = await exec(ffmpegPath, args, { timeout: 60000, windowsHide: true, maxBuffer: 12_000_000 });
    return `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: string };
    if (failed.code === "ENOENT") throw new Error("ffmpeg is not available.");
    return `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
  }
}
