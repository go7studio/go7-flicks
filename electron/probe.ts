import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { GpuProbe } from "../src/shared/model";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);

type Candidate = { path: string; source: GpuProbe["ffmpegSource"] };

export type MediaInfo = {
  durationSec: number;
  width: number;
  height: number;
  codec: string;
};

export async function probeGpu(): Promise<GpuProbe> {
  const candidates = ffmpegCandidates();
  let best: GpuProbe | null = null;
  for (const candidate of candidates) {
    const encoders = await listEncoders(candidate.path);
    const probe: GpuProbe = {
      ffmpegPath: candidate.path,
      ffmpegSource: candidate.source,
      encoders,
      ...chooseEncoder(encoders),
    };
    if (!best || rank(probe) > rank(best)) best = probe;
  }
  return (
    best ?? {
      ffmpegPath: null,
      ffmpegSource: "none",
      encoders: { videotoolbox: false, nvenc: false, qsv: false, amf: false, libx264: false },
      chosen: "ffmpeg missing",
      chosenEncoder: null,
    }
  );
}

export async function probeMedia(file: string, ffmpegPath: string): Promise<MediaInfo> {
  let text = "";
  try {
    const result = await exec(ffmpegPath, ["-hide_banner", "-i", file], { timeout: 20000, encoding: "utf8" });
    text = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: string };
    if (failed.code === "ENOENT") throw new Error("ffmpeg is not available.");
    text = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
  }
  const duration = text.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = text.match(/Video:\s+(\w+)(?:\s*\([^)]*\))?.*?(\d{2,5})x(\d{2,5})/);
  if (!duration) throw new Error("Could not read that file.");
  const durationSec =
    Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  return {
    durationSec: Math.round(durationSec * 1000) / 1000,
    codec: video?.[1] ?? "",
    width: video ? Number(video[2]) : 0,
    height: video ? Number(video[3]) : 0,
  };
}

export function ffmpegCandidates(): Candidate[] {
  const found: Candidate[] = [];
  const fromEnv = process.env.GO7FLICKS_FFMPEG;
  if (fromEnv && existsSync(fromEnv)) found.push({ path: fromEnv, source: "env" });
  for (const file of lookup("ffmpeg")) {
    if (!found.some((item) => item.path === file)) found.push({ path: file, source: "path" });
  }
  try {
    const bundled = require("ffmpeg-static") as string | null;
    const unpacked = bundled?.includes("app.asar") ? bundled.replace("app.asar", "app.asar.unpacked") : bundled;
    const usable = unpacked && existsSync(unpacked) ? unpacked : bundled;
    if (usable && existsSync(usable) && !found.some((item) => item.path === usable)) {
      found.push({ path: usable, source: "bundled" });
    }
  } catch {
    // The static build is optional when a system ffmpeg is present.
  }
  return found;
}

async function listEncoders(ffmpegPath: string): Promise<GpuProbe["encoders"]> {
  try {
    const result = await exec(ffmpegPath, ["-hide_banner", "-encoders"], { timeout: 15000, encoding: "utf8" });
    const text = `${result.stdout}\n${result.stderr}`;
    const has = (name: string) => new RegExp(`\\b${name}\\b`).test(text);
    return {
      videotoolbox: has("h264_videotoolbox"),
      nvenc: has("h264_nvenc"),
      qsv: has("h264_qsv"),
      amf: has("h264_amf"),
      libx264: has("libx264"),
    };
  } catch {
    return { videotoolbox: false, nvenc: false, qsv: false, amf: false, libx264: false };
  }
}

function chooseEncoder(encoders: GpuProbe["encoders"]): Pick<GpuProbe, "chosen" | "chosenEncoder"> {
  const order =
    process.platform === "darwin"
      ? [
          ["videotoolbox", "h264_videotoolbox"],
          ["libx264", "libx264"],
        ]
      : [
          ["nvenc", "h264_nvenc"],
          ["qsv", "h264_qsv"],
          ["amf", "h264_amf"],
          ["libx264", "libx264"],
        ];
  for (const [key, encoder] of order) {
    if (encoders[key as keyof GpuProbe["encoders"]]) {
      return {
        chosen: encoder === "libx264" ? "software (libx264)" : encoder,
        chosenEncoder: encoder,
      };
    }
  }
  return { chosen: "ffmpeg missing", chosenEncoder: null };
}

function rank(probe: GpuProbe): number {
  let score = 0;
  if (process.platform === "darwin" && probe.encoders.videotoolbox) score += 40;
  if (probe.encoders.nvenc) score += 30;
  if (probe.encoders.qsv) score += 20;
  if (probe.encoders.amf) score += 20;
  if (probe.encoders.libx264) score += 10;
  if (probe.ffmpegSource === "path") score += 3;
  if (probe.ffmpegSource === "env") score += 2;
  if (probe.ffmpegSource === "bundled") score += 1;
  return score;
}

function lookup(command: string): string[] {
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const tool = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(tool, [command], { encoding: "utf8" });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && existsSync(line));
  } catch {
    return [];
  }
}
