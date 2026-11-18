import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("home modes open a channel or connections", () => {
  const source = fs.readFileSync(path.join("src", "ui", "HomeScreen.tsx"), "utf8");
  assert.match(source, /Open a channel/);
  assert.match(source, /setNav\("library"\)/);
  assert.match(source, /Open connections/);
  assert.match(source, /onClick=\{onConnections\}/);
});

test("a new flick dialog closes on escape and marks the selected template", () => {
  const source = fs.readFileSync(path.join("src", "ui", "ChannelScreen.tsx"), "utf8");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-pressed=\{template\.id === templateId\}/);
  assert.match(source, /if \(event\.key === "Escape"\) setMaking\(false\)/);
  assert.match(source, /if \(event\.key === "Escape"\) setPendingDelete\(null\)/);
});

test("buttons keep a brass focus ring", () => {
  const css = fs.readFileSync(path.join("src", "styles.css"), "utf8");
  assert.match(css, /\.btn:focus-visible/);
  assert.match(css, /\.choice:focus-visible/);
  assert.match(css, /outline:\s*2px solid #8c6b2e/);
});

test("check sign-in saves the open form", () => {
  const source = fs.readFileSync(path.join("src", "ui", "ConnectionsScreen.tsx"), "utf8");
  const start = source.indexOf("async function signIn");
  const body = source.slice(start, source.indexOf("async function test"));
  assert.match(body, /draftForm\.name\.trim\(\)/);
  assert.match(body, /model: draftForm\.model\.trim\(\)/);
  assert.equal(body.includes("name: defaults.name"), false);
});
