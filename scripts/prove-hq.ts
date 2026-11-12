import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exportCut, resolveAsset } from "../electron/cut";
import { startMediaServer, type MediaGate } from "../electron/media-server";
import { probeGpu, probeMedia } from "../electron/probe";
import { isNetworkPath, stageSource } from "../electron/stage";
import { renderFlick } from "../electron/styled";
import { applyDualLayout, builtinTemplates, flickFromTemplate } from "../src/shared/canvas";
import { uid, type Clip, type Flick, type MediaAsset } from "../src/shared/model";
import type { FlickProps } from "../src/remotion/FlickComposition";

const exec = promisify(execFile);
const camera = String.raw`K:\PhoneVideo062424\Phone11242025\DCIM\Camera`;
const root = String.raw`D:\go7-hq-export`;
const staging = path.join(root, "staging");
const framesDir = path.join(root, "frames");
const desktop = path.join(os.homedir(), "Desktop");
const resourcesPath = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Go7Flicks", "resources");
const BITRATE = "20M";
const RANK_BEAT = 7.5;
const SPLIT_BEAT = 8;

type Wanted = {
  key: string;
  file: string;
  line: string;
  label: string;
  at: number;
};

const wanted: Wanted[] = [
  { key: "field", file: path.join(camera, "20241013_174556.mp4"), line: "Sideline", label: "#4", at: 6 },
  { key: "bikes", file: path.join(camera, "20200908_090509.mp4"), line: "Spin class", label: "#3", at: 8 },
  { key: "shore", file: path.join(camera, "20190822_104201.mp4"), line: "Low tide", label: "#2", at: 5 },
  { key: "toys", file: path.join(camera, "20180531_104141.mp4"), line: "Playtime", label: "#1", at: 4 },
];

const gpu = await probeGpu();
if (!gpu.ffmpegPath || !gpu.chosenEncoder) throw new Error("ffmpeg is not available.");
console.log(`encoder ${gpu.chosen} via ${gpu.ffmpegSource}`);
if (gpu.chosenEncoder !== "h264_nvenc") console.log(`warning encoder is ${gpu.chosenEncoder}, expected h264_nvenc`);

const bundle = path.join(resourcesPath, "remotion-bundle", "index.html");
if (!fs.existsSync(bundle)) throw new Error(`Installed Remotion bundle is missing: ${bundle}`);

fs.mkdirSync(staging, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });

type Staged = Wanted & {
  asset: MediaAsset;
  sourceBytes: number;
  stageMs: number;
  stagedPath: string;
};

const staged: Staged[] = [];
for (const source of wanted) {
  if (!fs.existsSync(source.file)) throw new Error(`Missing ${source.key}: ${source.file}`);
  if (!isNetworkPath(source.file)) throw new Error(`${source.key} is not a network path: ${source.file}`);
  const sourceBytes = fs.statSync(source.file).size;
  const started = Date.now();
  const stagedPath = await stageSource(source.file, staging);
  const stageMs = Date.now() - started;
  if (isNetworkPath(stagedPath) || /^[kK]:/i.test(stagedPath)) {
    throw new Error(`Stage left ${source.key} on the network: ${stagedPath}`);
  }
  if (fs.statSync(stagedPath).size !== sourceBytes) throw new Error(`Stage size mismatch for ${source.key}`);
  const info = await probeMedia(stagedPath, gpu.ffmpegPath);
  if (info.width !== 1920 || info.height !== 1080) {
    throw new Error(`${source.key} is ${info.width}x${info.height}, expected 1920x1080`);
  }
  const asset: MediaAsset = {
    id: uid(),
    name: path.basename(source.file),
    absolutePath: stagedPath,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    codec: info.codec,
  };
  staged.push({ ...source, asset, sourceBytes, stageMs, stagedPath });
  console.log(
    `staged ${source.key} ${path.basename(source.file)} ${info.width}x${info.height} ${info.durationSec}s ${(sourceBytes / 1e6).toFixed(1)}MB ${stageMs}ms`,
  );
}

const byKey = new Map(staged.map((item) => [item.key, item]));

function take(key: string, seconds: number, at: number): { asset: MediaAsset; inSec: number; outSec: number } {
  const item = byKey.get(key);
  if (!item) throw new Error(`No asset for ${key}`);
  const length = Math.min(seconds, Math.max(0.5, item.asset.durationSec - 0.3));
  if (item.asset.durationSec < at + length) {
    throw new Error(`${key} is ${item.asset.durationSec}s, need ${at + length}s`);
  }
  const inSec = Math.round(at * 1000) / 1000;
  const outSec = Math.round((at + length) * 1000) / 1000;
  return { asset: item.asset, inSec, outSec };
}

