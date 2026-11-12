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
const framesDir = path.join(os.tmpdir(), "go7-long");
const camera = "K:\\PhoneVideo062424\\Phone11242025\\DCIM\\Camera";
const resourcesPath = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Go7Flicks", "resources");
const SLICE = 8;

type Source = { key: string; file: string; at: number };

const wanted: Source[] = [
  { key: "a", file: path.join(camera, "20210412_002309.mp4"), at: 40 },
  { key: "b", file: path.join(camera, "20180125_191146.mp4"), at: 30 },
  { key: "c", file: path.join(camera, "20190107_085831.mp4"), at: 25 },
  { key: "d", file: path.join(camera, "20180203_153509.mp4"), at: 20 },
  { key: "e", file: path.join(camera, "20241024_135546.mp4"), at: 18 },
  { key: "f", file: path.join(camera, "20180609_194457.mp4"), at: 22 },
  { key: "g", file: path.join(camera, "20200125_110417.mp4"), at: 16 },
  { key: "h", file: path.join(camera, "20180805_111802.mp4"), at: 14 },
];

const gpu = await probeGpu();
if (!gpu.ffmpegPath || !gpu.chosenEncoder) throw new Error("ffmpeg is not available.");
console.log(`encoder ${gpu.chosen} via ${gpu.ffmpegSource} cpus ${os.cpus().length}`);

const channel = JSON.parse(fs.readFileSync(path.join(channelDir, "channel.json"), "utf8")) as ChannelFile;
const assets = new Map<string, MediaAsset>();
const sources = new Map<string, { bytes: number; durationSec: number; width: number; height: number }>();

for (const source of wanted) {
  if (!fs.existsSync(source.file)) throw new Error(`Missing ${source.key}: ${source.file}`);
  const info = await probeMedia(source.file, gpu.ffmpegPath);
  const bytes = fs.statSync(source.file).size;
  sources.set(source.key, { bytes, durationSec: info.durationSec, width: info.width, height: info.height });
  const existing = channel.media.find((item) => {
    const resolved = resolveAsset(channelDir, item);
    return resolved ? path.resolve(resolved) === path.resolve(source.file) : false;
  });
  const asset =
    existing ??
    ({
      id: uid(),
      name: path.basename(source.file),
      absolutePath: path.resolve(source.file),
      durationSec: info.durationSec,
      width: info.width,
      height: info.height,
      codec: info.codec,
    } satisfies MediaAsset);
  if (!existing) channel.media.push(asset);
  assets.set(source.key, asset);
  console.log(
    `source ${source.key} ${path.basename(source.file)} ${info.width}x${info.height} ${info.durationSec}s ${(bytes / 1e6).toFixed(0)}MB`,
  );
}

