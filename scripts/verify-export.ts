import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exportCut } from "../electron/cut";
import { probeGpu, probeMedia } from "../electron/probe";
import { renderFlick } from "../electron/styled";
import type { FlickProps } from "../src/remotion/FlickComposition";
import { flickFromTemplate, builtinTemplates } from "../src/shared/canvas";
import type { MediaAsset } from "../src/shared/model";

const exec = promisify(execFile);

const gpu = await probeGpu();
console.log(`cut encoder: ${gpu.chosen}`);
console.log(`ffmpeg: ${gpu.ffmpegSource} ${gpu.ffmpegPath ?? ""}`);
if (!gpu.ffmpegPath || !gpu.chosenEncoder) {
  throw new Error("ffmpeg is missing, so the cut path cannot be verified.");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go7flicks-verify-"));
const source = path.join(dir, "source.mp4");
await exec(
  gpu.ffmpegPath,
  ["-y", "-f", "lavfi", "-i", "color=c=0x222211:s=1080x1920:d=1", "-pix_fmt", "yuv420p", "-c:v", "libx264", source],
  { timeout: 30000 },
);
const info = await probeMedia(source, gpu.ffmpegPath);
const flick = flickFromTemplate(builtinTemplates()[1], "Verify");
const asset: MediaAsset = {
  id: "media-1",
  name: "source.mp4",
  absolutePath: source,
  durationSec: info.durationSec,
  width: info.width,
  height: info.height,
  codec: info.codec,
};
flick.clips = [
  {
    id: "clip-1",
    mediaId: asset.id,
    trackId: flick.tracks[0].id,
    startSec: 0,
    inSec: 0,
    outSec: Math.min(1, info.durationSec),
    label: "Color",
  },
];
const cutOut = path.join(dir, "cut.mp4");
await exportCut({
  ffmpeg: gpu.ffmpegPath,
  encoder: gpu.chosenEncoder,
  channelDir: dir,
  flick,
  media: [asset],
  outputPath: cutOut,
});
if (!fs.existsSync(cutOut) || fs.statSync(cutOut).size < 500) throw new Error("Cut export did not write a video.");
console.log(`cut export: ${cutOut} (${fs.statSync(cutOut).size} bytes)`);

const props: FlickProps = {
  fps: 30,
  width: 1080,
  height: 1920,
  accent: "#e2b340",
  regions: flick.regions,
  tracks: flick.tracks,
  clips: [{ id: "title", trackId: flick.tracks[0].id, startSec: 0, inSec: 0, outSec: 1, label: "Go7Flicks" }],
  preview: false,
};
const styledOut = path.join(dir, "styled.mp4");
await renderFlick({
  entry: path.resolve("src/remotion/index.ts"),
  resourcesPath: path.resolve("remotion-bundle-missing"),
  outputPath: styledOut,
  props,
  logLevel: "verbose",
});
if (!fs.existsSync(styledOut) || fs.statSync(styledOut).size < 500) throw new Error("Styled export did not write a video.");
console.log(`styled export: ${styledOut} (${fs.statSync(styledOut).size} bytes)`);