function placed(trackId: string, startSec: number, shot: ReturnType<typeof take>, label: string, line?: string): Clip {
  return {
    id: uid(),
    mediaId: shot.asset.id,
    trackId,
    startSec: Math.round(startSec * 1000) / 1000,
    inSec: shot.inSec,
    outSec: shot.outSec,
    label,
    line,
  };
}

function span(shot: ReturnType<typeof take>): number {
  return Math.round((shot.outSec - shot.inSec) * 1000) / 1000;
}

const rankingTemplate = builtinTemplates().find((item) => item.id === "builtin-ranking");
const dualTemplate = builtinTemplates().find((item) => item.id === "builtin-dual");
if (!rankingTemplate || !dualTemplate) throw new Error("A builtin template is missing.");

const ranking = flickFromTemplate(rankingTemplate, "HQ ranking");
ranking.headline = "Ranking the best\ndays";
ranking.headlineColor = "#e2b340";
ranking.accentWords = "best";
ranking.titleStroke = 6;
ranking.showRank = true;
let rankCursor = 0;
ranking.clips = wanted.map((item) => {
  const shot = take(item.key, RANK_BEAT, item.at);
  const clip = placed("track-top", rankCursor, shot, item.label, item.line);
  rankCursor += span(shot);
  return clip;
});
ranking.clips.push(placed("track-bottom", 0, take("shore", rankCursor, 40), "Loop", "Low tide"));

const split = flickFromTemplate(dualTemplate, "HQ split");
split.regions = applyDualLayout(split.regions, "face-top", "face-larger");
split.headline = "The bigger\npicture";
split.headlineColor = "#e2b340";
split.accentWords = "bigger";
split.titleStroke = 6;
split.showRank = false;
const face = take("toys", SPLIT_BEAT, 20);
const game = take("field", SPLIT_BEAT, 20);
split.clips = [
  placed("track-face", 0, face, "Playtime", "Playtime"),
  placed("track-game", 0, game, "Sideline", "Sideline"),
];

const media = staged.map((item) => item.asset);
const gate: MediaGate = {
  channelDir: root,
  channel: { version: 1, name: "HQ", accent: "#e2b340", media, flicks: [] },
  stagingDir: staging,
};
const mediaBase = await startMediaServer(gate);

function propsFor(flick: Flick): FlickProps {
  return {
    fps: flick.fps,
    width: flick.width,
    height: flick.height,
    accent: "#e2b340",
    headline: flick.headline,
    headlineColor: flick.headlineColor,
    accentWords: flick.accentWords,
    titleStroke: flick.titleStroke,
    showRank: flick.showRank,
    regions: flick.regions,
    tracks: flick.tracks,
    preview: false,
    clips: flick.clips.map((clip) => {
      const asset = media.find((item) => item.id === clip.mediaId);
      const absolute = resolveAsset(root, asset);
      if (!absolute || !fs.existsSync(absolute)) throw new Error(`Missing staged media for ${clip.label}`);
      if (isNetworkPath(absolute)) throw new Error(`Styled source is still on the network: ${absolute}`);
      return {
        id: clip.id,
        trackId: clip.trackId,
        startSec: clip.startSec,
        inSec: clip.inSec,
        outSec: clip.outSec,
        label: clip.label,
        line: clip.line,
        src: `${mediaBase}/file?path=${encodeURIComponent(absolute)}`,
      };
    }),
  };
}

async function measure(file: string): Promise<{
  width: string;
  height: string;
  seconds: number;
  bytes: number;
  bitrate: string;
}> {
  const result = await exec(gpu.ffmpegPath as string, ["-hide_banner", "-i", file], { timeout: 20000 }).catch(
    (error: { stderr?: string; stdout?: string }) => ({ stderr: error.stderr ?? "", stdout: error.stdout ?? "" }),
  );
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const duration = text.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = text.match(/Video:\s+\w+(?:\s*\([^)]*\))?.*?(\d{2,5})x(\d{2,5})/);
  const bitrate = text.match(/bitrate:\s+(\d+)\s+kb\/s/);
  if (!duration || !video) throw new Error(`Could not read ${file}\n${text.slice(0, 500)}`);
  const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  return {
    width: video[1],
    height: video[2],
    seconds: Math.round(seconds * 100) / 100,
    bytes: fs.statSync(file).size,
    bitrate: bitrate ? `${bitrate[1]} kb/s` : "unknown",
  };
}

