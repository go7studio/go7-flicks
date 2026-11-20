import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  accentOnPaper,
  inkOnPaper,
  overlayFrameStyle,
  overlayPlaceOf,
  rankColorOf,
  rankSizeOf,
  readableOn,
  storedOverlayPlace,
  storedRankColor,
  storedRankSize,
} from "../src/shared/canvas";
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

test("opening the timeline keeps the rank and caption look", () => {
  const existing = sampleFlick({
    rankSize: 90,
    rankColor: "#112233",
    rankPlace: "middle",
    linePlace: "top",
    lineSize: 80,
    lineColor: "#abcdef",
    clips: [rankClip("old-rank", "old-media")],
  });
  const next = openDeskFlick(existing, {
    name: "Ranking",
    editedTrackIds: ["track-top"],
    clips: [rankClip("new-rank", "new-media")],
    rankSize: 160,
    rankPlace: "bottom",
    linePlace: "middle",
  });
  assert.equal(next.flick.rankSize, 160);
  assert.equal(next.flick.rankColor, "#112233");
  assert.equal(next.flick.rankPlace, "bottom");
  assert.equal(next.flick.linePlace, "middle");
  assert.equal(next.flick.lineSize, 80);
  assert.equal(next.flick.lineColor, "#abcdef");
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
  const onPicture = ruleBody(css, ".phone .phone-rank");
  assert.match(onPicture, /position:\s*absolute/);
  assert.match(clip, /var\(--line-size/);
  assert.doesNotMatch(clip, /background:\s*#fffdf8/);
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
  assert.equal(source.includes("WebkitTextStroke"), false);
  assert.match(source, /overlayFrameStyle\(rankPlace, "rank"\)/);
  assert.match(source, /overlayFrameStyle\(linePlace, "line"\)/);
  assert.match(source, /rankColorOf\(props\.rankColor\)/);
  assert.match(source, /lineColorOf\(props\.lineColor\)/);
  assert.equal(source.includes('background: "#fffdf8"'), true);
  assert.equal(overlayFrameStyle("top", "rank").top, 36);
  assert.equal(rankColorOf(undefined), "#e2b340");
});

test("rank and caption size, place, and color have usable defaults", () => {
  assert.equal(rankSizeOf(undefined), 132);
  assert.equal(rankSizeOf(10), 72);
  assert.equal(rankSizeOf(999), 220);
  assert.equal(storedRankSize(132), undefined);
  assert.equal(storedRankSize(90), 90);
  assert.equal(rankColorOf("nope"), "#e2b340");
  assert.equal(rankColorOf("#ff2255"), "#ff2255");
  assert.equal(storedRankColor("#e2b340"), undefined);
  assert.equal(storedRankColor("#ff2255"), "#ff2255");
  assert.equal(overlayPlaceOf("sideways", "bottom"), "bottom");
  assert.equal(overlayPlaceOf("middle", "top"), "middle");
  assert.equal(storedOverlayPlace("top", "top"), undefined);
  assert.equal(storedOverlayPlace("bottom", "top"), "bottom");
  assert.equal(overlayFrameStyle("middle", "line").top, "50%");
  assert.equal(overlayFrameStyle("bottom", "line").bottom, "6%");
  assert.equal(overlayFrameStyle("bottom", "rank").bottom, "8%");
  assert.equal(overlayFrameStyle("top", "line").top, "8%");
  assert.equal(readableOn("#e2b340"), "#1c1915");
  assert.equal(readableOn("#1c1915"), "#fffdf8");
  assert.equal(readableOn("#ffffff"), "#1c1915");
});

test("look controls sit in front of more and stay human", () => {
  const ranking = fs.readFileSync(path.join("src", "ui", "RankingStudio.tsx"), "utf8");
  const inspector = ranking.slice(ranking.indexOf('className="inspector'), ranking.indexOf("function LookPanel"));
  const lookButton = inspector.search(/>\r?\n\s*Look\b/);
  const moreButton = inspector.search(/>\r?\n\s*More\b/);
  assert.equal(lookButton >= 0 && moreButton > lookButton, true);
  assert.match(inspector, /Show the rank number/);
  assert.match(inspector, /Show captions/);
  assert.match(inspector, /Headline/);
  const look = ranking.slice(ranking.indexOf("function LookPanel"), ranking.indexOf("function LookSize"));
  for (const label of [
    "Show the rank number",
    "Show the caption",
    "Rank number size",
    "Caption size",
    "Rank number place",
    "Caption place",
    "Rank number color",
    "Caption color",
  ]) {
    assert.equal(look.includes(label), true, label);
  }
  assert.equal(/\b(flick|desk|slot|Cursor|Codex|paper pill)\b/i.test(look), false);
  assert.equal(ranking.includes("phone-side"), false);
  assert.match(ranking, /className=\{`phone-rank place-\$\{rankPlace\}`\}/);
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
