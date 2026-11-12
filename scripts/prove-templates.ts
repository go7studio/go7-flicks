import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exportCut, resolveAsset } from "../electron/cut";
import { startMediaServer, type MediaGate } from "../electron/media-server";
import { probeGpu, probeMedia } from "../electron/probe";
import { renderFlick } from "../electron/styled";
import { applyDualLayout, builtinTemplates, flickFromTemplate } from "../src/shared/canvas";
import { uid, type ChannelFile, type Clip, type Flick, type MediaAsset } from "../src/shared/model";
import type { FlickProps } from "../src/remotion/FlickComposition";

const exec = promisify(execFile);
const channelDir = "D:\\GitHub\\Emoji Loop 55941";
const desktop = path.join(os.homedir(), "Desktop");
const framesDir = path.join(os.tmpdir(), "go7-templates");
const camera = "K:\\PhoneVideo062424\\Phone11242025\\DCIM\\Camera";
const resourcesPath = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "Go7Flicks",
  "resources",
);

type Source = { key: string; file: string };

const wanted: Source[] = [
  { key: "selfie", file: path.join(channelDir, "media", "dabc614f-01a9-4bd4-a7ed-f7c6ed4eaeb9.mp4") },
  { key: "football", file: path.join(channelDir, "media", "3b8de6dc-b7dc-41e2-a8ac-896fdab1ac84.mp4") },
  { key: "flower", file: path.join(channelDir, "media", "0845e847-5702-4742-872d-4d273f2f9c13.mp4") },
  { key: "park", file: path.join(channelDir, "media", "4d292447-4724-4423-b9b3-b1ad2b49d72f.mp4") },
  { key: "day", file: path.join(camera, "20241020_111236.mp4") },
  { key: "night", file: path.join(camera, "20180609_200500.mp4") },
  { key: "street", file: path.join(camera, "20210326_082125.mp4") },
  { key: "yard", file: path.join(camera, "20190914_152351.mp4") },
];

const gpu = await probeGpu();
if (!gpu.ffmpegPath || !gpu.chosenEncoder) throw new Error("ffmpeg is not available.");
console.log(`encoder ${gpu.chosen} via ${gpu.ffmpegSource}`);

const channel = JSON.parse(fs.readFileSync(path.join(channelDir, "channel.json"), "utf8")) as ChannelFile;
const assets = new Map<string, MediaAsset>();

for (const source of wanted) {
  if (!fs.existsSync(source.file)) throw new Error(`Missing ${source.key}: ${source.file}`);
  const info = await probeMedia(source.file, gpu.ffmpegPath);
  const existing = channel.media.find((item) => {
    const resolved = resolveAsset(channelDir, item);
    return resolved ? path.resolve(resolved) === path.resolve(source.file) : false;
  });
  if (existing) {
    assets.set(source.key, existing);
    console.log(`have ${source.key} ${info.width}x${info.height} ${info.durationSec}s`);
    continue;
  }
  const asset: MediaAsset = {
    id: uid(),
    name: path.basename(source.file),
    absolutePath: path.resolve(source.file),
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    codec: info.codec,
  };
  channel.media.push(asset);
  assets.set(source.key, asset);
  console.log(`link ${source.key} ${info.width}x${info.height} ${info.durationSec}s`);
}

function take(key: string, seconds = 1.2): { asset: MediaAsset; inSec: number; outSec: number } {
  const asset = assets.get(key);
  if (!asset) throw new Error(`No asset for ${key}`);
  const length = Math.min(seconds, Math.max(0.5, asset.durationSec - 0.15));
  const inSec = asset.durationSec > length + 0.35 ? 0.2 : 0;
  const outSec = Math.round(Math.min(asset.durationSec, inSec + length) * 1000) / 1000;
  return { asset, inSec, outSec: Math.max(outSec, inSec + 0.4) };
}

