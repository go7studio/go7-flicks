import assert from "node:assert/strict";
import test from "node:test";
import { connectedChat, readWhichClip, trendPrompt, voiceOnly, whichClipPrompt, type AssistClip } from "../src/shared/assist";

const clips: AssistClip[] = [
  { id: "slot-a", name: "Shore", line: "Low tide", lengthSec: 3.2, date: "Made Nov 8" },
  { id: "slot-b", name: "Pier", line: "", lengthSec: 4, date: "no date" },
];

test("the which-clip prompt stays on the clips already listed", () => {
  const prompt = whichClipPrompt(clips);
  assert.match(prompt, /Do not browse the web/);
  assert.match(prompt, /id=c1 name=Shore/);
  assert.match(prompt, /id=c2 name=Pier/);
  assert.match(prompt, /length=3.2s/);
  assert.match(prompt, /date=Made Nov 8/);
  assert.equal(prompt.includes("slot-a"), false);
});

test("a formatted reply can be applied, and a refusal cannot", () => {
  const pick = readWhichClip(
    ["STRONGEST: c1", "WHY: The tide line starts in the first second.", "HEADLINE: Low tide wins", "TITLE c1: Shore at dusk", "TITLE c2: Empty pier"].join("\n"),
    ["c1", "c2"],
  );
  assert.equal(pick.strongestId, "c1");
  assert.equal(pick.headline, "Low tide wins");
  assert.deepEqual(pick.titles, [
    { id: "c1", title: "Shore at dusk" },
    { id: "c2", title: "Empty pier" },
  ]);

  const refused = readWhichClip("I can't rank these clips.", ["c1", "c2"]);
  assert.equal(refused.strongestId, null);
  assert.equal(refused.headline, null);
  assert.equal(refused.titles.length, 0);
});

test("an unknown id is ignored", () => {
  const pick = readWhichClip("STRONGEST: c9\nHEADLINE: No\nTITLE c9: Skip", ["c1"]);
  assert.equal(pick.strongestId, null);
  assert.equal(pick.headline, "No");
  assert.equal(pick.titles.length, 0);
});

test("voice rows are not the assistant", () => {
  const rows = [
    { kind: "elevenlabs", connected: true },
    { kind: "minimax", connected: true },
    { kind: "claude", connected: false },
    { kind: "grok", connected: true },
  ];
  assert.equal(voiceOnly(rows), false);
  assert.deepEqual(
    connectedChat(rows).map((row) => row.kind),
    ["grok"],
  );
  assert.equal(voiceOnly([{ kind: "elevenlabs", connected: true }]), true);
});

test("the trend prompt does not ask for a download", () => {
  const prompt = trendPrompt(clips);
  assert.match(prompt, /Do not browse the web/);
  assert.match(prompt, /Do not suggest a download/);
});
