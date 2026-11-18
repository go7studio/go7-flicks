import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startCli, winCommand } from "../electron/providers";

test("a windows command keeps every sentence of a prompt", () => {
  const line = winCommand("C:\\Tools\\cursor-agent.cmd", ["-p", "First sentence.\nSecond sentence. id=c1 name=Dogs"]);
  assert.equal(line.includes("\n"), false);
  assert.match(line, /First sentence\. Second sentence\. id=c1 name=Dogs/);
});

test("a cmd launcher receives the sentences after the first", async () => {
  if (process.platform !== "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go7-cmd-"));
  const cmd = path.join(dir, "echo-args.cmd");
  fs.writeFileSync(cmd, "@echo off\r\necho %*\r\n", "utf8");
  try {
    const result = await startCli(cmd, ["-p", "First sentence.\nSecond sentence. id=c1"], dir, 15000);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /First sentence\. Second sentence\. id=c1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
