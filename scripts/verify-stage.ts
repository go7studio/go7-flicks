import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportCut } from "../electron/cut";
import { startMediaServer, type MediaGate } from "../electron/media-server";
import { probeGpu, probeMedia } from "../electron/probe";
import { isNetworkPath, stageSource } from "../electron/stage";
import { renderFlick } from "../electron/styled";
import type { FlickProps } from "../src/remotion/FlickComposition";
import { builtinTemplates, flickFromTemplate } from "../src/shared/canvas";
import type { MediaAsset } from "../src/shared/model";

const camera = String.raw`K:\PhoneVideo062424\Phone11242025\DCIM\Camera`;
const minBytes = 400 * 1024 * 1024;
const maxBytes = 800 * 1024 * 1024;

const gpu = await probeGpu();
console.log(`encoder: ${gpu.chosen} ${gpu.chosenEncoder ?? ""}`);
console.log(`ffmpeg: ${gpu.ffmpegSource} ${gpu.ffmpegPath ?? ""}`);
if (!gpu.ffmpegPath || !gpu.chosenEncoder) throw new Error("ffmpeg is missing.");

const picked = fs
  .readdirSync(camera)
  .filter((name) => name.toLowerCase().endsWith(".mp4"))
  .map((name) => {
    const file = path.join(camera, name);
    return { file, size: fs.statSync(file).size };
  })
  .filter((item) => item.size >= minBytes && item.size <= maxBytes)
  .sort((a, b) => a.size - b.size)[0];
if (!picked) throw new Error("No 400-800MB camera file on K:.");
console.log(`source: ${picked.file}`);
console.log(`source-bytes: ${picked.size}`);
console.log(`source-network: ${isNetworkPath(picked.file)}`);
if (!isNetworkPath(picked.file)) throw new Error("The camera file was not detected as a network path.");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7flicks-stage-"));
const staging = path.join(root, "staging");
const firstStarted = Date.now();
const staged = await stageSource(picked.file, staging);
const firstMs = Date.now() - firstStarted;
const secondStarted = Date.now();
const again = await stageSource(picked.file, staging);
const secondMs = Date.now() - secondStarted;
const stagedSize = fs.statSync(staged).size;
console.log(`stage-first-ms: ${firstMs}`);
console.log(`stage-second-ms: ${secondMs}`);
console.log(`staged: ${staged}`);
console.log(`staged-bytes: ${stagedSize}`);
console.log(`staged-network: ${isNetworkPath(staged)}`);
console.log(`reused: ${again === staged}`);
if (again !== staged) throw new Error("The second stage did not reuse the working copy.");
if (stagedSize !== picked.size) throw new Error("The working copy size does not match.");
if (isNetworkPath(staged) || /^[kK]:/.test(staged)) throw new Error("The working copy is still on the network drive.");
if (secondMs > Math.max(1500, firstMs / 5)) throw new Error("The second stage was not much faster.");

const info = await probeMedia(staged, gpu.ffmpegPath);
console.log(`staged-media: ${info.width}x${info.height} ${info.durationSec}s ${info.codec}`);
const span = 3;
const inSec = Math.min(0.5, Math.max(0, info.durationSec - span - 0.1));
const outSec = Math.min(info.durationSec, inSec + span);
if (outSec - inSec < 2) throw new Error("The staged clip is too short to cut.");

const flick = flickFromTemplate(builtinTemplates().find((item) => item.id === "builtin-blank")!, "Staged");
const asset: MediaAsset = { id: "staged-src", name: path.basename(picked.file), absolutePath: staged, ...info };
flick.width = 1080;
flick.height = 1920;
flick.fps = 30;
flick.clips = [
  {
    id: "staged-clip",
    mediaId: asset.id,
    trackId: flick.tracks[0].id,
    startSec: 0,
    inSec,
    outSec,
    label: "Staged",
  },
];

const cutOut = path.join(root, "cut.mp4");
const cutStarted = Date.now();
await exportCut({
  ffmpeg: gpu.ffmpegPath,
  encoder: gpu.chosenEncoder,
  channelDir: root,
  flick,
  media: [asset],
  outputPath: cutOut,
});
const cutMs = Date.now() - cutStarted;
const cutInfo = await probeMedia(cutOut, gpu.ffmpegPath);
console.log(`cut-ms: ${cutMs}`);
console.log(`cut: ${cutInfo.width}x${cutInfo.height} ${cutInfo.durationSec}s ${cutOut}`);
if (cutInfo.width !== 1080 || cutInfo.height !== 1920) throw new Error(`Cut frame is ${cutInfo.width}x${cutInfo.height}.`);
if (Math.abs(cutInfo.durationSec - (outSec - inSec)) > 0.35) {
  throw new Error(`Cut duration ${cutInfo.durationSec}s, expected about ${outSec - inSec}s.`);
}

const resources = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Go7Flicks", "resources");
const bundle = path.join(resources, "remotion-bundle", "index.html");
if (!fs.existsSync(bundle)) throw new Error(`Installed Remotion bundle is missing: ${bundle}`);
const gate: MediaGate = {
  channelDir: root,
  channel: { version: 1, name: "Staged", accent: "#e2b340", media: [], flicks: [] },
  stagingDir: staging,
};
const mediaBase = await startMediaServer(gate);
const src = `${mediaBase}/file?path=${encodeURIComponent(staged)}`;
const props: FlickProps = {
  fps: 30,
  width: 1080,
  height: 1920,
  accent: "#e2b340",
  regions: flick.regions,
  tracks: flick.tracks,
  clips: [
    {
      id: "staged-clip",
      trackId: flick.tracks[0].id,
      startSec: 0,
      inSec,
      outSec,
      label: "Staged",
      src,
    },
  ],
  preview: false,
};
const styledOut = path.join(root, "styled.mp4");
const styledStarted = Date.now();
await renderFlick({
  entry: path.resolve("src/remotion/index.ts"),
  resourcesPath: resources,
  outputPath: styledOut,
  props,
  logLevel: "info",
});
const styledMs = Date.now() - styledStarted;
const styledInfo = await probeMedia(styledOut, gpu.ffmpegPath);
console.log(`styled-ms: ${styledMs}`);
console.log(`styled: ${styledInfo.width}x${styledInfo.height} ${styledInfo.durationSec}s ${styledOut}`);
console.log("styled-completed: yes");
if (styledInfo.width !== 1080 || styledInfo.height !== 1920) {
  throw new Error(`Styled frame is ${styledInfo.width}x${styledInfo.height}.`);
}
if (Math.abs(styledInfo.durationSec - (outSec - inSec)) > 0.35) {
  throw new Error(`Styled duration ${styledInfo.durationSec}s, expected about ${outSec - inSec}s.`);
}
console.log("stage check ok");
process.exit(0);