function placed(
  trackId: string,
  startSec: number,
  shot: ReturnType<typeof take>,
  label: string,
  line?: string,
): Clip {
  return {
    id: uid(),
    mediaId: shot.asset.id,
    trackId,
    startSec: round3(startSec),
    inSec: shot.inSec,
    outSec: shot.outSec,
    label,
    line,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function span(shot: ReturnType<typeof take>): number {
  return round3(shot.outSec - shot.inSec);
}

const rankingTemplate = builtinTemplates().find((item) => item.id === "builtin-ranking");
const splitTemplate = builtinTemplates().find((item) => item.id === "builtin-split");
const dualTemplate = builtinTemplates().find((item) => item.id === "builtin-dual");
const blankTemplate = builtinTemplates().find((item) => item.id === "builtin-blank");
if (!rankingTemplate || !splitTemplate || !dualTemplate || !blankTemplate) throw new Error("A builtin template is missing.");

const rankShots = [
  { key: "selfie", label: "#5", line: "Selfie" },
  { key: "football", label: "#4", line: "Football" },
  { key: "flower", label: "#3", line: "Flower" },
  { key: "park", label: "#2", line: "Park" },
  { key: "day", label: "#1", line: "Daylight" },
];
const ranking = flickFromTemplate(rankingTemplate, "Ranking the funniest");
ranking.headline = "Ranking the funniest\ncartoon moments";
ranking.headlineColor = "#e2b340";
ranking.accentWords = "funniest";
ranking.titleStroke = 6;
ranking.showRank = true;
let rankCursor = 0;
ranking.clips = rankShots.map((item) => {
  const shot = take(item.key);
  const clip = placed("track-top", rankCursor, shot, item.label, item.line);
  rankCursor += span(shot);
  return clip;
});
ranking.clips.push(placed("track-bottom", 0, take("night", rankCursor), "Loop"));

const split = flickFromTemplate(splitTemplate, "Split screen");
const splitShots = [
  { key: "street", label: "Hook" },
  { key: "yard", label: "Beat" },
  { key: "football", label: "Payoff" },
];
let splitCursor = 0;
split.clips = splitShots.map((item) => {
  const shot = take(item.key, 1.15);
  const clip = placed("track-top", splitCursor, shot, item.label);
  splitCursor += span(shot);
  return clip;
});
split.clips.push(placed("track-bottom", 0, take("flower", splitCursor), "Loop"));

const dual = flickFromTemplate(dualTemplate, "Dual video");
dual.regions = applyDualLayout(dual.regions, "face-top", "face-larger");
const faceShot = take("selfie", 2.2);
const gameShot = take("park", 2.2);
const dualLength = Math.min(span(faceShot), span(gameShot));
dual.clips = [
  placed("track-face", 0, { ...faceShot, outSec: round3(faceShot.inSec + dualLength) }, "Face", "Face"),
  placed("track-game", 0, { ...gameShot, outSec: round3(gameShot.inSec + dualLength) }, "Gameplay", "Gameplay"),
];

const blank = flickFromTemplate(blankTemplate, "Splice styled");
const blankShots = ["night", "street", "flower", "yard"];
let blankCursor = 0;
blank.clips = blankShots.map((key) => {
  const shot = take(key, 1.25);
  const clip = placed("track-video", blankCursor, shot, "");
  blankCursor += span(shot);
  return clip;
});

const flicks = [ranking, split, dual, blank];
for (const flick of flicks) {
  const folder = path.join(channelDir, "flicks", flick.id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "flick.json"), JSON.stringify(flick, null, 2));
  channel.flicks = channel.flicks.filter((item) => item.id !== flick.id);
  channel.flicks.unshift({ id: flick.id, name: flick.name, updatedAt: new Date().toISOString() });
}
fs.writeFileSync(path.join(channelDir, "channel.json"), JSON.stringify(channel, null, 2));
console.log(`saved ${flicks.map((item) => item.name).join(", ")}`);

const gate: MediaGate = { channelDir, channel };
const mediaBase = await startMediaServer(gate);

function propsFor(flick: Flick): FlickProps {
  const clips = flick.clips.map((clip) => {
    const asset = channel.media.find((item) => item.id === clip.mediaId);
    const absolute = resolveAsset(channelDir, asset);
    const ready = Boolean(absolute && fs.existsSync(absolute));
    return {
      id: clip.id,
      trackId: clip.trackId,
      startSec: clip.startSec,
      inSec: clip.inSec,
      outSec: clip.outSec,
      label: clip.label,
      line: clip.line,
      src: ready ? `${mediaBase}/file?path=${encodeURIComponent(absolute as string)}` : undefined,
    };
  });
  return {
    fps: flick.fps,
    width: flick.width,
    height: flick.height,
    accent: channel.accent,
    headline: flick.headline,
    headlineColor: flick.headlineColor,
    accentWords: flick.accentWords,
    titleStroke: flick.titleStroke,
    showRank: flick.showRank,
    regions: flick.regions,
    tracks: flick.tracks,
    clips,
    preview: false,
  };
}

async function measure(file: string): Promise<{ width: string; height: string; seconds: number; bytes: number }> {
  const result = await exec(
    gpu.ffmpegPath as string,
    ["-hide_banner", "-i", file],
    { timeout: 20000 },
  ).catch((error: { stderr?: string; stdout?: string }) => ({ stderr: error.stderr ?? "", stdout: error.stdout ?? "" }));
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const duration = text.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = text.match(/Video:\s+\w+(?:\s*\([^)]*\))?.*?(\d{2,5})x(\d{2,5})/);
  if (!duration || !video) throw new Error(`Could not read ${file}`);
  const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  return { width: video[1], height: video[2], seconds: Math.round(seconds * 100) / 100, bytes: fs.statSync(file).size };
}

fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(path.join(channelDir, "exports"), { recursive: true });

const jobs: { flick: Flick; slug: string; frames: number[] }[] = [
  { flick: ranking, slug: "ranking", frames: [0.4, 1.6, 2.8, 4.0, 5.2] },
  { flick: split, slug: "split", frames: [0.35, 1.5, 2.7] },
  { flick: dual, slug: "dual", frames: [0.7] },
  { flick: blank, slug: "blank", frames: [0.4, 1.7, 3.0, 4.3] },
];

for (const job of jobs) {
  const cutPath = path.join(channelDir, "exports", `${job.slug}-cut.mp4`);
  const styledPath = path.join(channelDir, "exports", `${job.slug}-styled.mp4`);
  const started = Date.now();
  await exportCut({
    ffmpeg: gpu.ffmpegPath,
    encoder: gpu.chosenEncoder,
    channelDir,
    flick: job.flick,
    media: channel.media,
    outputPath: cutPath,
  });
  const cutInfo = await measure(cutPath);
  console.log(`cut ${job.slug}`, cutInfo, `${Date.now() - started}ms`);
  if (cutInfo.width !== "1080" || cutInfo.height !== "1920") {
    throw new Error(`${job.slug} cut is ${cutInfo.width}x${cutInfo.height}`);
  }
  const styledStarted = Date.now();
  await renderFlick({
    entry: path.resolve("src/remotion/index.ts"),
    resourcesPath,
    outputPath: styledPath,
    props: propsFor(job.flick),
    logLevel: "info",
  });
  const styledInfo = await measure(styledPath);
  console.log(`styled ${job.slug}`, styledInfo, `${Date.now() - styledStarted}ms`);
  if (styledInfo.width !== "1080" || styledInfo.height !== "1920" || styledInfo.bytes < 50_000) {
    throw new Error(`${job.slug} styled export is not a 1080x1920 video.`);
  }
  if (Math.abs(styledInfo.seconds - cutInfo.seconds) > 0.45) {
    throw new Error(`${job.slug} styled ${styledInfo.seconds}s does not match cut ${cutInfo.seconds}s`);
  }
  for (const at of job.frames) {
    const frame = path.join(framesDir, `${job.slug}-${at.toFixed(2)}.jpg`);
    await exec(
      gpu.ffmpegPath,
      ["-y", "-ss", String(at), "-i", styledPath, "-frames:v", "1", "-q:v", "3", frame],
      { timeout: 20000 },
    );
    console.log(`frame ${path.basename(frame)}`);
  }
  fs.copyFileSync(styledPath, path.join(desktop, `Template-${job.slug}.mp4`));
  fs.copyFileSync(cutPath, path.join(desktop, `Cut-${job.slug}.mp4`));
}

console.log("templates ok");