async function grab(file: string, at: number, name: string): Promise<string> {
  const frame = path.join(framesDir, name);
  await exec(
    gpu.ffmpegPath as string,
    ["-y", "-ss", String(at), "-i", file, "-frames:v", "1", "-q:v", "3", frame],
    { timeout: 30000 },
  );
  return frame;
}

const jobs: { flick: Flick; slug: string; desktopName: string; frames: number[] }[] = [
  { flick: ranking, slug: "ranking", desktopName: "HQ-ranking.mp4", frames: [1.5, 9, 16.5, 24] },
  { flick: split, slug: "split", desktopName: "HQ-split.mp4", frames: [2, 5] },
];

const report: unknown[] = [];
for (const job of jobs) {
  if (job.flick.width !== 1080 || job.flick.height !== 1920) {
    throw new Error(`${job.slug} frame is ${job.flick.width}x${job.flick.height}`);
  }
  const cutPath = path.join(root, `${job.slug}-cut.mp4`);
  const styledPath = path.join(root, `${job.slug}-styled.mp4`);
  const cutStarted = Date.now();
  await exportCut({
    ffmpeg: gpu.ffmpegPath,
    encoder: gpu.chosenEncoder,
    channelDir: root,
    flick: job.flick,
    media,
    outputPath: cutPath,
    videoBitrate: BITRATE,
  });
  const cutMs = Date.now() - cutStarted;
  const cutInfo = await measure(cutPath);
  console.log(`cut ${job.slug} ${cutMs}ms ${cutInfo.seconds}s ${cutInfo.width}x${cutInfo.height} ${cutInfo.bytes} ${cutInfo.bitrate}`);
  const styledStarted = Date.now();
  await renderFlick({
    entry: path.resolve("src/remotion/index.ts"),
    resourcesPath,
    outputPath: styledPath,
    props: propsFor(job.flick),
    logLevel: "info",
    videoBitrate: BITRATE,
  });
  const styledMs = Date.now() - styledStarted;
  const styledInfo = await measure(styledPath);
  console.log(
    `styled ${job.slug} ${styledMs}ms ${styledInfo.seconds}s ${styledInfo.width}x${styledInfo.height} ${styledInfo.bytes} ${styledInfo.bitrate}`,
  );
  if (cutInfo.width !== "1080" || cutInfo.height !== "1920") {
    throw new Error(`${job.slug} cut is ${cutInfo.width}x${cutInfo.height}`);
  }
  if (styledInfo.width !== "1080" || styledInfo.height !== "1920" || styledInfo.bytes < 100_000) {
    throw new Error(`${job.slug} styled export is not a 1080x1920 video.`);
  }
  const frames: string[] = [];
  for (const at of job.frames) {
    if (at >= styledInfo.seconds - 0.15) continue;
    frames.push(await grab(styledPath, at, `${job.slug}-${at.toFixed(1)}.jpg`));
  }
  const desktopPath = path.join(desktop, job.desktopName);
  fs.copyFileSync(styledPath, desktopPath);
  const row = {
    slug: job.slug,
    headline: job.flick.headline,
    accentWords: job.flick.accentWords,
    lines: job.flick.clips.filter((clip) => clip.line).map((clip) => ({ label: clip.label, line: clip.line, trackId: clip.trackId })),
    cutMs,
    styledMs,
    cut: { path: cutPath, ...cutInfo },
    styled: { path: styledPath, desktop: desktopPath, ...styledInfo },
    frames,
  };
  report.push(row);
  console.log(JSON.stringify(row));
}

const summary = {
  bitrate: BITRATE,
  productDefaultUnchanged: "8M when videoBitrate is omitted",
  crf: null,
  hardwareAcceleration: "if-possible",
  encoder: gpu.chosenEncoder,
  sources: staged.map((item) => ({
    key: item.key,
    file: item.file,
    bytes: item.sourceBytes,
    stageMs: item.stageMs,
    stagedPath: item.stagedPath,
    durationSec: item.asset.durationSec,
    width: item.asset.width,
    height: item.asset.height,
  })),
  report,
};
const reportPath = path.join(root, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
console.log(`report ${reportPath}`);
console.log("hq ok");
process.exit(0);
