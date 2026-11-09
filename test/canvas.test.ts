import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDualLayout,
  applyDualShare,
  builtinTemplates,
  deleteClip,
  dragSeam,
  flickFromTemplate,
  fullFrame,
  moveClip,
  playbackOrder,
  splitClip,
  templateFromFlick,
  fitClipsToMedia,
  rankingClipRange,
  trimClip,
} from "../src/shared/canvas";
import { clipAudible, creditDrawtext, cutAudioFilter } from "../src/shared/mix";
import { timelineEnd } from "../src/shared/model";

test("a template copies onto a flick and leaves the original alone", () => {
  const [split] = builtinTemplates();
  const flick = flickFromTemplate(split, "Liam");
  assert.equal(flick.templateId, "builtin-split");
  assert.equal(flick.clips.length, 4);
  assert.ok(flick.clips.every((clip) => clip.mediaId === null));
  assert.notEqual(flick.clips[0].id, split.clips[0].id);
  assert.equal(split.regions[0].height, 0.6);
});

test("split, delete, and reorder stay on the track", () => {
  const flick = flickFromTemplate(builtinTemplates()[0], "Cuts");
  const hook = flick.clips.find((clip) => clip.label === "Hook");
  assert.ok(hook);
  const split = splitClip(flick.clips, hook.id, 1.5);
  assert.equal(split.filter((clip) => clip.trackId === hook.trackId).length, 4);
  const pieces = split.filter((clip) => clip.trackId === hook.trackId).sort((a, b) => a.startSec - b.startSec);
  assert.equal(pieces[0].outSec, 1.5);
  assert.equal(pieces[1].inSec, 1.5);
  const removed = deleteClip(split, pieces[0].id);
  const top = removed.filter((clip) => clip.trackId === hook.trackId).sort((a, b) => a.startSec - b.startSec);
  assert.equal(top[0].startSec, 0);
  assert.equal(timelineEnd(top), 7.5);
  const moved = moveClip(removed, top[0].id, 1);
  const order = moved
    .filter((clip) => clip.trackId === hook.trackId)
    .sort((a, b) => a.startSec - b.startSec)
    .map((clip) => clip.id);
  assert.notEqual(order[0], top[0].id);
});

test("a ranking range stays inside the file", () => {
  assert.deepEqual(rankingClipRange(0, 99, 2.4), { inSec: 0, outSec: 2.4 });
  assert.deepEqual(rankingClipRange(3.1, 3.2, 3.2), { inSec: 2.8, outSec: 3.2 });
  assert.deepEqual(rankingClipRange(0, 1.2, 2.4), { inSec: 0, outSec: 1.2 });
  const tiny = rankingClipRange(0, 0.2, 0.2);
  assert.ok(tiny.outSec <= 0.2);
  assert.ok(tiny.outSec - tiny.inSec >= 0.1);
});

test("a trim cannot run past the file", () => {
  const flick = flickFromTemplate(builtinTemplates()[0], "Limit");
  const hook = flick.clips.find((clip) => clip.label === "Hook");
  assert.ok(hook);
  hook.mediaId = "clip-red";
  const trimmed = trimClip(flick.clips, hook.id, "out", 9, 2);
  assert.equal(trimmed.find((clip) => clip.id === hook.id)?.outSec, 2);
  const fitted = fitClipsToMedia(flick.clips, new Map([["clip-red", 2]]));
  assert.equal(fitted.find((clip) => clip.id === hook.id)?.outSec, 2);
  assert.equal(timelineEnd(fitted.filter((clip) => clip.trackId === hook.trackId)) < timelineEnd(flick.clips.filter((clip) => clip.trackId === hook.trackId)), true);
});

test("trim ripples the following cut", () => {
  const flick = flickFromTemplate(builtinTemplates()[0], "Trim");
  const hook = flick.clips.find((clip) => clip.label === "Hook");
  assert.ok(hook);
  const next = trimClip(flick.clips, hook.id, "out", 2);
  const top = next.filter((clip) => clip.trackId === hook.trackId).sort((a, b) => a.startSec - b.startSec);
  assert.equal(top[0].outSec, 2);
  assert.equal(top[1].startSec, 2);
});

test("saving a template keeps the layout and drops the media", () => {
  const flick = flickFromTemplate(builtinTemplates()[0], "Saved");
  flick.clips[0].mediaId = "media-1";
  flick.clips[0].sourceUrl = "https://www.tiktok.com/@example/video/1";
  flick.clips[0].line = "Hello";
  flick.headline = "Bigger on top";
  flick.musicId = "11111111-1111-4111-8111-111111111111";
  flick.musicCredit = "Artist, track";
  flick.regions = dragSeam(flick.regions, flick.regions[0].id, 0.72);
  const saved = templateFromFlick(flick, "My split");
  assert.equal(saved.builtin, false);
  assert.equal(saved.regions.length, 2);
  assert.equal(saved.regions[0].height, 0.72);
  assert.equal(saved.headline, "Bigger on top");
  assert.equal("musicId" in saved, false);
  assert.equal("musicCredit" in saved, false);
  assert.ok(saved.clips.every((clip) => clip.mediaId === null && clip.sourceUrl === undefined));
  assert.equal(saved.clips.find((clip) => clip.label === "Hook")?.line, "Hello");
  assert.equal(saved.clips.find((clip) => clip.label === "Hook")?.outSec, 3);
  const again = flickFromTemplate(saved, "Again");
  assert.equal(again.headline, "Bigger on top");
  assert.equal(again.musicId, undefined);
  assert.equal(again.musicCredit, undefined);
  assert.equal(again.regions[0].height, 0.72);
  assert.equal(again.clips.find((clip) => clip.label === "Hook")?.line, "Hello");
  assert.ok(again.clips.every((clip) => clip.mediaId === null));
});

