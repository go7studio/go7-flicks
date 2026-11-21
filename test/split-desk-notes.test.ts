import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const split = read("../src/ui/SplitStudio.tsx");

test("clicking a side title focuses the words field that edits it", () => {
  assert.match(split, /onEditWords/);
  assert.match(split, /focusWords\(/);
  assert.match(split, /faceWords\.current/);
  assert.match(split, /gameWords\.current/);
  assert.match(split, /className="split-side-caption"/);
  assert.match(split, /aria-label=\{caption \? `Edit \$\{wordsLabel\}` : wordsLabel\}/);
  assert.match(split, /Add words/);
  assert.equal(split.includes("contentEditable"), false);
  assert.match(split, /ref=\{faceWords\}/);
  assert.match(split, /ref=\{gameWords\}/);
  assert.match(split, /aria-label="Words on the face"/);
  assert.match(split, /aria-label="Words on the gameplay"/);
});

test("error notes clear themselves and stay off the toolbar buttons", () => {
  assert.match(split, /function flashNote\(/);
  assert.match(split, /setTimeout\(\(\) => setMessage\(""\), 3400\)/);
  assert.match(split, /className="desk-note"/);
  assert.match(split, /role="status"/);
  assert.equal(split.includes('className="banner"'), false);
  assert.match(split, /flashNote\("Add a clip to play\."\)/);
  assert.match(split, /flashNote\("Paste a link\."\)/);
});

test("sound switches keep an aria-label that names the side", () => {
  assert.match(split, /aria-label="Face sound"/);
  assert.match(split, /aria-label="Gameplay sound"/);
  assert.match(split, /role="switch"/);
});

test("secondary groups stay closed until their toggles open", () => {
  assert.match(split, /const \[lookOpen, setLookOpen\] = useState\(false\)/);
  assert.match(split, /const \[moreOpen, setMoreOpen\] = useState\(false\)/);
  assert.match(split, /const \[faceMore, setFaceMore\] = useState\(false\)/);
  assert.match(split, /const \[gameMore, setGameMore\] = useState\(false\)/);
  assert.match(split, /aria-expanded=\{lookOpen\}/);
  assert.match(split, /aria-expanded=\{moreOpen\}/);
  assert.match(split, /aria-expanded=\{faceMore\}/);
  assert.match(split, /aria-expanded=\{gameMore\}/);
  assert.match(split, /className="more-toggle"/);
  assert.match(split, /className="look-panel"/);
  assert.match(split, /className="more-panel"/);
  assert.match(split, />\s*Look\s*</);
  assert.match(split, />\s*More\s*</);
  assert.match(split, /aria-label="More face controls"/);
  assert.match(split, /aria-label="More gameplay controls"/);
});

test("a side mark focuses the same words field as the caption", () => {
  assert.match(split, /className="split-side-label"/);
  assert.equal((split.match(/onClick=\{onEditWords\}/g) ?? []).length >= 2, true);
  assert.match(split, /pointerEvents: "auto"/);
});

test("the status note stays in flow and does not take clicks", () => {
  const note = split.slice(split.indexOf('className="desk-note"'));
  assert.match(note, /position: "static"/);
  assert.match(note, /pointerEvents: "none"/);
  assert.match(note, /zIndex: 0/);
});

test("dual desk keeps one shared play and per-side in and out with no twelve second cap", () => {
  assert.match(split, /\{playing \? "Pause" : "Play"\}/);
  assert.equal((split.match(/togglePlay/g) ?? []).length >= 2, true);
  assert.match(split, /which="Face"/);
  assert.match(split, /which="Gameplay"/);
  assert.match(split, /No 12 second cap/);
  assert.equal(split.includes("SHORT_CLIP_SEC"), false);
  assert.equal(/\bMath\.min\([^)]*12/.test(split), false);
  assert.match(split, /sideWindow/);
});
