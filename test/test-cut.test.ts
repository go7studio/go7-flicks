import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { voiceMuxArgs } from "../electron/cut";
import { cutAudioFilter } from "../src/shared/mix";
import { clipLink } from "../src/shared/link";
import { FRAME } from "../src/shared/model";
import { builtinTemplates, flickFromTemplate, rankingClipRange, spokenLine } from "../src/shared/canvas";
import { clipsFromSearch, pickSubjectClips, placeFoundClips, skipSubjectTitle } from "../src/shared/subject";
import { captionFromFile } from "../src/remotion/FlickComposition";
import {
  CUT_BUTTON,
  DUAL_LABELS,
  HOME_LABELS,
  PARKOUR_FLICK,
  RANKING_LABELS,
  SHORT_LINKS,
  STYLED_BUTTON,
  captionIsNotFileName,
  missingLabels,
  rangeInsideFile,
  refusesKeeper,
  shortVoiceKeepsPicture,
  titleAboutSubject,
  whichClipVerdict,
} from "../scripts/cut-checks";

const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const home = read("../src/ui/HomeScreen.tsx");
const ranking = read("../src/ui/RankingStudio.tsx");
const split = read("../src/ui/SplitStudio.tsx");
const style = read("../src/ui/StyleFields.tsx");
const connections = read("../src/ui/ConnectionsScreen.tsx");
const canvas = read("../src/ui/CanvasScreen.tsx");

test("home shows Video Ranking and Dual video", () => {
  assert.deepEqual(missingLabels(home, HOME_LABELS), []);
});

test("the ranking desk has the cut controls", () => {
  const desk = `${ranking}\n${style}`;
  assert.deepEqual(missingLabels(desk, RANKING_LABELS), []);
});

test("the dual desk has the arrangement controls", () => {
  assert.deepEqual(missingLabels(split, DUAL_LABELS), []);
});

