import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mediaMadeAt } from "../electron/made";
import { latestUpdatedAt, phoneMadeIso, whenPhrase } from "../src/shared/when";

const now = new Date(2026, 10, 10, 12, 0, 0);

test("a phone filename is the made date", () => {
  const iso = phoneMadeIso("VID_20241013_174556.mp4");
  assert.ok(iso);
  assert.equal(whenPhrase("Made", iso, now), "Made Oct 13, 2024");
  assert.equal(phoneMadeIso("notes.txt"), null);
  assert.equal(phoneMadeIso("20241340_174556.mp4"), null);
});

test("clipped dates stay short in the same year", () => {
  const iso = new Date(2026, 10, 9, 18, 0, 0).toISOString();
  assert.equal(whenPhrase("Clipped", iso, now), "Clipped Nov 9");
  assert.equal(whenPhrase("Clipped", "not-a-date", now), null);
});

test("the latest flick is the channel clip date", () => {
  assert.equal(latestUpdatedAt([]), undefined);
  assert.equal(
    latestUpdatedAt([{ updatedAt: "bad" }, { updatedAt: "2026-11-01T00:00:00.000Z" }, { updatedAt: "2026-11-09T12:00:00.000Z" }]),
    "2026-11-09T12:00:00.000Z",
  );
});

test("a file with no phone name uses its modified time", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go7-made-"));
  const file = path.join(dir, "night-drive.mp4");
  fs.writeFileSync(file, "picture");
  const made = new Date(2026, 10, 8, 9, 30, 0);
  fs.utimesSync(file, made, made);
  const iso = mediaMadeAt("night-drive.mp4", file);
  assert.ok(iso);
  assert.equal(whenPhrase("Made", iso, now), "Made Nov 8");
  const stamped = path.join(dir, "20241013_174556.mp4");
  fs.writeFileSync(stamped, "picture");
  assert.equal(whenPhrase("Made", mediaMadeAt("clip.mp4", stamped) ?? "", now), "Made Oct 13, 2024");
  assert.equal(mediaMadeAt("gone.mp4", path.join(dir, "missing.mp4")), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
