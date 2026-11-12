import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { cleanUnused } from "../electron/cleanup";
import { setDriveTypeReader, stageSource } from "../electron/stage";

afterEach(() => {
  setDriveTypeReader(null);
});

test("cleanup drops an unused working copy and keeps one that is on a timeline", async () => {
  setDriveTypeReader(() => "Network Drive");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-clean-"));
  const keptSource = path.join(root, "kept.mp4");
  const unusedSource = path.join(root, "unused.mp4");
  fs.writeFileSync(keptSource, "kept-bytes");
  fs.writeFileSync(unusedSource, "unused-bytes");
  const staging = path.join(root, "staging");
  const keptCopy = await stageSource(keptSource, staging);
  const unusedCopy = await stageSource(unusedSource, staging);
  assert.notEqual(path.resolve(keptCopy), path.resolve(keptSource));
  const channel = path.join(root, "channel");
  const flickId = "11111111-1111-4111-8111-111111111111";
  const mediaId = "22222222-2222-4222-8222-222222222222";
  fs.mkdirSync(path.join(channel, "flicks", flickId), { recursive: true });
  fs.mkdirSync(path.join(channel, "exports"), { recursive: true });
  fs.writeFileSync(path.join(channel, "media-source.mp4"), "channel-source");
  fs.writeFileSync(
    path.join(channel, "channel.json"),
    JSON.stringify({
      version: 1,
      name: "Clean",
      media: [{ id: mediaId, name: "kept.mp4", absolutePath: keptSource, durationSec: 1, width: 1, height: 1, codec: "h264" }],
      flicks: [{ id: flickId, name: "Kept flick" }],
    }),
  );
  fs.writeFileSync(
    path.join(channel, "flicks", flickId, "flick.json"),
    JSON.stringify({
      id: flickId,
      name: "Kept flick",
      clips: [{ id: "clip", mediaId, trackId: "t", startSec: 0, inSec: 0, outSec: 1, label: "Kept" }],
    }),
  );
  fs.writeFileSync(path.join(channel, "exports", "Kept flick.mp4"), "real-export");
  fs.writeFileSync(path.join(channel, "exports", "Kept flick (1).mp4"), "older-export");
  fs.writeFileSync(path.join(channel, "exports", "splice-four.mp4"), "named-export");
  fs.writeFileSync(path.join(channel, "exports", "render.partial"), "partial");
  setDriveTypeReader(() => "Fixed Drive");
  const result = await cleanUnused(staging, [channel]);
  assert.equal(fs.existsSync(keptCopy), true);
  assert.equal(fs.existsSync(unusedCopy), false);
  assert.equal(fs.existsSync(keptSource), true);
  assert.equal(fs.existsSync(unusedSource), true);
  assert.equal(fs.existsSync(path.join(channel, "media-source.mp4")), true);
  assert.equal(fs.existsSync(path.join(channel, "exports", "Kept flick.mp4")), true);
  assert.equal(fs.existsSync(path.join(channel, "exports", "Kept flick (1).mp4")), false);
  assert.equal(fs.existsSync(path.join(channel, "exports", "splice-four.mp4")), true);
  assert.equal(fs.existsSync(path.join(channel, "exports", "render.partial")), false);
  assert.ok(result.removedCopies.includes(path.basename(unusedCopy)));
  assert.ok(result.removedExports.includes("Kept flick (1).mp4"));
  assert.ok(result.removedExports.includes("render.partial"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("cleanup does not delete exports on a network channel", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-clean-net-"));
  const channel = path.join(root, "channel");
  fs.mkdirSync(path.join(channel, "exports"), { recursive: true });
  fs.writeFileSync(path.join(channel, "channel.json"), JSON.stringify({ version: 1, media: [], flicks: [] }));
  fs.writeFileSync(path.join(channel, "exports", "go7-audit-temp.mp4"), "leave");
  setDriveTypeReader((letter) => (letter.toUpperCase() === path.parse(root).root[0]?.toUpperCase() ? "Network Drive" : "Fixed Drive"));
  const staging = path.join(root, "staging");
  fs.mkdirSync(staging);
  const result = await cleanUnused(staging, [channel]);
  assert.equal(fs.existsSync(path.join(channel, "exports", "go7-audit-temp.mp4")), true);
  assert.equal(result.skippedNetworkChannels, 1);
  assert.equal(result.removedExports.length, 0);
  setDriveTypeReader(null);
  fs.rmSync(root, { recursive: true, force: true });
});
