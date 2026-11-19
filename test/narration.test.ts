import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { allowsMicrophone, narrationBytes, narrationFile, writeNarration } from "../electron/narration";
import { ffmpegCandidates } from "../electron/probe";
import { bytesToBase64, microphoneMessage } from "../src/shared/microphone";
import { PARKOUR_FLICK } from "../scripts/cut-checks";

const exec = promisify(execFile);
const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("the canvas records narration beside Make voice", () => {
  const canvas = read("../src/ui/CanvasScreen.tsx");
  assert.match(canvas, /Make voice[\s\S]{0,500}Record narration/);
  assert.match(canvas, /recording \? "Stop" : "Record narration"/);
});

test("a denied microphone is a short reason", () => {
  const denied = new Error("Permission denied");
  denied.name = "NotAllowedError";
  assert.equal(microphoneMessage(denied), "Microphone permission was denied.");
  const missing = new Error("Requested device not found");
  missing.name = "NotFoundError";
  assert.equal(microphoneMessage(missing), "No microphone was found.");
});

test("only the microphone permission is granted", () => {
  assert.equal(allowsMicrophone("media", ["audio"]), true);
  assert.equal(allowsMicrophone("media", ["video"]), false);
  assert.equal(allowsMicrophone("media", ["audio", "video"]), false);
  assert.equal(allowsMicrophone("geolocation"), false);
  assert.equal(allowsMicrophone("display-capture", ["audio"]), false);
});

test("narration refuses the kept parkour voice", () => {
  const dir = String.raw`D:\GitHub\Parkour fails test`;
  const keeper = path.join(dir, "flicks", PARKOUR_FLICK, "voice.mp3");
  const before = fs.existsSync(keeper) ? fs.statSync(keeper).size : null;
  assert.throws(() => narrationFile(dir, PARKOUR_FLICK), /kept/);
  const after = fs.existsSync(keeper) ? fs.statSync(keeper).size : null;
  assert.equal(after, before);
  assert.throws(() => narrationFile(dir, "../" + PARKOUR_FLICK), /Bad id/);
});

test("narration bytes reject an empty take", () => {
  assert.throws(() => narrationBytes(""), /empty/);
  assert.throws(() => narrationBytes(Buffer.alloc(0)), /empty/);
  assert.deepEqual(narrationBytes(Buffer.from("abc").toString("base64")), Buffer.from("abc"));
  const sample = Buffer.from("Go7 narration");
  assert.equal(bytesToBase64(sample), sample.toString("base64"));
});

test("ffmpeg stores a narration as voice.mp3", async () => {
  const ffmpeg = ffmpegCandidates()[0]?.path;
  assert.ok(ffmpeg, "ffmpeg is required to store narration");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-narration-test-"));
  const flickId = "11111111-1111-4111-8111-111111111111";
  const folder = path.join(root, "flicks", flickId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "flick.json"), "{}", "utf8");
  const wav = path.join(root, "take.wav");
  await exec(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4", wav], {
    timeout: 20000,
    windowsHide: true,
  });
  const dest = await writeNarration(ffmpeg, root, flickId, fs.readFileSync(wav), "audio/wav");
  assert.equal(path.basename(dest), "voice.mp3");
  assert.equal(dest.includes(PARKOUR_FLICK), false);
  assert.ok(fs.statSync(dest).size > 128);
  fs.rmSync(root, { recursive: true, force: true });
});
