import assert from "node:assert/strict";
import test from "node:test";
import { clipsFromSearch, pickSubjectClips, placeFoundClips, subjectCount, subjectLine, subjectQuery, videoUrl } from "../src/shared/subject";

const search = {
  entries: [
    { _type: "playlist", id: "PL123", url: "https://www.youtube.com/playlist?list=PL123", title: "Parkour mix", duration: 30 },
    { _type: "channel", id: "UC1234567890123456789012", url: "https://www.youtube.com/@parkour", title: "Parkour channel" },
    { id: "livevideo01", url: "https://www.youtube.com/watch?v=livevideo01", title: "Live parkour", duration: 40, live_status: "is_live" },
    { id: "shortclip01", url: "https://www.youtube.com/shorts/shortclip01", title: "Parkour fail one", duration: 48 },
    { id: "shortclip02", url: "https://www.youtube.com/watch?v=shortclip02", title: "Parkour fail two", duration: 12 },
    { id: "shortclip03", url: "https://www.youtube.com/watch?v=shortclip03", title: "Parkour fail three", duration: 31 },
    { id: "mediumclip1", url: "https://www.youtube.com/watch?v=mediumclip1", title: "Parkour fails three minutes", duration: 150 },
    { id: "longcompile", url: "https://www.youtube.com/watch?v=longcompile", title: "Parkour fails compilation", duration: 640 },
    { id: "thumbnails", url: "https://i.ytimg.com/vi/shortclip02/hqdefault.jpg", title: "thumbnail" },
    {
      _type: "playlist",
      title: "Shorts",
      entries: [{ id: "nestedshort", url: "https://www.youtube.com/shorts/nestedshort", title: "Nested parkour", duration: 9 }],
    },
  ],
};

test("a subject is a short name, not a blank", () => {
  assert.equal(subjectQuery("  parkour   fails "), "parkour fails");
  assert.equal(subjectCount(2), 2);
  assert.equal(subjectCount(9), 3);
  assert.throws(() => subjectQuery("   "), /Name a subject/);
});

test("a channel, a playlist, and a picture are not clips", () => {
  assert.equal(videoUrl("https://www.youtube.com/@parkour"), null);
  assert.equal(videoUrl("https://www.youtube.com/playlist?list=PL123"), null);
  assert.equal(videoUrl("https://i.ytimg.com/vi/shortclip02/hqdefault.jpg"), null);
  assert.equal(videoUrl("https://www.youtube.com/shorts/shortclip01"), "https://www.youtube.com/watch?v=shortclip01");
});

test("search keeps short videos and skips what is not a video", () => {
  const hits = clipsFromSearch(search);
  const ids = hits.map((hit) => hit.url);
  assert.ok(ids.includes("https://www.youtube.com/watch?v=shortclip01"));
  assert.ok(ids.includes("https://www.youtube.com/watch?v=nestedshort"));
  assert.equal(ids.some((url) => url.includes("playlist")), false);
  assert.equal(ids.some((url) => url.includes("livevideo01")), false);
  assert.equal(ids.some((url) => url.includes("ytimg")), false);
  const picked = pickSubjectClips(hits);
  assert.deepEqual(
    picked.slice(0, 3).map((hit) => hit.durationSec),
    [48, 12, 31],
  );
  assert.equal(picked.some((hit) => hit.durationSec === 640), false);
  assert.equal(picked.some((hit) => hit.durationSec === 150), false);
});

test("a short clip that does not name the subject waits", () => {
  const hits = [
    { url: "https://www.youtube.com/watch?v=basejump01", title: "BASE JUMP GOES HORRIBLY WRONG", durationSec: 18 },
    { url: "https://www.youtube.com/watch?v=parkour0001", title: "Parkour fails", durationSec: 40 },
    { url: "https://www.youtube.com/watch?v=parkour0002", title: "School parkour fail", durationSec: 22 },
    { url: "https://www.youtube.com/watch?v=parkour0003", title: "Insane parkour runner", durationSec: 15 },
    { url: "https://www.youtube.com/watch?v=fencevideo1", title: "How Different People Get Over a Fence", durationSec: 30 },
  ];
  const picked = pickSubjectClips(hits, 8, "parkour fails");
  assert.deepEqual(
    picked.map((hit) => hit.title),
    ["Parkour fails", "School parkour fail", "Insane parkour runner"],
  );
});

test("a robot, a news story, and a long compilation are skipped", () => {
  const hits = [
    { url: "https://www.youtube.com/watch?v=atlaspark01", title: "Atlas Parkour Fails - Boston Dynamics", durationSec: 13 },
    { url: "https://www.youtube.com/watch?v=collapse001", title: "Parkour fail results in building collapse", durationSec: 28 },
    { url: "https://www.youtube.com/watch?v=compile0001", title: "Parkour fails compilation", durationSec: 76 },
    { url: "https://www.youtube.com/watch?v=longparkour", title: "Parkour fails three minutes", durationSec: 150 },
    { url: "https://www.youtube.com/watch?v=schoolpark1", title: "School parkour fail", durationSec: 22 },
    { url: "https://www.youtube.com/watch?v=insanepark1", title: "Insane parkour runner", durationSec: 15 },
    { url: "https://www.youtube.com/watch?v=rooftopprk1", title: "Rooftop parkour fail", durationSec: 18 },
    { url: "https://www.youtube.com/watch?v=flipfails01", title: "World's best flip fails! The best parkour fails", durationSec: 20 },
    { url: "https://www.youtube.com/watch?v=failarmy001", title: "Funny fails | fail army parkour", durationSec: 16 },
  ];
  const picked = pickSubjectClips(hits, 8, "parkour fails");
  assert.deepEqual(
    picked.map((hit) => hit.title),
    ["School parkour fail", "Rooftop parkour fail", "Insane parkour runner"],
  );
});

