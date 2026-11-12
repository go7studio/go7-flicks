import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportCut } from "../electron/cut";
import { downloadClip } from "../electron/download";
import { probeGpu, probeMedia } from "../electron/probe";
import { builtinTemplates, flickFromTemplate } from "../src/shared/canvas";
import type { MediaAsset } from "../src/shared/model";

const face = String.raw`K:\PhoneVideo062424\Phone11242025\DCIM\AR Emoji camera\20200409_105621.mp4`;
const game = String.raw`K:\PhoneVideo062424\Phone11242025\DCIM\Camera\20191102_175739.mp4`;

const gpu = await probeGpu();
console.log(`encoder: ${gpu.chosen}`);
if (!gpu.ffmpegPath || !gpu.chosenEncoder) throw new Error("ffmpeg is missing.");

const server = http.createServer((req, res) => {
  const file = req.url === "/game.mp4" ? game : face;
  res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const binDir = path.join(os.tmpdir(), "go7flicks-ytdlp");
const got = await downloadClip(`http://127.0.0.1:${port}/face.mp4`, gpu.ffmpegPath, binDir);
const downloaded = await probeMedia(got.file, gpu.ffmpegPath);
console.log(`downloaded ${path.basename(got.file)} ${downloaded.durationSec}s ${downloaded.width}x${downloaded.height}`);
if (downloaded.durationSec < 0.4 || downloaded.width < 2) throw new Error("Downloaded file is not a video.");

const gameInfo = await probeMedia(game, gpu.ffmpegPath);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go7flicks-nas-"));
const flick = flickFromTemplate(builtinTemplates().find((item) => item.id === "builtin-blank")!, "NAS cut");
const media: MediaAsset[] = [
  { id: "nas-face", name: "face.mp4", absolutePath: got.file, ...downloaded },
  { id: "nas-game", name: "game.mp4", absolutePath: game, ...gameInfo },
];
const span = (info: { durationSec: number }, start: number) => {
  const end = Math.min(info.durationSec, start + 1.5);
  return { inSec: Math.min(start, Math.max(0, end - 0.4)), outSec: end };
};
const a = span(downloaded, 0.2);
const b = span(gameInfo, 0.4);
flick.clips = [
  { id: "cut-a", mediaId: "nas-face", trackId: flick.tracks[0].id, startSec: 0, ...a, label: "Face" },
  { id: "cut-b", mediaId: "nas-game", trackId: flick.tracks[0].id, startSec: a.outSec - a.inSec, ...b, label: "Game" },
];
const output = path.join(dir, "cut.mp4");
const started = Date.now();
await exportCut({
  ffmpeg: gpu.ffmpegPath,
  encoder: gpu.chosenEncoder,
  channelDir: dir,
  flick,
  media,
  outputPath: output,
});
const outInfo = await probeMedia(output, gpu.ffmpegPath);
const expected = a.outSec - a.inSec + (b.outSec - b.inSec);
console.log(`cut ${outInfo.width}x${outInfo.height} ${outInfo.durationSec}s in ${Date.now() - started}ms -> ${output}`);
if (outInfo.width !== 1080 || outInfo.height !== 1920) throw new Error(`Cut frame is ${outInfo.width}x${outInfo.height}.`);
if (Math.abs(outInfo.durationSec - expected) > 0.35) throw new Error(`Cut duration ${outInfo.durationSec}s, expected about ${expected}s.`);
got.cleanup();
server.close();
console.log("nas cut ok");
