import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PREVIEW_LINE, previewFile } from "../electron/providers";

test("a voice preview is one short line in a temporary file", () => {
  assert.equal(PREVIEW_LINE, "Hello.");
  const file = previewFile("6ded349e-2cf4-43ed-9b1b-6d3398034cbe");
  assert.equal(path.dirname(file), os.tmpdir());
  assert.equal(path.basename(file).endsWith(".mp3"), true);
  assert.equal(path.basename(file) === "voice.mp3", false);
  assert.equal(file.includes(`${path.sep}flicks${path.sep}`), false);
});