test("a fall and a jump come before a roof with no person", () => {
  const hits = [
    { url: "https://www.youtube.com/watch?v=neardeath01", title: "parkour near death!!", durationSec: 16 },
    { url: "https://www.youtube.com/watch?v=schoolpark2", title: "School parkour fail", durationSec: 17 },
    { url: "https://www.youtube.com/watch?v=faceplant01", title: "Extreme Epic Parkour Fail Faceplant", durationSec: 12 },
    { url: "https://www.youtube.com/watch?v=roofjump001", title: "Rooftop parkour jump", durationSec: 20 },
  ];
  const picked = pickSubjectClips(hits, 3, "parkour fails");
  assert.deepEqual(
    picked.map((hit) => hit.title),
    ["School parkour fail", "Extreme Epic Parkour Fail Faceplant", "Rooftop parkour jump"],
  );
});

test("funny dogs keeps a dog clip and skips a moments compilation", () => {
  const hits = [
    { url: "https://www.youtube.com/watch?v=moments0001", title: "Funny Dog Moments Caught on Camera", durationSec: 72 },
    { url: "https://www.youtube.com/watch?v=furbo000001", title: "Funny Dogs Home Alone! Caught on Furbo Dog Camera!", durationSec: 73 },
    { url: "https://www.youtube.com/watch?v=couchdog001", title: "dog falls off the couch", durationSec: 14 },
    { url: "https://www.youtube.com/watch?v=funnycats01", title: "Funny cats at home", durationSec: 20 },
  ];
  const picked = pickSubjectClips(hits, 3, "funny dogs");
  assert.deepEqual(
    picked.map((hit) => hit.title),
    ["dog falls off the couch"],
  );
});

test("funny dogs keeps dogs and lets a fall count", () => {
  const hits = [
    { url: "https://www.youtube.com/watch?v=funnycats01", title: "Funny cats at home", durationSec: 20 },
    { url: "https://www.youtube.com/watch?v=funnydogs01", title: "Funny dogs in the yard", durationSec: 18 },
    { url: "https://www.youtube.com/watch?v=dogfall0001", title: "Funny dogs fall off the couch", durationSec: 15 },
  ];
  const picked = pickSubjectClips(hits, 3, "funny dogs");
  assert.deepEqual(
    picked.map((hit) => hit.title),
    ["Funny dogs fall off the couch", "Funny dogs in the yard"],
  );
});

test("filled ranking slots stay put", () => {
  const slots = [
    { id: "a", mediaId: "kept", mediaName: "kept.mp4", previewUrl: "kept", duration: 4, note: "https://kept", title: "Already", inSec: 0.2, outSec: 2 },
    { id: "b", mediaId: null, mediaName: "", previewUrl: null, duration: 0, note: "", title: "", inSec: 0, outSec: 3 },
    { id: "c", mediaId: "also", mediaName: "also.mp4", previewUrl: "also", duration: 5, note: "", title: "Second", inSec: 1, outSec: 3 },
    { id: "d", mediaId: null, mediaName: "", previewUrl: null, duration: 0, note: "", title: "Named", inSec: 0, outSec: 3 },
  ];
  const placed = placeFoundClips(slots, [
    { mediaId: "new-1", mediaName: "one.mp4", previewUrl: "one", durationSec: 12, sourceUrl: "https://www.youtube.com/watch?v=shortclip02", title: "Parkour fail two" },
    { mediaId: "new-2", mediaName: "two.mp4", previewUrl: "two", durationSec: 20, sourceUrl: "https://www.youtube.com/watch?v=shortclip03", title: "Parkour fail three" },
  ]);
  assert.equal(placed.placed, 2);
  assert.equal(placed.slots[0].mediaId, "kept");
  assert.equal(placed.slots[0].title, "Already");
  assert.equal(placed.slots[0].inSec, 0.2);
  assert.equal(placed.slots[1].mediaId, "new-1");
  assert.equal(placed.slots[1].title, "Parkour fail two");
  assert.equal(placed.slots[1].note, "https://www.youtube.com/watch?v=shortclip02");
  assert.equal(placed.slots[2].mediaId, "also");
  assert.equal(placed.slots[2].title, "Second");
  assert.equal(placed.slots[3].mediaId, "new-2");
  assert.equal(placed.slots[3].title, "Named");
});

test("a subject names the headline and the accent", () => {
  assert.deepEqual(subjectLine("parkour fails"), { headline: "Parkour fails", accent: "parkour" });
});

test("a found clip keeps the action range", () => {
  const slots = [
    { id: "a", mediaId: null, mediaName: "", previewUrl: null, duration: 0, note: "", title: "", inSec: 0, outSec: 3 },
  ];
  const placed = placeFoundClips(slots, [
    {
      mediaId: "new-1",
      mediaName: "one.mp4",
      previewUrl: "one",
      durationSec: 19,
      sourceUrl: "https://www.youtube.com/watch?v=shortclip02",
      title: "Parkour fail",
      inSec: 6.4,
      outSec: 10.4,
      focus: 0.2,
    },
  ]);
  assert.equal(placed.slots[0].inSec, 6.4);
  assert.equal(placed.slots[0].outSec, 10.4);
  assert.equal(placed.slots[0].focus, 0.2);
});
