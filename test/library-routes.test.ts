import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

type FlickJson = {
  id: string;
  name: string;
  clips: { id: string; mediaId: string | null }[];
  voiceStartSec?: number;
};

type LibraryApi = {
  createChannel(parent: string, name: string): { dir: string };
  recentChannels(): { path: string; name: string }[];
  forgetRecent(dir: string): void;
  createFlick(dir: string, name: string, templateId: string): FlickJson;
  readFlick(dir: string, flickId: string): FlickJson;
  saveFlick(dir: string, flick: FlickJson): FlickJson;
  duplicateFlick(dir: string, flickId: string): FlickJson;
  deleteFlick(dir: string, flickId: string): void;
  removeMedia(dir: string, mediaId: string): void;
  readChannel(dir: string): { media: { id: string }[]; flicks: { id: string; name: string }[] };
};

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "go7-user-"));
const mockFile = path.join(userData, "electron-mock.mjs");
fs.writeFileSync(
  mockFile,
  `export const app = { getPath() { return ${JSON.stringify(userData)}; } };
export const safeStorage = {
  isEncryptionAvailable() { return false; },
  encryptString() { return Buffer.from(""); },
  decryptString() { return ""; },
};
`,
);
const emptyCss = path.join(userData, "empty-css.mjs");
fs.writeFileSync(emptyCss, "export default {};\n");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: pathToFileURL(mockFile).href, shortCircuit: true };
    if (specifier.endsWith(".css")) return { url: pathToFileURL(emptyCss).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const stdinScript = `
const fs = require("node:fs");
let openPipe = false;
try {
  const stat = fs.fstatSync(0);
  const fifo = stat.isFIFO() || (stat.mode & 0o170000) === 0o10000;
  openPipe = fifo && !stat.isCharacterDevice() && !stat.isFile() && process.stdin.readable && !process.stdin.readableEnded;
} catch (error) {
  openPipe = false;
}
process.stdout.write(openPipe ? "pipe" : "closed");
process.exit(openPipe ? 1 : 0);
`;

after(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

test("forget recent leaves the folder and duplicate flick shares media", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "go7-lib-"));
  const mediaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const outsideId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  try {
    const lib = (await import(new URL("../electron/library.ts", import.meta.url).href)) as LibraryApi;
    const kept = lib.createChannel(parent, "Kept");
    const dropped = lib.createChannel(parent, "Dropped");
    assert.equal(lib.recentChannels().length, 2);
    lib.forgetRecent(dropped.dir);
    const recent = lib.recentChannels();
    assert.deepEqual(
      recent.map((item) => path.resolve(item.path)),
      [path.resolve(kept.dir)],
    );
    assert.equal(fs.existsSync(path.join(dropped.dir, "channel.json")), true);

    const flick = lib.createFlick(kept.dir, "Rank", "builtin-ranking");
    const inside = path.join(kept.dir, "media", `${mediaId}.mp4`);
    const outside = path.join(parent, "outside.mp4");
    fs.writeFileSync(inside, "picture");
    fs.writeFileSync(outside, "outside");
    const flickFile = path.join(kept.dir, "flicks", flick.id, "flick.json");
    const raw = JSON.parse(fs.readFileSync(flickFile, "utf8")) as FlickJson;
    raw.clips[0].mediaId = mediaId;
    raw.voiceStartSec = 1.25;
    fs.writeFileSync(flickFile, JSON.stringify(raw));
    const channelFile = path.join(kept.dir, "channel.json");
    const channel = JSON.parse(fs.readFileSync(channelFile, "utf8")) as {
      media: unknown[];
    };
    channel.media.push(
      {
        id: mediaId,
        name: "clip.mp4",
        relativePath: `media/${mediaId}.mp4`,
        durationSec: 1,
        width: 1080,
        height: 1920,
        codec: "h264",
      },
      {
        id: outsideId,
        name: "outside.mp4",
        absolutePath: outside,
        durationSec: 1,
        width: 1,
        height: 1,
        codec: "h264",
      },
    );
    fs.writeFileSync(channelFile, JSON.stringify(channel));

    const copy = lib.duplicateFlick(kept.dir, flick.id);
    assert.notEqual(copy.id, flick.id);
    assert.equal(copy.name, raw.name);
    assert.equal(copy.clips[0].mediaId, mediaId);
    assert.equal(copy.voiceStartSec, 1.25);
    assert.equal(fs.readdirSync(path.join(kept.dir, "media")).length, 1);
    const listed = lib.readChannel(kept.dir);
    assert.equal(listed.flicks.length, 2);
    assert.equal(listed.flicks.some((item) => item.id === copy.id && item.name === raw.name), true);
    const copyFile = path.join(kept.dir, "flicks", copy.id, "flick.json");
    const copied = JSON.parse(fs.readFileSync(copyFile, "utf8")) as FlickJson;
    assert.equal(copied.id, copy.id);
    assert.equal(copied.voiceStartSec, 1.25);
    assert.equal(copied.clips[0].mediaId, mediaId);
    assert.equal(JSON.parse(fs.readFileSync(flickFile, "utf8")).id, flick.id);

    const saved = lib.saveFlick(kept.dir, { ...lib.readFlick(kept.dir, flick.id), voiceStartSec: 2.5 });
    assert.equal(saved.voiceStartSec, 2.5);
    assert.equal(JSON.parse(fs.readFileSync(flickFile, "utf8")).voiceStartSec, 2.5);
    const droppedVoice = lib.saveFlick(kept.dir, { ...lib.readFlick(kept.dir, flick.id), voiceStartSec: Number.NaN });
    assert.equal(droppedVoice.voiceStartSec, undefined);
    assert.equal(JSON.parse(fs.readFileSync(flickFile, "utf8")).voiceStartSec, undefined);

    assert.throws(() => lib.removeMedia(kept.dir, mediaId), /A clip still uses that file/);
    assert.equal(fs.existsSync(inside), true);
    lib.removeMedia(kept.dir, outsideId);
    assert.equal(fs.existsSync(outside), true);
    assert.equal(lib.readChannel(kept.dir).media.some((item) => item.id === outsideId), false);

    for (const id of [flick.id, copy.id]) {
      const current = lib.readFlick(kept.dir, id);
      lib.saveFlick(kept.dir, {
        ...current,
        clips: current.clips.map((clip) => ({ ...clip, mediaId: null })),
      });
    }
    lib.removeMedia(kept.dir, mediaId);
    assert.equal(fs.existsSync(inside), false);
    assert.equal(lib.readChannel(kept.dir).media.some((item) => item.id === mediaId), false);

    lib.deleteFlick(kept.dir, copy.id);
    assert.equal(fs.existsSync(path.join(kept.dir, "flicks", copy.id)), false);
    assert.equal(fs.existsSync(flickFile), true);
    assert.equal(lib.readChannel(kept.dir).flicks.some((item) => item.id === copy.id), false);
    assert.equal(fs.existsSync(path.join(kept.dir, "channel.json")), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("cli spawn ignores stdin unless the parent holds a pipe", async () => {
  const { startCli } = (await import(new URL("../electron/providers.ts", import.meta.url).href)) as {
    startCli: (
      file: string,
      args: string[],
      cwd: string,
      timeout?: number,
    ) => Promise<{ stdout: string; stderr: string; code: number | null }>;
  };
  const ignored = await startCli(process.execPath, ["-e", stdinScript], os.tmpdir(), 15000);
  assert.equal(ignored.code, 0);
  assert.equal(ignored.stdout, "closed");

  const held = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", stdinScript], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("stdin pipe check hung"));
    }, 15000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      child.stdin?.destroy();
      resolve({ code, stdout });
    });
  });
  assert.notEqual(held.code, 0);
  assert.equal(held.stdout, "pipe");
});

