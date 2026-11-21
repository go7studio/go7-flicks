import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ranking = readFileSync(fileURLToPath(new URL("../src/ui/RankingStudio.tsx", import.meta.url)), "utf8");

test("empty phone line stays clear of the rank shield for every place", () => {
  assert.match(ranking, /function emptyLineStyle\(place: OverlayPlace\)/);
  assert.match(ranking, /place === "middle"/);
  assert.match(ranking, /paddingBottom: "36%"/);
  assert.match(ranking, /place === "top"/);
  assert.match(ranking, /paddingTop: "20%"/);
  assert.match(ranking, /className="phone-empty" style=\{emptyLineStyle\(rankPlace\)\}/);
  assert.match(ranking, /Paste a link or upload a file\./);
});

test("play and find notes clear themselves like flashNote", () => {
  assert.match(ranking, /function flashMessage\(text: string\)/);
  assert.match(ranking, /setTimeout\(\(\) => setMessageState\(""\), 3400\)/);
  assert.match(ranking, /flashMessage\("Name a subject\."\)/);
  assert.match(ranking, /flashMessage\([\s\S]*This rank has no clip\./);
  assert.match(ranking, /flashMessage\("Choose at least one clip\."\)/);
  assert.match(ranking, /flashMessage\("The clips already here stay\."\)/);
  assert.match(ranking, /flashMessage\("Started over\. Rankings you already saved stay in this channel\."\)/);
  assert.match(ranking, /flashMessage\("Paste one caption per clip\."\)/);
  assert.match(ranking, /flashMessage\("Every rank already has a clip\."\)/);
  assert.match(ranking, /flashNote\(text: string\)/);
  assert.match(ranking, /setTimeout\(\(\) => setAddNote\(""\), 3400\)/);
  assert.match(ranking, /style=\{\{ pointerEvents: "none" \}\}/);
  assert.match(ranking, /className="banner"/);
  assert.equal(ranking.includes('setMessage("Choose at least one clip.")'), false);
  assert.equal(ranking.includes('setMessage("Started over. Rankings you already saved stay in this channel.")'), false);
});

test("the main show-rank switch names itself for assistive tech", () => {
  assert.match(
    ranking,
    /aria-checked=\{showRank\}\s*aria-label="Show the rank number"/,
  );
  assert.match(ranking, /<span>Show the rank number<\/span>/);
});

test("phone headline and caption focus the matching fields", () => {
  assert.match(ranking, /onClick=\{focusHeadlineField\}/);
  assert.match(ranking, /onClick=\{focusCaptionField\}/);
  assert.match(ranking, /headlineRef\.current\?\.focus\(\)/);
  assert.match(ranking, /captionRef\.current\?\.focus\(\)/);
  assert.match(ranking, /ref=\{headlineRef\}/);
  assert.match(ranking, /ref=\{captionRef\}/);
  assert.equal(ranking.includes("invent a second editor"), false);
  assert.equal(ranking.includes('aria-label="Caption line"'), false);
  assert.equal((ranking.match(/aria-label="Caption"/g) ?? []).length, 1);
});

test("rank words in the list focus the same caption field", () => {
  assert.match(ranking, /closest\("\.slot-name"\)/);
  assert.match(ranking, /if \(named && \(item\.title\.trim\(\) \|\| item\.mediaId\)\) focusCaptionField\(event\)/);
  assert.match(ranking, /style=\{item\.title\.trim\(\) \|\| item\.mediaId \? \{ cursor: "text" \} : undefined\}/);
});

test("Look and More start closed and this window remembers them", () => {
  assert.match(ranking, /const RANK_SECTIONS_KEY = "go7-ranking-sections"/);
  assert.match(ranking, /function readRankSections\(\): \{ look: boolean; more: boolean \}/);
  assert.match(ranking, /return \{ look: false, more: false \}/);
  assert.match(ranking, /look: parsed\.look === true, more: parsed\.more === true/);
  assert.match(ranking, /function rememberRankSections\(next: \{ look: boolean; more: boolean \}\)/);
  assert.match(ranking, /const \[sectionMemory\] = useState\(\(\) => readRankSections\(\)\)/);
  assert.match(ranking, /const \[more, setMore\] = useState\(sectionMemory\.more\)/);
  assert.match(ranking, /const \[look, setLook\] = useState\(sectionMemory\.look\)/);
  assert.match(ranking, /rememberRankSections\(\{ look, more \}\)/);
  assert.match(ranking, /aria-controls="ranking-look"/);
  assert.match(ranking, /aria-controls="ranking-more"/);
  assert.match(ranking, /id="ranking-look"/);
  assert.match(ranking, /id="ranking-more"/);
  assert.match(ranking, /\{look \? "▾" : "▸"\}/);
  assert.match(ranking, /\{more \? "▾" : "▸"\}/);
  const lookAt = ranking.search(/>\s*Look\s*<span aria-hidden="true">\{look \? "▾" : "▸"\}/);
  const moreAt = ranking.search(/>\s*More\s*<span aria-hidden="true">\{more \? "▾" : "▸"\}/);
  assert.equal(lookAt >= 0 && moreAt > lookAt, true);
});
