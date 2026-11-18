import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { accentOnPaper, inkOnPaper } from "../src/shared/canvas";
import type { Clip, Flick } from "../src/shared/model";
import {
  captionFromFile,
  collectRegionLines,
  headlineFromFlick,
  openDeskFlick,
  splitTrackPair,
  titleFromClip,
  voiceStartOf,
  type CaptionClip,
  type CaptionRegion,
} from "../src/remotion/FlickComposition";

const regions: CaptionRegion[] = [
  { id: "face", trackId: "face", y: 0, height: 0.5, hidden: false },
  { id: "game", trackId: "game", y: 0.5, height: 0.5, hidden: false },
];

const clips: CaptionClip[] = [
  { trackId: "face", startSec: 0, inSec: 0, outSec: 4, line: "Hello from the face" },
  { trackId: "game", startSec: 0, inSec: 0, outSec: 4, line: "Words on the gameplay" },
];

test("paper pills keep light type readable", () => {
  assert.equal(inkOnPaper("#ffffff"), "#1c1915");
  assert.equal(inkOnPaper("#fffdf8"), "#1c1915");
  assert.equal(inkOnPaper(undefined), "#1c1915");
  assert.equal(inkOnPaper("#1c1915"), "#1c1915");
  assert.equal(inkOnPaper("#2255aa"), "#2255aa");
  assert.deepEqual(accentOnPaper("#e2b340"), { color: "#1c1915", background: "#e2b340" });
  assert.deepEqual(accentOnPaper("#ffffff"), { color: "#1c1915", background: "#e2b340" });
  assert.deepEqual(accentOnPaper("#143c72"), { color: "#143c72" });
});

test("a file stem is not a caption", () => {
  const stem = "parkour-fail-final-cut-very-long-name";
  const fileName = `${stem}.mp4`;
  assert.equal(captionFromFile("", fileName), "");
  assert.equal(captionFromFile("   ", fileName), "");
  assert.notEqual(captionFromFile("", fileName), stem);
  const typed = "The dog wins the hallway and keeps running";
  assert.equal(typed.length > 24, true);
  assert.equal(captionFromFile(typed, fileName), typed);
  assert.equal(captionFromFile(typed, fileName).includes(stem), false);
});

test("both region lines are collected", () => {
  const lines = collectRegionLines(regions, clips, 1, true);
  assert.deepEqual(
    lines.map((item) => item.line),
    ["Hello from the face", "Words on the gameplay"],
  );
  assert.deepEqual(
    lines.map((item) => item.regionId),
    ["face", "game"],
  );
  assert.deepEqual(collectRegionLines(regions, clips, 1, false), []);
  const hidden = collectRegionLines([{ ...regions[0], hidden: true }, regions[1]], clips, 1, true);
  assert.deepEqual(
    hidden.map((item) => item.line),
    ["Words on the gameplay"],
  );
  const named = collectRegionLines(
    regions,
    [
      { trackId: "face", startSec: 0, inSec: 0, outSec: 4, line: "face-cam.mp4" },
      { trackId: "game", startSec: 0, inSec: 0, outSec: 4, line: "Words on the gameplay" },
    ],
    1,
    true,
  );
  assert.deepEqual(
    named.map((item) => item.line),
    ["Words on the gameplay"],
  );
  const sameFile = collectRegionLines(
    regions,
    [
      { trackId: "face", startSec: 0, inSec: 0, outSec: 4, line: "clip", fileName: "clip.mp4" },
      { trackId: "game", startSec: 0, inSec: 0, outSec: 4, line: "Words on the gameplay", fileName: "game.mp4" },
    ],
    1,
    true,
  );
  assert.deepEqual(
    sameFile.map((item) => item.line),
    ["Words on the gameplay"],
  );
});

