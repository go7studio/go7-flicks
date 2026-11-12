import http from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exportCut } from "../electron/cut";
import { probeGpu, probeMedia } from "../electron/probe";
import { renderFlick } from "../electron/styled";
import { builtinTemplates, flickFromTemplate } from "../src/shared/canvas";
import type { FlickProps } from "../src/remotion/FlickComposition";
import type { MediaAsset } from "../src/shared/model";

const exec = promisify(execFile);
const source = String.raw`K:\PhoneVideo062424\Phone11242025\DCIM\AR Emoji camera\20200409_105621.mp4`;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": fs.statSync(source).size });
  fs.createReadStream(source).pipe(res);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const sourceUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/emoji.mp4`;
const outDir = path.join(os.tmpdir(), "go7flicks-bench");
fs.mkdirSync(outDir, { recursive: true });

function msSince(start: number): number {
  return Date.now() - start;
}

const gpu = await probeGpu();
const info = await probeMedia(source, gpu.ffmpegPath!);
const rows: Record<string, unknown>[] = [];

function flickFor(seconds: number, heightShare = 1): { flick: ReturnType<typeof flickFromTemplate>; media: MediaAsset[] } {
  const template = builtinTemplates().find((item) => item.id === (heightShare < 1 ? "builtin-split" : "builtin-blank"))!;
  const flick = flickFromTemplate(template, "Bench");
  const asset: MediaAsset = { id: "bench-src", name: "emoji.mp4", absolutePath: source, ...info };
  const track = flick.tracks[0].id;
  flick.clips = [
    {
      id: "bench-clip",
      mediaId: asset.id,
      trackId: track,
      startSec: 0,
      inSec: 0.2,
      outSec: Math.min(info.durationSec, 0.2 + seconds),
      label: "Emoji",
    },
  ];
  return { flick, media: [asset] };
}

async function timeCut(label: string, seconds: number, file: string) {
  const { flick, media } = flickFor(seconds);
  const output = path.join(outDir, file);
  const start = Date.now();
  await exportCut({
    ffmpeg: gpu.ffmpegPath!,
    encoder: gpu.chosenEncoder!,
    channelDir: outDir,
    flick,
    media,
    outputPath: output,
  });
  const elapsed = msSince(start);
  const probed = await probeMedia(output, gpu.ffmpegPath!);
  rows.push({ label, elapsedMs: elapsed, seconds: probed.durationSec, bytes: fs.statSync(output).size, encoder: gpu.chosen });
  console.log(`${label} ${elapsed}ms ${probed.durationSec}s`);
  return output;
}

const first = await timeCut("cut reencode 1.5s", 1.5, "reencode.mp4");
const copiedInfo = await probeMedia(first, gpu.ffmpegPath!);
const copyFlick = flickFromTemplate(builtinTemplates().find((item) => item.id === "builtin-blank")!, "Copy");
const copyAsset: MediaAsset = { id: "copy-src", name: "already.mp4", absolutePath: first, ...copiedInfo };
copyFlick.clips = [
  {
    id: "copy-clip",
    mediaId: copyAsset.id,
    trackId: copyFlick.tracks[0].id,
    startSec: 0,
    inSec: 0,
    outSec: Math.min(copiedInfo.durationSec, 1.2),
    label: "Copy",
  },
];
{
  const output = path.join(outDir, "copy.mp4");
  const start = Date.now();
  await exportCut({
    ffmpeg: gpu.ffmpegPath!,
    encoder: gpu.chosenEncoder!,
    channelDir: outDir,
    flick: copyFlick,
    media: [copyAsset],
    outputPath: output,
  });
  rows.push({ label: "cut stream-copy 1.2s", elapsedMs: msSince(start), bytes: fs.statSync(output).size, encoder: gpu.chosen });
  console.log(`cut stream-copy ${rows.at(-1)!.elapsedMs}ms`);
}

async function rawNvenc(preset: string) {
  const output = path.join(outDir, `raw-${preset}.mp4`);
  const start = Date.now();
  await exec(gpu.ffmpegPath!, [
    "-y",
    "-ss",
    "0.2",
    "-to",
    "1.7",
    "-i",
    source,
    "-an",
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "h264_nvenc",
    "-preset",
    preset,
    "-b:v",
    "8M",
    output,
  ]);
  rows.push({ label: `raw nvenc ${preset} 1.5s`, elapsedMs: msSince(start), bytes: fs.statSync(output).size });
  console.log(`raw nvenc ${preset} ${rows.at(-1)!.elapsedMs}ms`);
}

await rawNvenc("p1");
await rawNvenc("p4");
await rawNvenc("p7");

async function timeStyled(label: string, seconds: number) {
  const { flick } = flickFor(seconds, 0.6);
  const props: FlickProps = {
    fps: 30,
    width: 1080,
    height: 1920,
    accent: "#e2b340",
    headline: "Bench",
    regions: flick.regions,
    tracks: flick.tracks,
    clips: [
      {
        id: "bench-clip",
        trackId: flick.tracks[0].id,
        startSec: 0,
        inSec: 0.2,
        outSec: 0.2 + seconds,
        label: "Emoji",
        src: sourceUrl,
      },
    ],
    preview: false,
  };
  const output = path.join(outDir, `${label.replace(/\s+/g, "-")}.mp4`);
  const start = Date.now();
  await renderFlick({
    entry: path.resolve("src/remotion/index.ts"),
    resourcesPath: process.cwd(),
    outputPath: output,
    props,
    logLevel: "info",
  });
  rows.push({
    label,
    elapsedMs: msSince(start),
    bytes: fs.statSync(output).size,
    frames: Math.round(seconds * 30),
  });
  console.log(`${label} ${rows.at(-1)!.elapsedMs}ms`);
}

await timeStyled("styled 1.5s", 1.5);
await timeStyled("styled 4s", 4);

const report = {
  machine: { platform: process.platform, cpus: os.cpus().length, encoder: gpu.chosen, ffmpeg: gpu.ffmpegSource },
  rows,
};
const reportPath = path.join(outDir, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(reportPath);
console.log(JSON.stringify(report, null, 2));
server.close();
