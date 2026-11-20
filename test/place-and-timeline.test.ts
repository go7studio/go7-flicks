import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  builtinTemplates,
  flickFromTemplate,
  frameForClips,
  placeClip,
  shelfRemovePlan,
  spokenLine,
  visibleSelection,
} from "../src/shared/canvas";
import type { Clip, Region } from "../src/shared/model";

function cut(id: string, trackId: string, startSec: number, outSec: number, mediaId: string | null, label: string): Clip {
  return { id, mediaId, trackId, startSec, inSec: 0, outSec, label };
}

test("an empty ranking loop is hidden and one picture fills the frame", () => {
  const ranking = builtinTemplates().find((item) => item.id === "builtin-ranking");
  assert.ok(ranking);
  assert.equal(ranking.regions[0].height, 0.62);
  assert.equal(ranking.regions[1].height, 0.38);
  assert.equal(ranking.clips.some((clip) => clip.label === "Loop"), true);
  const topOnly = ranking.clips.map((clip) => ({
    ...clip,
    mediaId: clip.trackId === "track-top" ? "picture" : null,
  }));
  const framed = frameForClips(ranking.regions, topOnly);
  const rank = framed.find((region) => region.trackId === "track-top");
  const loop = framed.find((region) => region.trackId === "track-bottom");
  assert.ok(rank);
  assert.ok(loop);
  assert.equal(rank.y, 0);
  assert.equal(rank.height, 1);
  assert.equal(rank.hidden, false);
  assert.equal(loop.hidden, true);
  assert.equal(loop.height, 0.38);
  assert.equal(topOnly.some((clip) => clip.label === "Loop"), true);

  const both = ranking.clips.map((clip) => ({ ...clip, mediaId: "picture" }));
  const split = frameForClips(ranking.regions, both);
  assert.equal(split.find((region) => region.trackId === "track-top")?.height, 0.62);
  assert.equal(split.find((region) => region.trackId === "track-bottom")?.y, 0.62);
  assert.equal(split.find((region) => region.trackId === "track-bottom")?.height, 0.38);
  assert.equal(split.every((region) => region.hidden === false), true);

  const restored = frameForClips(framed, both);
  assert.equal(restored.find((region) => region.trackId === "track-top")?.height, 0.62);
  assert.equal(restored.find((region) => region.trackId === "track-bottom")?.height, 0.38);
});

test("a ranking flick from the template keeps the empty loop and hides regions until they have media", () => {
  const ranking = builtinTemplates().find((item) => item.id === "builtin-ranking");
  assert.ok(ranking);
  const flick = flickFromTemplate(ranking, "Ranks");
  assert.equal(flick.templateId, "builtin-ranking");
  assert.equal(flick.clips.length, 6);
  assert.equal(flick.tracks.some((track) => track.name === "Loop"), true);
  assert.equal(flick.clips.some((clip) => clip.label === "Loop" && clip.mediaId === null), true);
  assert.equal(flick.regions.every((region) => region.hidden), true);
  assert.equal(ranking.regions[1].hidden, false);
});

test("place fills or replaces and append always adds", () => {
  const track = "track-top";
  const clips = [cut("a", track, 0, 2.4, null, "#5"), cut("b", track, 2.4, 2.4, null, "#4")];
  const incoming = cut("new", track, 0, 10, "file-1", "file_one");

  const placed = placeClip(clips, track, incoming, { mode: "place" });
  assert.equal(placed.length, 2);
  assert.equal(placed.find((clip) => clip.id === "a")?.mediaId, "file-1");
  assert.equal(placed.find((clip) => clip.id === "a")?.startSec, 0);
  assert.equal(placed.find((clip) => clip.id === "a")?.outSec, 2.4);
  assert.equal(placed.find((clip) => clip.id === "a")?.label, "#5");
  assert.equal(placed.find((clip) => clip.id === "b")?.mediaId, null);

  const replaced = placeClip(clips, track, incoming, { mode: "place", replaceId: "b" });
  assert.equal(replaced.find((clip) => clip.id === "b")?.mediaId, "file-1");
  assert.equal(replaced.find((clip) => clip.id === "b")?.startSec, 2.4);
  assert.equal(replaced.find((clip) => clip.id === "b")?.label, "#4");
  assert.equal(replaced.find((clip) => clip.id === "a")?.mediaId, null);

  const appended = placeClip(clips, track, incoming, { mode: "append" });
  assert.equal(appended.length, 3);
  assert.equal(appended.find((clip) => clip.id === "new")?.startSec, 4.8);
  assert.equal(appended.find((clip) => clip.id === "a")?.mediaId, null);

  const legacy = placeClip(clips, track, incoming);
  assert.equal(legacy.length, 3);
  assert.equal(legacy.find((clip) => clip.id === "new")?.mediaId, "file-1");

  const filled = [cut("a", track, 0, 2, "has", "#5")];
  const added = placeClip(filled, track, incoming, { mode: "place" });
  assert.equal(added.length, 2);
  assert.equal(added.find((clip) => clip.id === "new")?.startSec, 2);

  const loop = [cut("loop", "track-bottom", 0, 12, null, "Loop")];
  const short = cut("shot", "track-bottom", 0, 3, "loop-file", "loopfile");
  const clamped = placeClip(loop, "track-bottom", short, { mode: "place" });
  assert.equal(clamped.length, 1);
  assert.equal(clamped[0].id, "loop");
  assert.equal(clamped[0].mediaId, "loop-file");
  assert.equal(clamped[0].startSec, 0);
  assert.equal(clamped[0].outSec, 3);
  assert.equal(clamped[0].label, "Loop");
});