test("voice starts at the saved time and defaults to zero", () => {
  assert.equal(voiceStartOf({}), 0);
  assert.equal(voiceStartOf({ voiceStartSec: 1.25 }), 1.25);
  assert.equal(voiceStartOf({ voiceStartSec: -4 }), 0);
  assert.equal(voiceStartOf({ voiceStartSec: Number.NaN }), 0);
});

function sampleFlick(patch: Partial<Flick> = {}): Flick {
  return {
    id: "flick-1",
    name: "Old",
    fps: 30,
    width: 1080,
    height: 1920,
    regions: [],
    tracks: [],
    clips: [],
    ...patch,
  };
}

function rankClip(id: string, mediaId: string): Clip {
  return { id, mediaId, trackId: "track-top", startSec: 0, inSec: 0, outSec: 3, label: "#5", line: "Words" };
}

test("open timeline keeps the same flick, its voice, and the loop", () => {
  const loop: Clip = { id: "loop", mediaId: "loop-media", trackId: "track-bottom", startSec: 0, inSec: 0, outSec: 8, label: "Loop" };
  const existing = sampleFlick({
    clips: [rankClip("old-rank", "old-media"), loop],
    voiceRelative: "voice.mp3",
    voiceStartSec: 1.5,
    musicId: "song",
    musicCredit: "Ada",
    headline: "Keep",
  });
  const next = openDeskFlick(existing, {
    name: "Ranking",
    editedTrackIds: ["track-top"],
    clips: [rankClip("new-rank", "new-media")],
    headline: "",
  });
  assert.equal(next.id, "flick-1");
  assert.equal(next.voiceKept, true);
  assert.equal(next.flick.id, "flick-1");
  assert.equal(next.flick.voiceRelative, "voice.mp3");
  assert.equal(next.flick.voiceStartSec, 1.5);
  assert.equal(next.flick.musicId, "song");
  assert.equal(next.flick.musicCredit, "Ada");
  assert.equal(next.flick.headline, "");
  assert.equal(next.flick.clips.some((clip) => clip.mediaId === "loop-media"), true);
  assert.equal(next.flick.clips.some((clip) => clip.mediaId === "new-media"), true);
  assert.equal(next.flick.clips.some((clip) => clip.mediaId === "old-media"), false);

  const created = openDeskFlick(null, {
    name: "New",
    editedTrackIds: ["track-top"],
    clips: [rankClip("new-rank", "new-media")],
    headline: "Fresh",
  });
  assert.equal(created.id, "");
  assert.equal(created.voiceKept, false);
  assert.equal(created.flick.voiceRelative, undefined);
  assert.equal(created.flick.voiceStartSec, undefined);
  assert.equal(created.flick.musicId, undefined);
  assert.equal(created.flick.musicCredit, undefined);
});

test("a voiceless flick does not keep a copied voice start", () => {
  const existing = sampleFlick({ voiceStartSec: 4, clips: [rankClip("old-rank", "old-media")] });
  const next = openDeskFlick(existing, {
    name: "Ranking",
    editedTrackIds: ["track-top"],
    clips: [rankClip("new-rank", "new-media")],
  });
  assert.equal(next.voiceKept, false);
  assert.equal(next.flick.voiceRelative, undefined);
  assert.equal(next.flick.voiceStartSec, undefined);
});

test("split screen and dual video use their own tracks", () => {
  assert.deepEqual(splitTrackPair({ templateId: "builtin-split", tracks: [{ id: "track-top" }, { id: "track-bottom" }] }), {
    face: "track-top",
    game: "track-bottom",
  });
  assert.deepEqual(splitTrackPair({ tracks: [{ id: "track-top" }, { id: "track-bottom" }] }), {
    face: "track-top",
    game: "track-bottom",
  });
  assert.deepEqual(splitTrackPair({ templateId: "builtin-dual", tracks: [{ id: "track-face" }, { id: "track-game" }] }), {
    face: "track-face",
    game: "track-game",
  });
  assert.deepEqual(splitTrackPair({ tracks: [{ id: "track-face" }, { id: "track-game" }] }), {
    face: "track-face",
    game: "track-game",
  });
});

