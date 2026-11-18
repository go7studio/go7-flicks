import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexExecArgs, startCli, winCommand } from "../electron/providers";

test("codex exec writes the last message beside the prompt", () => {
  const args = codexExecArgs("gpt-5.6-terra", "C:\\Temp\\last.txt", "Reply with the single word ok.");
  assert.deepEqual(args.slice(0, 10), [
    "exec",
    "--color",
    "never",
    "--model",
    "gpt-5.6-terra",
    "--skip-git-repo-check",
    "-c",
    "model_reasoning_effort=low",
    "-o",
    "C:\\Temp\\last.txt",
  ]);
  assert.equal(args.at(-1), "Reply with the single word ok.");
});

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
