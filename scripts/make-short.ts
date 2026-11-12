/**
 * Search a subject, cut three action windows, and export a ranking short.
 * Run: npx tsx scripts/make-short.ts
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { downloadClip, searchSubject } from "../electron/download";
import { exportCut } from "../electron/cut";
import { probeGpu, probeMedia } from "../electron/probe";
import { startMediaServer } from "../electron/media-server";
import { renderFlick } from "../electron/styled";
import { failureLine, trimToAction } from "../electron/action";
import { builtinTemplates, flickFromTemplate, fullFrame, rankingClipRange } from "../src/shared/canvas";
import { subjectLine } from "../src/shared/subject";
import { round3, uid, type Flick, type MediaAsset } from "../src/shared/model";
import type { FlickProps } from "../src/remotion/FlickComposition";

const exec = promisify(execFile);
const SUBJECT = process.argv[2]?.trim() || "funny dogs";
const WANT = 3;

const gpu = await probeGpu();
if (!gpu.ffmpegPath || !gpu.chosenEncoder) throw new Error("ffmpeg is missing.");
console.log(`encoder ${gpu.chosen}`);

const bin = path.join(os.tmpdir(), "go7-ytdlp");
const log: string[] = [`search ${SUBJECT}`];
console.log(`searching “${SUBJECT}”`);
const hits = await searchSubject(SUBJECT, bin);
console.log(`candidates ${hits.length}`);
log.push(`candidates ${hits.length}`);
if (hits.length < WANT) log.push(`THIN SEARCH only ${hits.length} clips named the subject`);
for (const hit of hits.slice(0, 8)) {
  console.log(`  ${hit.durationSec ?? "?"}s  ${hit.title}`);
  log.push(`  ${hit.durationSec ?? "?"}s  ${hit.title}`);
}

const parent = path.resolve("out");
fs.mkdirSync(parent, { recursive: true });
const titleName = SUBJECT.replace(/\b\w/g, (letter) => letter.toUpperCase());
let channelName = titleName;
let dir = path.join(parent, channelName);
if (fs.existsSync(dir)) {
  channelName = `${titleName} ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`;
  dir = path.join(parent, channelName);
}
fs.mkdirSync(path.join(dir, "media"), { recursive: true });
fs.mkdirSync(path.join(dir, "flicks"), { recursive: true });
fs.mkdirSync(path.join(dir, "exports"), { recursive: true });

type Landed = { asset: MediaAsset; title: string; inSec: number; outSec: number; focus: number; url: string };
const landed: Landed[] = [];

for (const hit of hits) {
  if (landed.length >= WANT) break;
  if (hit.durationSec !== null && hit.durationSec > 90) continue;
  console.log(`download ${hit.title}`);
  let cleanup = () => {};
  try {
    const got = await downloadClip(hit.url, gpu.ffmpegPath, bin);
    cleanup = got.cleanup;
    const info = await probeMedia(got.file, gpu.ffmpegPath);
    if (info.durationSec < 0.8 || info.durationSec > 90 || info.width < 2) {
      console.log(`  skip ${info.durationSec.toFixed(1)}s ${info.width}x${info.height}`);
      continue;
    }
    const cut = await trimToAction(got.file, gpu.ffmpegPath, info.durationSec);
    const range = { inSec: cut.inSec, outSec: cut.outSec };
    const focus = cut.focus;
    const note = `impact ${cut.inSec}–${cut.outSec} ${cut.what}`;
    console.log(`  ${note}`);
    log.push(`${hit.title}\n  ${note}`);
    const fitted = rankingClipRange(range.inSec, range.outSec, info.durationSec);
    const id = uid();
    const ext = path.extname(got.file) || ".mp4";
    const relativePath = path.posix.join("media", `${id}${ext}`);
    fs.copyFileSync(got.file, path.join(dir, "media", `${id}${ext}`));
    landed.push({
      asset: {
        id,
        name: path.basename(got.file),
        relativePath,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        codec: info.codec,
      },
      title: shortTitle(hit.title),
      inSec: fitted.inSec,
      outSec: fitted.outSec,
      focus,
      url: hit.url,
    });
    console.log(`  kept “${landed.at(-1)?.title}” ${fitted.inSec}–${fitted.outSec}`);
  } catch (error) {
    const why = failureLine(error);
    console.log(`  failed: ${why}`);
    log.push(`FAIL ${hit.title}\n  ${why}`);
  } finally {
    cleanup();
  }
}

if (landed.length < 2) throw new Error(`Only found ${landed.length} clips.`);

const ranks = [3, 2, 1].slice(0, landed.length);
const byRank = landed.map((item, index) => ({ ...item, rank: ranks[landed.length - 1 - index] ?? 1 }));
byRank.sort((a, b) => b.rank - a.rank);

const template = builtinTemplates().find((item) => item.id === "builtin-ranking");
if (!template) throw new Error("Ranking template is missing.");
const line = subjectLine(SUBJECT);
const words = line.headline.split(" ");
const flick = flickFromTemplate(template, titleName);
const rankRegion = flick.regions.find((region) => region.trackId === "track-top");
if (!rankRegion) throw new Error("Ranking region is missing.");
flick.regions = fullFrame(flick.regions, rankRegion.id);
flick.headline = words.length > 1 ? `${words[0]}\n${words.slice(1).join(" ")}` : line.headline;
flick.headlineColor = "#fffdf8";
flick.accentWords = words.length > 1 ? words[words.length - 1] : line.accent;
flick.titleStroke = 8;
flick.showRank = true;
flick.titleFont = "Impact";
flick.lineColor = "#fffdf8";
flick.lineSize = 64;
flick.pictureWarmth = 10;

let cursor = 0;
const clips = byRank.map((item) => {
  const span = round3(item.outSec - item.inSec);
  const clip = {
    id: uid(),
    mediaId: item.asset.id,
    trackId: "track-top",
    startSec: cursor,
    inSec: item.inSec,
    outSec: item.outSec,
    label: `#${item.rank}`,
    line: item.title,
    focus: item.focus,
    sourceUrl: item.url,
  };
  cursor = round3(cursor + span);
  return clip;
});
flick.clips = clips;

const channel = {
  version: 1 as const,
  name: channelName,
  accent: "#e2b340",
  media: landed.map((item) => item.asset),
  flicks: [{ id: flick.id, name: flick.name, updatedAt: new Date().toISOString() }],
};
fs.mkdirSync(path.join(dir, "flicks", flick.id), { recursive: true });
fs.writeFileSync(path.join(dir, "channel.json"), JSON.stringify(channel, null, 2));
fs.writeFileSync(path.join(dir, "flicks", flick.id, "flick.json"), JSON.stringify(flick, null, 2));
console.log(`channel ${dir}`);
console.log(`flick ${flick.id} ${cursor}s`);

const media: MediaAsset[] = landed.map((item) => ({
  ...item.asset,
  absolutePath: path.join(dir, item.asset.relativePath ?? ""),
}));
const cutOut = path.join(dir, "exports", `${titleName}.mp4`);
await exportCut({
  ffmpeg: gpu.ffmpegPath,
  encoder: gpu.chosenEncoder,
  channelDir: dir,
  flick,
  media,
  outputPath: cutOut,
  videoBitrate: "8M",
});
await describe(gpu.ffmpegPath, cutOut, "cut");

const base = await startMediaServer({ channelDir: dir, channel, stagingDir: null });
const props: FlickProps = {
  fps: flick.fps,
  width: flick.width,
  height: flick.height,
  accent: channel.accent,
  headline: flick.headline,
  headlineColor: flick.headlineColor,
  accentWords: flick.accentWords,
  titleStroke: flick.titleStroke,
  showRank: flick.showRank,
  titleFont: flick.titleFont,
  lineColor: flick.lineColor,
  lineSize: flick.lineSize,
  pictureWarmth: flick.pictureWarmth,
  regions: flick.regions,
  tracks: flick.tracks,
  clips: flick.clips.map((clip) => {
    const asset = media.find((item) => item.id === clip.mediaId);
    return {
      id: clip.id,
      trackId: clip.trackId,
      startSec: clip.startSec,
      inSec: clip.inSec,
      outSec: clip.outSec,
      label: clip.label,
      line: clip.line,
      focus: clip.focus,
      src: asset?.absolutePath ? `${base}/file?path=${encodeURIComponent(asset.absolutePath)}` : undefined,
    };
  }),
  preview: false,
};
const styledOut = path.join(dir, "exports", `${titleName} styled.mp4`);
await renderFlick({
  entry: path.resolve("src/remotion/index.ts"),
  resourcesPath: path.resolve("remotion-bundle-missing"),
  outputPath: styledOut,
  props,
  videoBitrate: "8M",
  logLevel: "info",
});
await describe(gpu.ffmpegPath, styledOut, "styled");
console.log("done");
fs.writeFileSync(path.join(dir, "search-log.txt"), `${log.join("\n")}\n`);
process.exit(0);

function shortTitle(title: string): string {
  const words = title
    .replace(/[|#].*$/, "")
    .replace(/\([^)]*\)/g, "")
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter((word) => word && !/^(parkour|fails?|shorts?|tiktok|youtube|video|compilation)$/i.test(word));
  const text = (words.length ? words : title.split(/\s+/)).slice(0, 4).join(" ");
  return text.slice(0, 32) || "Fail";
}

async function describe(ffmpeg: string, file: string, label: string): Promise<void> {
  const size = fs.statSync(file).size;
  const { stderr } = await exec(ffmpeg, ["-hide_banner", "-i", file, "-f", "null", "-"], {
    timeout: 60_000,
    windowsHide: true,
  }).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));
  const video = /Video:\s*(\w+).*?(\d{3,4}x\d{3,4})/.exec(stderr ?? "");
  const duration = /Duration:\s*(\d+:\d+:\d+\.\d+)/.exec(stderr ?? "");
  console.log(`${label} ${file}`);
  console.log(`  ${size} bytes  ${video?.[1] ?? "?"} ${video?.[2] ?? "?"} ${duration?.[1] ?? "?"}`);
  if (size < 500) throw new Error(`${label} export was empty.`);
}