test("a cleared headline stays empty", () => {
  const fallback = "Ranking the funniest\ncartoon moments";
  assert.equal(headlineFromFlick("", fallback), "");
  assert.equal(headlineFromFlick(undefined, fallback), fallback);
  assert.equal(headlineFromFlick("Parkour", fallback), "Parkour");
});

test("a filename label is not a caption", () => {
  assert.equal(titleFromClip({ label: "My_Vacation" }), "");
  assert.equal(titleFromClip({ label: "My_Vacation", line: "We stayed for the sunset" }), "We stayed for the sunset");
  assert.equal(titleFromClip({ label: "My_Vacation" }).includes("My_Vacation"), false);
});

function ruleBody(css: string, selector: string): string {
  const needle = `${selector} {`;
  let from = 0;
  while (from < css.length) {
    const start = css.indexOf(needle, from);
    if (start < 0) return "";
    const lineStart = css.lastIndexOf("\n", start) + 1;
    if (css.slice(lineStart, start).trim() === "") {
      const open = css.indexOf("{", start);
      const close = css.indexOf("}", open);
      return css.slice(open + 1, close);
    }
    from = start + needle.length;
  }
  return "";
}

test("the phone is a gold hairline and the rank is a shield", () => {
  const css = fs.readFileSync(path.join("src", "styles.css"), "utf8");
  const phone = ruleBody(css, ".phone");
  const rankingPhone = ruleBody(css, ".ranking .phone");
  const rank = ruleBody(css, ".phone-rank");
  const title = ruleBody(css, ".phone-title");
  const clip = ruleBody(css, ".phone-clip");
  for (const body of [phone, rankingPhone]) {
    assert.match(body, /border:\s*1px solid #e2b340/);
    assert.match(body, /border-radius:\s*28px/);
    assert.doesNotMatch(body, /12px solid #1c1915/);
  }
  assert.match(rank, /background:\s*#e2b340/);
  assert.match(rank, /color:\s*#1c1915/);
  assert.doesNotMatch(rank, /top:\s*46%/);
  assert.match(title, /background:\s*#fffdf8/);
  assert.match(clip, /background:\s*#fffdf8/);
  assert.match(clip, /border-radius:\s*999px/);
});

test("paper pills do not outline the caption", () => {
  const composition = fs.readFileSync(path.join("src", "remotion", "FlickComposition.tsx"), "utf8");
  const ranking = fs.readFileSync(path.join("src", "ui", "RankingStudio.tsx"), "utf8");
  assert.equal(composition.includes("WebkitTextStroke"), false);
  assert.equal(ranking.includes("WebkitTextStroke"), false);
});

test("the composition rank is a gold shield and captions are paper pills", () => {
  const source = fs.readFileSync(path.join("src", "remotion", "FlickComposition.tsx"), "utf8");
  assert.equal(source.includes("fontSize: 140"), false);
  assert.equal(source.includes("top: 420"), false);
  assert.equal(source.includes("rgba(28, 25, 21, 0.78)"), false);
  assert.equal(source.includes('background: "#e2b340"'), true);
  assert.equal(source.includes("top: 36"), true);
  assert.equal(source.includes('background: "#fffdf8"'), true);
  assert.equal(source.includes("borderRadius: 999"), true);
});

test("the desk phone matches the gold hairline", () => {
  const css = fs.readFileSync(path.join("src", "ui", "polish-desks.css"), "utf8");
  const phone = ruleBody(css, ".studio .phone");
  const play = ruleBody(css, ".studio .desk-play .btn-gold");
  assert.match(phone, /border:\s*1px solid #e2b340/);
  assert.match(phone, /border-radius:\s*28px/);
  assert.equal(css.includes(".split-side-caption"), true);
  assert.equal(play.includes("#fffdf8"), false);
  assert.match(ruleBody(css, ".studio .split-side-caption"), /background:\s*#fffdf8/);
});