test("full frame and the seam edit the layout without touching cuts", () => {
  const flick = flickFromTemplate(builtinTemplates()[0], "Layout");
  const full = fullFrame(flick.regions, flick.regions[0].id);
  assert.equal(full[0].height, 1);
  assert.equal(full[1].hidden, true);
  const dragged = dragSeam(flick.regions, flick.regions[0].id, 0.4);
  assert.equal(dragged[0].height, 0.4);
  assert.equal(dragged[1].y, 0.4);
  assert.equal(flick.clips.length, 4);
});

test("a split on the edge does nothing", () => {
  const blank = builtinTemplates().find((item) => item.id === "builtin-blank");
  assert.ok(blank);
  const flick = flickFromTemplate(blank, "Blank");
  assert.equal(flick.clips.length, 0);
  const split = flickFromTemplate(builtinTemplates()[0], "Edge");
  const hook = split.clips[0];
  assert.deepEqual(splitClip(split.clips, hook.id, hook.startSec), split.clips);
});

test("dual video is half and half, with two clips, and the seam still moves", () => {
  const dual = builtinTemplates().find((item) => item.id === "builtin-dual");
  assert.ok(dual);
  assert.equal(dual.regions.length, 2);
  assert.equal(dual.clips.length, 2);
  assert.equal(dual.regions[0].trackId, "track-face");
  assert.equal(dual.regions[1].trackId, "track-game");
  assert.equal(dual.regions[0].height, 0.5);
  assert.equal(dual.regions[1].y, 0.5);
  assert.equal(dual.regions[1].height, 0.5);
  assert.equal(dual.tracks.every((track) => track.muted === false), true);
  assert.ok(dual.clips.some((clip) => clip.trackId === "track-face" && clip.label === "Face"));
  assert.ok(dual.clips.some((clip) => clip.trackId === "track-game" && clip.label === "Gameplay"));

  const flick = flickFromTemplate(dual, "Drew");
  assert.equal(flick.templateId, "builtin-dual");
  assert.equal(flick.clips.length, 2);
  assert.ok(flick.clips.every((clip) => clip.mediaId === null));
  assert.notEqual(flick.regions[0].id, dual.regions[0].id);
  assert.equal(dual.regions[0].height, 0.5);

  const faceLarger = applyDualLayout(flick.regions, "face-top", "face-larger");
  assert.equal(faceLarger.find((region) => region.trackId === "track-face")?.height, 0.6);
  assert.equal(faceLarger.find((region) => region.trackId === "track-game")?.y, 0.6);
  assert.equal(faceLarger.find((region) => region.trackId === "track-game")?.height, 0.4);

  const gameLarger = applyDualLayout(flick.regions, "face-top", "game-larger");
  assert.equal(gameLarger.find((region) => region.trackId === "track-face")?.height, 0.4);
  assert.equal(gameLarger.find((region) => region.trackId === "track-game")?.height, 0.6);

  const gameOnTop = applyDualLayout(flick.regions, "game-top", "half");
  assert.equal(gameOnTop.find((region) => region.trackId === "track-game")?.y, 0);
  assert.equal(gameOnTop.find((region) => region.trackId === "track-game")?.height, 0.5);
  assert.equal(gameOnTop.find((region) => region.trackId === "track-face")?.y, 0.5);

  const laid = applyDualLayout(flick.regions, "face-top", "half");
  const top = laid.find((region) => region.y === 0);
  assert.ok(top);
  const dragged = dragSeam(laid, top.id, 0.33);
  assert.equal(dragged.find((region) => region.id === top.id)?.height, 0.33);
  assert.equal(dragged.find((region) => region.id !== top.id && region.trackId === "track-game")?.y, 0.33);
  assert.equal(flick.clips.length, 2);
});

test("shuffle plays a mixed order and leaves the rank numbers alone", () => {
  const slots = [
    { id: "a", rank: 5 },
    { id: "b", rank: 4 },
    { id: "c", rank: 3 },
  ];
  assert.deepEqual(
    playbackOrder(slots, "countdown").map((slot) => slot.rank),
    [5, 4, 3],
  );
  assert.deepEqual(
    playbackOrder(slots, "shuffle", ["c", "a", "b"]).map((slot) => slot.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    playbackOrder(slots, "shuffle", ["c", "a", "b"]).map((slot) => slot.rank),
    [3, 5, 4],
  );
});

test("a heard track stays audible when a voice is on the flick", () => {
  const heard = { muted: false };
  const quiet = { muted: true };
  assert.equal(clipAudible(heard, true), true);
  assert.equal(clipAudible(heard, false), true);
  assert.equal(clipAudible(quiet, true), false);
  assert.equal(clipAudible(undefined, true), false);
});

test("export cut keeps the music and voice levels", () => {
  const both = cutAudioFilter({
    hasVoice: true,
    hasMusic: true,
    drawtext: creditDrawtext("/Library/Fonts/Arial.ttf", "/tmp/credit.txt"),
  });
  assert.ok(both);
  assert.match(both, /normalize=0/);
  assert.match(both, /volume=1\.0/);
  assert.match(both, /volume=0\.10/);
  assert.match(both, /drawtext/);
  const music = cutAudioFilter({ hasVoice: false, hasMusic: true, drawtext: null });
  assert.match(music ?? "", /volume=0\.22/);
  assert.doesNotMatch(music ?? "", /amix/);
  assert.equal(cutAudioFilter({ hasVoice: true, hasMusic: false, drawtext: null }), null);
});
