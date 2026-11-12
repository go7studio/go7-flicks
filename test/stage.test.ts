import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { isNetworkPath, setDriveTypeReader, setFileCopier, stageSource, stagedPathIfReady } from "../electron/stage";

afterEach(() => {
  setDriveTypeReader(null);
  setFileCopier(null);
});

test("a UNC path is a network path and a fixed drive is not", () => {
  let calls = 0;
  setDriveTypeReader((letter) => {
    calls += 1;
    return letter === "K" ? "K: - Remote/Network Drive" : "D: - Fixed Drive";
  });
  assert.equal(isNetworkPath("\\\\192.168.1.177\\share\\clip.mp4"), true);
  assert.equal(isNetworkPath("//192.168.1.177/share/clip.mp4"), true);
  assert.equal(isNetworkPath("K:\\Phone\\clip.mp4"), true);
  assert.equal(isNetworkPath("K:/Phone/again.mp4"), true);
  assert.equal(isNetworkPath("D:\\GitHub\\clip.mp4"), false);
  assert.equal(calls, 2);
});

test("a file on a fixed drive is not copied", async () => {
  setDriveTypeReader(() => "Fixed Drive");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-stage-"));
  const source = path.join(root, "local.mp4");
  fs.writeFileSync(source, "local-bytes");
  const staging = path.join(root, "staging");
  const result = await stageSource(source, staging);
  assert.equal(result, path.resolve(source));
  assert.equal(fs.existsSync(staging), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a forced network path is copied once and then reused", async () => {
  setDriveTypeReader(() => "Network Drive");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-stage-"));
  const source = path.join(root, "clip.mp4");
  fs.writeFileSync(source, "network-bytes");
  const staging = path.join(root, "staging");
  let copies = 0;
  setFileCopier(async (from, to) => {
    copies += 1;
    await fs.promises.copyFile(from, to);
  });
  const staged = await stageSource(source, staging);
  assert.notEqual(path.resolve(staged), path.resolve(source));
  assert.equal(fs.readFileSync(staged, "utf8"), "network-bytes");
  assert.equal(fs.statSync(staged).size, fs.statSync(source).size);
  assert.equal(stagedPathIfReady(source, staging), staged);
  const again = await stageSource(source, staging);
  assert.equal(again, staged);
  assert.equal(copies, 1);
  assert.equal(fs.readdirSync(staging).some((name) => name.endsWith(".partial")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("two callers share one copy", async () => {
  setDriveTypeReader(() => "Network Drive");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-stage-"));
  const source = path.join(root, "clip.mp4");
  fs.writeFileSync(source, "shared-bytes");
  const staging = path.join(root, "staging");
  let copies = 0;
  setFileCopier(async (from, to) => {
    copies += 1;
    await new Promise((resolve) => setTimeout(resolve, 40));
    await fs.promises.copyFile(from, to);
  });
  const [first, second] = await Promise.all([stageSource(source, staging), stageSource(source, staging)]);
  assert.equal(first, second);
  assert.equal(copies, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a changed network file is copied again", async () => {
  setDriveTypeReader(() => "Network Drive");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "go7-stage-"));
  const source = path.join(root, "clip.mp4");
  fs.writeFileSync(source, "one");
  const staging = path.join(root, "staging");
  const first = await stageSource(source, staging);
  fs.writeFileSync(source, "two-two");
  const second = await stageSource(source, staging);
  assert.notEqual(first, second);
  assert.equal(fs.readFileSync(second, "utf8"), "two-two");
  assert.equal(fs.readFileSync(first, "utf8"), "one");
  fs.rmSync(root, { recursive: true, force: true });
});
