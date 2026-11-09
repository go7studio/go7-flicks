import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listShelf, noteShelfCredit, rememberShelf, shelfSource } from "../electron/shelf";

test("a copied file is kept once and can be used again", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-shelf-"));
  const source = path.join(root, "tone.mp3");
  fs.writeFileSync(source, "tone-bytes");
  const info = { durationSec: 2, width: 0, height: 0, codec: "mp3" };
  const first = rememberShelf(root, source, info, "copy");
  const again = rememberShelf(root, source, info, "copy");
  assert.equal(again.id, first.id);
  assert.equal(listShelf(root).length, 1);
  const saved = shelfSource(root, first.id);
  assert.ok(saved);
  assert.equal(fs.readFileSync(saved.file, "utf8"), "tone-bytes");
  noteShelfCredit(root, { name: "tone.mp3", bytes: fs.statSync(source).size, durationSec: 2 }, "Artist, track");
  assert.equal(listShelf(root)[0].credit, "Artist, track");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a linked file stays out of the shelf once the original is gone", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-shelf-"));
  const source = path.join(root, "clip.mp4");
  fs.writeFileSync(source, "picture");
  rememberShelf(root, source, { durationSec: 1, width: 1080, height: 1920, codec: "h264" }, "link");
  assert.equal(listShelf(root)[0].kind, "video");
  fs.rmSync(source);
  assert.equal(listShelf(root).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