test("connections test leaves a note, and hear voice is on the voice rows", () => {
  assert.match(connections, /setMessage\(result\.message/);
  assert.match(connections, /className="banner start-note"/);
  const hear = connections.indexOf("Hear voice");
  const branch = connections.lastIndexOf('slot.kind === "elevenlabs" || slot.kind === "minimax"', hear);
  assert.ok(hear > branch && branch >= 0);
});

test("a ranking in and out stays inside the file", () => {
  const inside = rankingClipRange(0, 99, 2.4);
  assert.equal(rangeInsideFile(inside, 2.4), true);
  assert.ok(inside.outSec <= 2.4);
  const tail = rankingClipRange(10, 12, 3);
  assert.equal(rangeInsideFile(tail, 3), true);
  assert.equal(rangeInsideFile({ inSec: 0, outSec: 5 }, 2), false);
});

test("a caption is not a file name", () => {
  assert.equal(captionFromFile("", "flower.mp4"), "");
  assert.equal(captionFromFile("A flower", "flower.mp4"), "A flower");
  assert.equal(spokenLine("flower.mp4", "flower.mp4"), "");
  assert.equal(spokenLine("me-at-the-zoo", "me-at-the-zoo.mp4"), "");
  assert.equal(spokenLine("Me at the zoo", "me-at-the-zoo.mp4"), "Me at the zoo");
  assert.equal(captionIsNotFileName("Me at the zoo", "me-at-the-zoo.mp4"), true);
  assert.equal(captionIsNotFileName("flower.mp4", "flower.mp4"), false);
  assert.equal(captionIsNotFileName("flower", "flower.mp4"), false);
  assert.equal(captionIsNotFileName("", "flower.mp4"), false);
});

test("a short voice does not end the picture", () => {
  const args = voiceMuxArgs("picture.mp4", "voice.mp3", "out.mp4", 0);
  assert.equal(shortVoiceKeepsPicture(args), true);
  assert.equal(args.includes("-c:v") && args[args.indexOf("-c:v") + 1], "copy");
  const graph = cutAudioFilter({ hasVoice: true, hasMusic: true, drawtext: null });
  assert.match(graph ?? "", /apad/);
  assert.match(graph ?? "", /duration=longest/);
});

test("a new ranking frame is 1080 by 1920", () => {
  assert.equal(FRAME.width, 1080);
  assert.equal(FRAME.height, 1920);
  const template = builtinTemplates().find((item) => item.id === "builtin-ranking");
  assert.ok(template);
  const flick = flickFromTemplate(template, "Cut test");
  assert.equal(flick.width, 1080);
  assert.equal(flick.height, 1920);
});

test("the canvas can invoke the cut export and the styled export", () => {
  assert.match(canvas, new RegExp(`exportFlick\\("cut"\\)`));
  assert.match(canvas, new RegExp(`exportFlick\\("styled"\\)`));
  assert.match(canvas, new RegExp(CUT_BUTTON));
  assert.match(canvas, new RegExp(STYLED_BUTTON));
});

test("find clips fills empty slots, skips non-videos, and stays on the subject", () => {
  const hits = clipsFromSearch({
    entries: [
      { id: "gardenclip1", title: "Gardening fail in the yard", duration: 20, url: "https://www.youtube.com/watch?v=gardenclip1" },
      { _type: "playlist", id: "PL123", title: "mix", url: "https://www.youtube.com/playlist?list=PL123" },
      { id: "thumbnails", title: "still", url: "https://i.ytimg.com/vi/gardenclip1/hqdefault.jpg" },
      { id: "longcompile", title: "Gardening fails compilation", duration: 40, url: "https://www.youtube.com/watch?v=longcompile" },
    ],
  });
  assert.equal(hits.some((hit) => hit.url.includes("playlist") || hit.url.includes("ytimg")), false);
  const picked = pickSubjectClips(hits, 3, "gardening");
  assert.deepEqual(picked.map((hit) => hit.title), ["Gardening fail in the yard"]);
  assert.equal(skipSubjectTitle("Gardening fails compilation", "gardening"), true);
  const slots = [
    { mediaId: "keep", mediaName: "kept.mp4", previewUrl: null, duration: 4, note: "", title: "Kept clip", inSec: 0, outSec: 2 },
    { mediaId: null, mediaName: "", previewUrl: null, duration: 0, note: "", title: "", inSec: 0, outSec: 3 },
  ];
  const placed = placeFoundClips(slots, [
    {
      mediaId: "new",
      mediaName: "garden.mp4",
      previewUrl: null,
      durationSec: 8,
      sourceUrl: "https://www.youtube.com/watch?v=gardenclip1",
      title: "Gardening fail in the yard",
    },
  ]);
  assert.equal(placed.slots[0].mediaId, "keep");
  assert.equal(placed.slots[0].title, "Kept clip");
  assert.equal(placed.slots[1].mediaId, "new");
  assert.equal(placed.placed, 1);
  assert.equal(titleAboutSubject("dog falls off the couch", "funny dogs"), true);
  assert.equal(titleAboutSubject("Funny cats at home", "funny dogs"), false);
  assert.equal(titleAboutSubject("Baking fails in the kitchen", "baking fails"), true);
});

test("which clip names a real clip and does not invent a ranking", () => {
  const ids = ["c1", "c2"];
  const names = ["The pot tips", "The dog sits"];
  const good = whichClipVerdict(
    "STRONGEST: c2\nWHY: It starts fast.\nHEADLINE: Dogs\nTITLE c2: The dog sits",
    ids,
    names,
  );
  assert.equal(good.ok, true);
  assert.equal(good.named, "The dog sits");
  const invented = whichClipVerdict("STRONGEST: c9\nTITLE c9: Made up clip", ids, names);
  assert.equal(invented.ok, false);
  const quiet = whichClipVerdict("", ids, names);
  assert.equal(quiet.ok, false);
  assert.equal(quiet.named, null);
});

test("two short public links stay different links", () => {
  const [zoo, flower] = SHORT_LINKS.map((item) => clipLink(item.url));
  assert.notEqual(zoo, flower);
  assert.match(zoo, /jNQXAC9IVRw/);
  assert.match(flower, /flower\.mp4$/);
});

test("the check refuses the keeper files", () => {
  assert.equal(refusesKeeper("D:\\GitHub\\Parkour fails test\\exports\\Walk check.mp4"), true);
  assert.equal(refusesKeeper(`D:\\GitHub\\Parkour fails test\\flicks\\${PARKOUR_FLICK}\\voice.mp3`), true);
  assert.equal(refusesKeeper("D:\\GitHub\\Go7 cut test\\exports\\cut-test-picture.mp4"), false);
  assert.equal(refusesKeeper("D:\\GitHub\\Go7 cut test\\flicks\\new-flick\\voice.mp3"), false);
});
