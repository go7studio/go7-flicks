import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fitRankingSlots, playbackSentence } from "../src/shared/desk";
import { SUBJECT_CLIP_COUNT } from "../src/shared/subject";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("a three clip search drops trailing empty ranks and keeps filled clips", () => {
  const slots = [5, 4, 3, 2, 1].map((rank, index) => ({
    id: String(rank),
    mediaId: index < 3 ? `clip-${rank}` : null,
    rank,
    keepEmpty: false,
  }));
  const fitted = fitRankingSlots(slots);
  assert.deepEqual(
    fitted.map((item) => item.rank),
    [3, 2, 1],
  );
  assert.deepEqual(
    fitted.map((item) => item.mediaId),
    ["clip-5", "clip-4", "clip-3"],
  );
  const five = [5, 4, 3, 2, 1].map((rank) => ({ mediaId: `clip-${rank}`, rank }));
  assert.equal(fitRankingSlots(five), five);
  const hole = fitRankingSlots([
    { mediaId: "a", rank: 4 },
    { mediaId: null, rank: 3 },
    { mediaId: "b", rank: 2 },
    { mediaId: null, rank: 1 },
  ]);
  assert.deepEqual(
    hole.map((item) => item.mediaId),
    ["a", null, "b"],
  );
  assert.deepEqual(
    hole.map((item) => item.rank),
    [3, 2, 1],
  );
  const asked = [
    { mediaId: "a", rank: 2 },
    { mediaId: "b", rank: 1 },
    { mediaId: null, rank: 0, keepEmpty: true },
  ];
  assert.equal(fitRankingSlots(asked), asked);
  const searched = fitRankingSlots(asked, false);
  assert.deepEqual(
    searched.map((item) => item.mediaId),
    ["a", "b"],
  );
});

test("skip around names the ranks a person will hear", () => {
  const five = [5, 4, 3, 2, 1].map((rank, index) => ({
    id: String(rank),
    rank,
    previewUrl: index < 3 ? "ready" : null,
  }));
  assert.equal(playbackSentence("skip", five), "Plays #5, then #4, then #3.");
  const three = [3, 2, 1].map((rank) => ({ id: String(rank), rank, previewUrl: "ready" }));
  assert.equal(playbackSentence("skip", three), "Plays #1, then #3, then #2.");
  assert.equal(playbackSentence("countdown", three), "Plays the highest rank first: #3, then #2, then #1.");
  assert.equal(playbackSentence("listed", three), "Plays from the top of the list: #3, then #2, then #1.");
  const shuffled = playbackSentence("shuffle", three, ["1", "3", "2"]);
  assert.equal(shuffled, "Plays #1, then #3, then #2, and the rank numbers stay.");
  assert.equal(shuffled.split(".").length, 2);
});

test("the ranking desk says what find clips and which clip do", () => {
  const ranking = read("../src/ui/RankingStudio.tsx");
  const which = read("../src/ui/WhichClip.tsx");
  assert.equal(SUBJECT_CLIP_COUNT, 3);
  assert.match(ranking, /This searches for the subject you typed and fills empty slots with up to three short clips, and it does not use Cursor or Codex\./);
  assert.match(which, /This reads the clips already on the desk and answers through Cursor or Codex\./);
  assert.match(ranking, /Keeps this order and these words, and leaves the clips off the template\./);
  assert.match(ranking, /Add a clip/);
  assert.equal(ranking.includes("Empty slot"), false);
  assert.equal((ranking.match(/<video/g) ?? []).length, 2);
});
