import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { builtinTemplates, flickFromTemplate } from "../src/shared/canvas";
import type { ChannelFile, Flick } from "../src/shared/model";

// Local create + save only. No network, no video files, no app user-data.
test("blank and ranking flicks create and save in a temp channel", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7flicks-perf-"));
  const dir = path.join(root, "Perf");
  try {
    const templates = builtinTemplates();
    const blankTemplate = templates.find((item) => item.id === "builtin-blank");
    const rankingTemplate = templates.find((item) => item.id === "builtin-ranking");
    assert.ok(blankTemplate);
    assert.ok(rankingTemplate);

    const createStart = performance.now();
    fs.mkdirSync(path.join(dir, "media"), { recursive: true });
    fs.mkdirSync(path.join(dir, "flicks"), { recursive: true });
    fs.mkdirSync(path.join(dir, "exports"), { recursive: true });
    const channel: ChannelFile = { version: 1, name: "Perf", accent: "#e2b340", media: [], flicks: [] };
    writeJson(path.join(dir, "channel.json"), channel);

    const blank = flickFromTemplate(blankTemplate, "Blank");
    const ranking = withHeadline(flickFromTemplate(rankingTemplate, "Ranking"));
    channel.flicks.unshift(
      { id: ranking.id, name: ranking.name, updatedAt: new Date().toISOString() },
      { id: blank.id, name: blank.name, updatedAt: new Date().toISOString() },
    );
    writeFlick(dir, blank);
    writeFlick(dir, ranking);
    writeJson(path.join(dir, "channel.json"), channel);
    const createMs = round1(performance.now() - createStart);

    const saveStart = performance.now();
    blank.name = "Blank saved";
    ranking.headline = "Ranking\nfunniest moments";
    writeFlick(dir, blank);
    writeFlick(dir, ranking);
    channel.flicks = channel.flicks.map((item) =>
      item.id === blank.id || item.id === ranking.id
        ? { ...item, name: item.id === blank.id ? blank.name : ranking.name, updatedAt: new Date().toISOString() }
        : item,
    );
    writeJson(path.join(dir, "channel.json"), channel);
    const saveMs = round1(performance.now() - saveStart);

    const savedBlank = JSON.parse(fs.readFileSync(path.join(dir, "flicks", blank.id, "flick.json"), "utf8")) as Flick;
    const savedRanking = JSON.parse(fs.readFileSync(path.join(dir, "flicks", ranking.id, "flick.json"), "utf8")) as Flick;
    assert.equal(savedBlank.clips.length, 0);
    assert.equal(savedBlank.templateId, "builtin-blank");
    assert.equal(savedRanking.clips.length, 6);
    assert.equal(savedRanking.clips.every((clip) => clip.mediaId === null), true);
    assert.equal(savedRanking.headline, "Ranking\nfunniest moments");
    assert.equal(channel.media.length, 0);
    assert.ok(createMs < 500, `create took ${createMs}ms`);
    assert.ok(saveMs < 500, `save took ${saveMs}ms`);
    console.log(
      JSON.stringify({
        createMs,
        saveMs,
        blankClips: savedBlank.clips.length,
        rankingClips: savedRanking.clips.length,
        dir: "temp",
      }),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function withHeadline(flick: Flick): Flick {
  return {
    ...flick,
    headline: "Ranking\nfunniest moments",
    headlineColor: "#ff3355",
    accentWords: "funniest",
    titleStroke: 6,
    showRank: true,
  };
}

function writeFlick(dir: string, flick: Flick): void {
  writeJson(path.join(dir, "flicks", flick.id, "flick.json"), flick);
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