test("removeMedia refuses a file the flick uses as music", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "go7-music-"));
  const musicId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  try {
    const lib = (await import(new URL("../electron/library.ts", import.meta.url).href)) as LibraryApi;
    const channel = lib.createChannel(parent, "Music");
    const flick = lib.createFlick(channel.dir, "Rank", "builtin-ranking");
    const musicFile = path.join(channel.dir, "media", `${musicId}.mp3`);
    fs.writeFileSync(musicFile, "tone");
    const channelFile = path.join(channel.dir, "channel.json");
    const stored = JSON.parse(fs.readFileSync(channelFile, "utf8")) as { media: unknown[] };
    stored.media.push({
      id: musicId,
      name: "tone.mp3",
      relativePath: `media/${musicId}.mp3`,
      durationSec: 1,
      width: 0,
      height: 0,
      codec: "mp3",
    });
    fs.writeFileSync(channelFile, JSON.stringify(stored));
    const flickFile = path.join(channel.dir, "flicks", flick.id, "flick.json");
    const flickJson = JSON.parse(fs.readFileSync(flickFile, "utf8")) as FlickJson & { musicId?: string };
    flickJson.musicId = musicId;
    flickJson.clips = flickJson.clips.map((clip) => ({ ...clip, mediaId: null }));
    fs.writeFileSync(flickFile, JSON.stringify(flickJson));
    assert.throws(() => lib.removeMedia(channel.dir, musicId), /A clip still uses that file/);
    assert.equal(fs.existsSync(musicFile), true);
    assert.equal(
      lib.readChannel(channel.dir).media.some((item) => item.id === musicId),
      true,
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("a failed forget keeps the recent card", async () => {
  const ui = (await import(new URL("../src/ui/HomeScreen.tsx", import.meta.url).href)) as {
    recentRowsAfterForget: <T extends { path: string }>(
      rows: readonly T[],
      dir: string,
      result: { ok?: boolean; message?: string } | null | undefined,
    ) => T[];
  };
  const rows = [{ path: "C:\\Kept" }, { path: "C:\\Other" }];
  assert.deepEqual(ui.recentRowsAfterForget(rows, "C:\\Kept", { ok: false, message: "no" }), rows);
  assert.deepEqual(ui.recentRowsAfterForget(rows, "C:\\Kept", undefined), rows);
  assert.deepEqual(ui.recentRowsAfterForget(rows, "C:\\Kept", { ok: true }), [{ path: "C:\\Other" }]);
});