test("replacing a filled clip drops the old trim and keeps the typed line", () => {
  const track = "track-top";
  const filled = [{ ...cut("a", track, 0, 14, "old-file", "#5"), inSec: 10, line: "Already typed" }];
  const incoming = cut("new", track, 0, 5, "file-1", "file_one.mp4");

  const replaced = placeClip(filled, track, incoming, { mode: "place", replaceId: "a" });
  const clip = replaced.find((item) => item.id === "a");
  assert.ok(clip);
  assert.equal(clip.mediaId, "file-1");
  assert.equal(clip.inSec, 0);
  assert.equal(clip.outSec, 5);
  assert.equal(clip.outSec - clip.inSec, 5);
  assert.equal(clip.focus, 0.5);
  assert.equal(clip.line, "Already typed");
  assert.equal(clip.label, "#5");
  assert.notEqual(clip.line, incoming.label);

  const aimed = placeClip(filled, track, { ...incoming, focus: 0.25 }, { mode: "place", replaceId: "a" });
  assert.equal(aimed.find((item) => item.id === "a")?.focus, 0.25);
  assert.equal(aimed.find((item) => item.id === "a")?.inSec, 0);
  assert.equal(aimed.find((item) => item.id === "a")?.outSec, 5);

  const blank = [{ ...cut("a", track, 0, 14, "old-file", "#5"), inSec: 10 }];
  const untitled = placeClip(blank, track, incoming, { mode: "place", replaceId: "a" });
  assert.equal(untitled.find((item) => item.id === "a")?.line, undefined);

  const empty = [{ ...cut("slot", track, 0, 2.4, null, "#5"), line: "Kept" }];
  const opened = placeClip(empty, track, incoming, { mode: "place" });
  assert.equal(opened[0].inSec, 0);
  assert.equal(opened[0].outSec, 2.4);
  assert.equal(opened[0].line, "Kept");
  assert.equal(opened[0].label, "#5");
});

test("shelf remove waits for a successful save", () => {
  assert.deepEqual(shelfRemovePlan({ ok: true, message: "saved" }), { remove: true, message: "" });
  assert.deepEqual(shelfRemovePlan({ ok: false, message: "  Disk full.  " }), { remove: false, message: "Disk full." });
  assert.deepEqual(shelfRemovePlan({ ok: false }), { remove: false, message: "Could not save the flick." });

  const screen = readFileSync(fileURLToPath(new URL("../src/ui/CanvasScreen.tsx", import.meta.url)), "utf8");
  const start = screen.indexOf("async function removeAsset");
  const end = screen.indexOf("async function getLink");
  assert.ok(start >= 0 && end > start);
  const body = screen.slice(start, end);
  const flushAt = body.indexOf("await flushSave(dir)");
  const removeAt = body.indexOf("removeMedia(");
  assert.ok(flushAt >= 0);
  assert.ok(removeAt > flushAt);
  assert.ok(body.includes("shelfRemovePlan"));
  assert.ok(body.indexOf("if (!plan.remove)") < removeAt);
});

function region(id: string, trackId: string, hidden: boolean, height: number): Region {
  return { id, trackId, x: 0, y: hidden ? 0.62 : 0, width: 1, height, hidden };
}

test("selected region is one that is still visible and has media", () => {
  const ranking = builtinTemplates().find((item) => item.id === "builtin-ranking");
  assert.ok(ranking);
  const topOnly = ranking.clips.map((clip) => ({
    ...clip,
    mediaId: clip.trackId === "track-top" ? "picture" : null,
  }));
  const framed = frameForClips(ranking.regions, topOnly);
  const loop = framed.find((item) => item.trackId === "track-bottom");
  const rank = framed.find((item) => item.trackId === "track-top");
  assert.ok(loop && rank);
  assert.equal(loop.hidden, true);
  assert.equal(visibleSelection(framed, topOnly, loop.id), rank.id);
  assert.equal(visibleSelection(framed, topOnly, rank.id), rank.id);

  const hiddenWithMedia = [
    region("loop", "track-bottom", true, 0.38),
    region("rank", "track-top", false, 1),
  ];
  const bothPictures = [
    cut("top", "track-top", 0, 2, "picture", "#1"),
    cut("loop", "track-bottom", 0, 2, "loop-file", "Loop"),
  ];
  assert.equal(visibleSelection(hiddenWithMedia, bothPictures, "loop"), "rank");
  assert.equal(visibleSelection(hiddenWithMedia, bothPictures, null), "rank");

  const bare = [region("rank", "track-top", false, 1)];
  assert.equal(visibleSelection(bare, [cut("top", "track-top", 0, 2, null, "#1")], "rank"), null);
  assert.equal(visibleSelection(framed.map((item) => ({ ...item, hidden: true })), topOnly, rank.id), null);
});

function cssRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, selector);
  return match[1];
}

test("paper display locks the frame, play button, rank block, and playhead", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.match(css, /--paper:\s*#f7f3ea/i);
  assert.match(css, /--card:\s*#fffdf8/i);
  assert.match(css, /--gold:\s*#e2b340/i);
  assert.match(css, /--ink:\s*#1c1915/i);

  const frame = cssRule(css, ".frame-wrap");
  assert.match(frame, /border:\s*1px solid #e2b340/i);
  assert.match(frame, /border-radius:\s*28px/i);
  assert.doesNotMatch(frame, /12px solid #1c1915/i);

  const play = cssRule(css, ".btn.lane-play");
  assert.match(play, /background:\s*(?:var\(--gold\)|#e2b340)/i);

  const rank = cssRule(css, ".lane-rank .clip-block");
  assert.match(rank, /background:\s*#fffdf8/i);
  assert.match(rank, /border-color:\s*#e2b340/i);

  const head = cssRule(css, ".playhead-rule::before");
  assert.match(head, /border-radius:\s*50%/i);
  assert.doesNotMatch(head, /border-(?:left|right|top|bottom):[^;]*transparent/i);
});

test("the cut export button names the top picture it writes", () => {
  const screen = readFileSync(fileURLToPath(new URL("../src/ui/CanvasScreen.tsx", import.meta.url)), "utf8");
  assert.match(screen, /Save vertical video/);
  assert.match(screen, /Export top picture/);
  assert.equal(screen.includes("Export styled"), false);
  assert.equal(screen.includes("Export cut"), false);
  assert.match(screen, /exportFlick\("cut"\)/);
  assert.match(screen, /exportFlick\("styled"\)/);
  assert.match(screen, /YouTube title and description/);
  assert.match(screen, /aria-expanded=\{youtubeOpen\}/);
  assert.match(screen, /aria-label="YouTube title"/);
  assert.match(screen, /aria-label="YouTube description"/);
  assert.match(screen, /aria-label="Copy YouTube title"/);
  assert.match(screen, /aria-label="Copy YouTube description"/);
  assert.match(screen, /UPLOAD_FILE_NOTE/);
  assert.match(screen, /setYoutubeOpen\(true\)/);
  assert.match(screen, /setTimeout\(\(\) => setMessage\(""\), 4000\)/);
  assert.match(screen, /className="canvas-note"/);
  assert.equal(screen.includes('className="upload-card"'), false);
  assert.equal(screen.includes('{busy ? <p className="banner">'), false);
  const polish = readFileSync(fileURLToPath(new URL("../src/ui/polish-canvas.css", import.meta.url)), "utf8");
  const note = cssRule(polish, ".app.canvas-screen .canvas-note");
  assert.match(note, /position:\s*absolute/);
  const menu = cssRule(polish, ".app.canvas-screen .toolbar-youtube-menu");
  assert.match(menu, /position:\s*absolute/);
  const bar = cssRule(polish, ".app.canvas-screen .toolbar");
  assert.match(bar, /flex-wrap:\s*nowrap/);
  assert.match(screen, /Put on the ranking/);
  assert.match(screen, /Add to the ranking/);
  assert.match(screen, /Use as the background/);
  assert.match(screen, /Add to the background/);
  assert.match(screen, /Use as the video/);
  assert.match(screen, /Add to the video/);
  assert.equal(screen.includes("Encoder: {encoder}"), false);
  assert.match(screen, /If that track is already full, this adds a cut at the end/);
  assert.match(screen, /Write a line first/);
});

test("spokenLine drops a raw file stem and the media file name", () => {
  assert.equal(spokenLine("parkour_fails"), "");
  assert.equal(spokenLine("parkour-fails"), "");
  assert.equal(spokenLine("clip_01.mp4"), "");
  assert.equal(spokenLine("parkour fails"), "parkour fails");
  assert.equal(spokenLine("Hello there."), "Hello there.");
  assert.equal(spokenLine("clip", "clip.mp4"), "");
  assert.equal(spokenLine("CLIP.MP4", "clip.mp4"), "");
  assert.equal(spokenLine("A real line", "clip.mp4"), "A real line");
  assert.equal(spokenLine("My vacation", "My vacation.mp4"), "My vacation");
});