function take(key: string, seconds: number, at: number): { asset: MediaAsset; inSec: number; outSec: number } {
  const asset = assets.get(key);
  if (!asset) throw new Error(`No asset for ${key}`);
  const length = Math.min(seconds, Math.max(0.5, asset.durationSec - 0.3));
  const inSec = Math.max(0, Math.min(at, asset.durationSec - length - 0.05));
  const outSec = Math.round((inSec + length) * 1000) / 1000;
  return { asset, inSec: Math.round(inSec * 1000) / 1000, outSec };
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
const splitTemplate = builtinTemplates().find((item) => item.id === "builtin-split");
const dualTemplate = builtinTemplates().find((item) => item.id === "builtin-dual");
const blankTemplate = builtinTemplates().find((item) => item.id === "builtin-blank");
if (!rankingTemplate || !splitTemplate || !dualTemplate || !blankTemplate) throw new Error("A builtin template is missing.");

const rankOrder = [
  { key: "b", label: "#5", line: "One" },
  { key: "c", label: "#4", line: "Two" },
  { key: "d", label: "#3", line: "Three" },
  { key: "e", label: "#2", line: "Four" },
  { key: "f", label: "#1", line: "Five" },
];
const ranking = flickFromTemplate(rankingTemplate, "Ranking long");
ranking.headline = "Ranking the funniest\ncartoon moments";
ranking.headlineColor = "#e2b340";
ranking.accentWords = "funniest";
ranking.titleStroke = 6;
ranking.showRank = true;
let rankCursor = 0;
ranking.clips = rankOrder.map((item) => {
  const shot = take(item.key, SLICE, wanted.find((row) => row.key === item.key)?.at ?? 10);
  const clip = placed("track-top", rankCursor, shot, item.label, item.line);
  rankCursor += span(shot);
  return clip;
});
ranking.clips.push(placed("track-bottom", 0, take("a", rankCursor, 45), "Loop"));

const split = flickFromTemplate(splitTemplate, "Split long");
let splitCursor = 0;
for (const item of [
  { key: "g", label: "Hook" },
  { key: "h", label: "Beat" },
  { key: "b", label: "Payoff" },
]) {
  const shot = take(item.key, SLICE, wanted.find((row) => row.key === item.key)?.at ?? 10);
  split.clips = split.clips.filter((clip) => clip.trackId !== "track-top" || clip.mediaId);
  split.clips.push(placed("track-top", splitCursor, shot, item.label));
  splitCursor += span(shot);
}
split.clips = [
  ...split.clips.filter((clip) => clip.trackId === "track-top"),
  placed("track-bottom", 0, take("c", splitCursor, 40), "Loop"),
];

const dual = flickFromTemplate(dualTemplate, "Dual long");
dual.regions = applyDualLayout(dual.regions, "face-top", "face-larger");
const face = take("d", 12, 40);
const game = take("e", 12, 36);
const dualLength = Math.min(span(face), span(game));
dual.clips = [
  placed("track-face", 0, { ...face, outSec: Math.round((face.inSec + dualLength) * 1000) / 1000 }, "Face", "Face"),
  placed("track-game", 0, { ...game, outSec: Math.round((game.inSec + dualLength) * 1000) / 1000 }, "Gameplay", "Gameplay"),
];

const blank = flickFromTemplate(blankTemplate, "Splice long");
let blankCursor = 0;
blank.clips = ["f", "g", "h", "a"].map((key) => {
  const shot = take(key, SLICE, (wanted.find((row) => row.key === key)?.at ?? 10) + 20);
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

const gate: MediaGate = { channelDir, channel };
const mediaBase = await startMediaServer(gate);

function propsFor(flick: Flick): FlickProps {
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
    preview: false,
    clips: flick.clips.map((clip) => {
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
    }),
  };
}

async function measure(file: string): Promise<{ width: string; height: string; seconds: number; bytes: number; audio: boolean }> {
  const result = await exec(gpu.ffmpegPath as string, ["-hide_banner", "-i", file], { timeout: 20000 }).catch(
    (error: { stderr?: string; stdout?: string }) => ({ stderr: error.stderr ?? "", stdout: error.stdout ?? "" }),
  );
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const duration = text.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = text.match(/Video:\s+\w+(?:\s*\([^)]*\))?.*?(\d{2,5})x(\d{2,5})/);
  if (!duration || !video) throw new Error(`Could not read ${file}\n${text.slice(0, 500)}`);
  const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  return {
    width: video[1],
    height: video[2],
    seconds: Math.round(seconds * 100) / 100,
    bytes: fs.statSync(file).size,
    audio: /Audio:/.test(text),
  };
}

fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(path.join(channelDir, "exports"), { recursive: true });

const jobs: { flick: Flick; slug: string; frames: number[] }[] = [
  { flick: ranking, slug: "ranking", frames: [2, 10, 18, 26, 34] },
  { flick: split, slug: "split", frames: [2, 10, 18] },
  { flick: dual, slug: "dual", frames: [3] },
  { flick: blank, slug: "blank", frames: [2, 10, 18, 26] },
];

const report: unknown[] = [];
for (const job of jobs) {
  const cutPath = path.join(channelDir, "exports", `long-${job.slug}-cut.mp4`);
  const styledPath = path.join(channelDir, "exports", `long-${job.slug}-styled.mp4`);
  const cutStarted = Date.now();
  await exportCut({
    ffmpeg: gpu.ffmpegPath,
    encoder: gpu.chosenEncoder,
    channelDir,
    flick: job.flick,
    media: channel.media,
    outputPath: cutPath,
  });
  const cutMs = Date.now() - cutStarted;
  const cutInfo = await measure(cutPath);
  console.log(`cut ${job.slug} ${cutMs}ms ${cutInfo.seconds}s ${cutInfo.width}x${cutInfo.height} audio=${cutInfo.audio}`);
  const stageDir = path.join(framesDir, "slices", job.slug);
  fs.mkdirSync(stageDir, { recursive: true });
  const localSrc = new Map<string, string>();
  const stageStarted = Date.now();
  for (const clip of job.flick.clips) {
    const asset = channel.media.find((item) => item.id === clip.mediaId);
    const absolute = resolveAsset(channelDir, asset);
    if (!absolute) throw new Error(`Missing source for ${clip.label}`);
    const dest = path.join(stageDir, `${clip.id}.mp4`);
    await exec(
      gpu.ffmpegPath as string,
      ["-y", "-ss", String(clip.inSec), "-to", String(clip.outSec), "-i", absolute, "-c", "copy", "-an", dest],
      { timeout: 120000 },
    );
    localSrc.set(clip.id, dest);
    channel.media.push({
      id: uid(),
      name: path.basename(dest),
      absolutePath: dest,
      durationSec: clip.outSec - clip.inSec,
      width: asset?.width ?? 0,
      height: asset?.height ?? 0,
      codec: asset?.codec ?? "h264",
    });
  }
  const stageMs = Date.now() - stageStarted;
  console.log(`stage ${job.slug} ${stageMs}ms`);
  const styledStarted = Date.now();
  const props = propsFor(job.flick);
  props.clips = props.clips.map((clip) => {
    const local = localSrc.get(clip.id);
    const length = Math.round((clip.outSec - clip.inSec) * 1000) / 1000;
    return local
      ? { ...clip, inSec: 0, outSec: length, src: `${mediaBase}/file?path=${encodeURIComponent(local)}` }
      : clip;
  });
  await renderFlick({
    entry: path.resolve("src/remotion/index.ts"),
    resourcesPath,
    outputPath: styledPath,
    props,
    logLevel: "error" as "info",
  });
  const styledMs = Date.now() - styledStarted;
  const styledInfo = await measure(styledPath);
  if (cutInfo.width !== "1080" || cutInfo.height !== "1920") throw new Error(`${job.slug} cut is ${cutInfo.width}x${cutInfo.height}`);
  if (styledInfo.width !== "1080" || styledInfo.height !== "1920" || styledInfo.bytes < 100_000) {
    throw new Error(`${job.slug} styled export is not a 1080x1920 video.`);
  }
  if (Math.abs(styledInfo.seconds - cutInfo.seconds) > 0.6) {
    throw new Error(`${job.slug} styled ${styledInfo.seconds}s does not match cut ${cutInfo.seconds}s`);
  }
  for (const at of job.frames) {
    if (at >= styledInfo.seconds - 0.15) continue;
    const frame = path.join(framesDir, `${job.slug}-${at.toFixed(0)}.jpg`);
    await exec(gpu.ffmpegPath as string, ["-y", "-ss", String(at), "-i", styledPath, "-frames:v", "1", "-q:v", "3", frame], {
      timeout: 30000,
    });
  }
  fs.copyFileSync(styledPath, path.join(desktop, `Long-${job.slug}.mp4`));
  const row = {
    slug: job.slug,
    cutMs,
    stageMs,
    styledMs,
    seconds: styledInfo.seconds,
    cutSeconds: cutInfo.seconds,
    cutBytes: cutInfo.bytes,
    styledBytes: styledInfo.bytes,
    cutAudio: cutInfo.audio,
    styledAudio: styledInfo.audio,
    cutRealtime: Math.round((cutInfo.seconds / (cutMs / 1000)) * 100) / 100,
    styledRealtime: Math.round((styledInfo.seconds / (styledMs / 1000)) * 100) / 100,
  };
  report.push(row);
  console.log(JSON.stringify(row));
}

const reportPath = path.join(channelDir, "exports", "long-report.json");
fs.writeFileSync(
  reportPath,
  JSON.stringify({ encoder: gpu.chosen, cpus: os.cpus().length, sources: Object.fromEntries(sources), report }, null, 2),
);
console.log(`report ${reportPath}`);
console.log("long ok");
process.exit(0);
