import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { connectionNote } from "../src/shared/connection-note";

test("each provider collapses, and setup starts collapsed", () => {
  const source = fs.readFileSync(path.join("src", "ui", "ConnectionsScreen.tsx"), "utf8");
  assert.match(source, /aria-expanded=\{isOpen\}/);
  assert.match(source, /aria-expanded=\{setup\}/);
  assert.match(source, /const isOpen = open\[slot\.key\] === true/);
  assert.match(source, /const setup = setupOpen\[slot\.key\] === true/);
  assert.match(source, /useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(source, /hidden=\{!isOpen\}/);
  assert.match(source, /display: isOpen \? "flex" : "none"/);
  assert.match(source, /\{isOpen \? "Hide" : "Show"\}/);
  assert.match(source, /\{setup \? "Hide setup" : "Setup"\}/);
  assert.match(source, /connectionNote\(slot\.kind, slot\.row\?\.statusNote \?\? ""\)/);
  assert.equal(source.includes("<details open"), false);
  assert.equal(/sign out/i.test(source), false);
});

test("the status line stays the cleaned connection sentence", () => {
  const raw = [
    "Warning: no stdin data received in 3s, proceeding without it",
    "Failed to authenticate. API Error: 401 OAuth access token has expired.",
  ].join("\n");
  assert.equal(
    connectionNote("claude", raw),
    "Claude is not signed in. The saved login has expired. Paste an API key, or sign in with the Claude program.",
  );
  assert.equal(connectionNote("codex", "Not tested yet."), "Not tested yet.");
});
