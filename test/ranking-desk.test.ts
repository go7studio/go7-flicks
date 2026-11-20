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
  assert.match(ranking, /Type a topic\. This finds up to three short clips\./);
  assert.match(which, /This looks at the clips already here and asks the account you connected\./);
  assert.match(ranking, /Saves this order and these words\. The video files stay off it\./);
  assert.match(ranking, /Paste a link or upload a file\./);
  assert.match(ranking, /Add link/);
  assert.match(ranking, /Upload a file/);
  assert.match(ranking, /downloadMedia\(folder, url, SHORT_CLIP_SEC\)/);
  assert.equal(ranking.includes("Choose a clip"), false);
  assert.equal((ranking.match(/importMedia/g) ?? []).length, 1);
  assert.match(ranking, /Add another slot/);
  assert.match(ranking, /Starts over\. Rankings you already saved stay in this channel\./);
  assert.equal(ranking.includes("Add a clip"), false);
  assert.equal(ranking.includes("Empty slot"), false);
  assert.equal((ranking.match(/<video/g) ?? []).length, 2);
});

test("the ranking clips handle grows when it is dragged up", () => {
  const ranking = read("../src/ui/RankingStudio.tsx");
  const css = read("../src/ui/polish-desks.css");
  assert.match(ranking, /go7-ranking-clips/);
  assert.match(ranking, /start - \(ev\.clientY - originY\)/);
  assert.match(ranking, /Clips list height/);
  assert.match(css, /\.clip-rail \.rank-clips/);
  assert.match(css, /min-height: 176px/);
});
