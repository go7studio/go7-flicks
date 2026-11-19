import assert from "node:assert/strict";
import test from "node:test";
import { UPLOAD_FILE_NOTE, uploadDescription, uploadHandout, uploadTitle } from "../src/shared/upload-paste";

test("the upload title is the headline on one line, or the flick name", () => {
  assert.equal(uploadTitle("Best\nparkour  fails", "Ignored"), "Best parkour fails");
  assert.equal(uploadTitle("   ", "  Night\nwalk "), "Night walk");
  assert.equal(uploadTitle(undefined, "Parkour"), "Parkour");
  assert.equal(uploadTitle("\n\n", ""), "");
});

test("the upload description lists captions in order, then the music credit", () => {
  const text = uploadDescription(
    [
      { id: "c", line: "Couch dog", startSec: 3 },
      { id: "b", line: "Fence fail", startSec: 0, stack: 0.5 },
      { id: "a", line: "Rooftop jump", startSec: 0, stack: 0 },
      { id: "d", line: "parkour_fails.mp4", startSec: 1, mediaName: "parkour_fails.mp4" },
      { id: "e", line: "Wait!", startSec: 2 },
    ],
    "Lena Park, Night Walk",
  );
  assert.equal(text, "Rooftop jump. Fence fail. Wait! Couch dog. Music: Lena Park, Night Walk.");
  assert.equal(text.includes("#"), false);
  assert.doesNotMatch(text, /\bviews\b/i);
});

test("a blank credit stays out, and a finished credit keeps its ending", () => {
  assert.equal(uploadDescription([{ id: "a", line: "Only this", startSec: 0 }], "  "), "Only this.");
  assert.equal(uploadDescription([], undefined), "");
  assert.equal(uploadDescription([], "Lena Park."), "Music: Lena Park.");
});

test("a handout uses the headline, the frame order, and a credit only with music", () => {
  const flick = {
    name: "Night walk",
    headline: "Best fails",
    musicCredit: "Lena Park",
    regions: [
      { trackId: "track-bottom", y: 0.5 },
      { trackId: "track-top", y: 0 },
    ],
    clips: [
      { id: "low", trackId: "track-bottom", line: "Gameplay", startSec: 0, mediaId: "game" },
      { id: "high", trackId: "track-top", line: "Face", startSec: 0, mediaId: "face" },
      { id: "file", trackId: "track-top", line: "face-clip", startSec: 4, mediaId: "face" },
    ],
  };
  const media = [
    { id: "face", name: "face-clip.mp4" },
    { id: "game", name: "game.mp4" },
  ];
  assert.deepEqual(uploadHandout(flick, media), {
    title: "Best fails",
    description: "Face. Gameplay.",
  });
  assert.deepEqual(uploadHandout({ ...flick, musicId: "song" }, media), {
    title: "Best fails",
    description: "Face. Gameplay. Music: Lena Park.",
  });
});

test("the upload note tells the kid to paste the words on YouTube", () => {
  assert.equal(
    UPLOAD_FILE_NOTE,
    "The video file is 1080x1920. Upload that file to YouTube and paste the title and description there.",
  );
});
