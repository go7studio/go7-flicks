import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexReply, connectionNote, isCliNoise, presentStatus } from "../src/shared/connection-note";
import { subscriptionRefusal, type ConnectionPublic, type VoiceOption } from "../src/shared/model";

export type ProviderTest = {
  ok: boolean;
  message: string;
  voices?: VoiceOption[];
  voiceId?: string;
};

export async function testProvider(connection: ConnectionPublic, key: string | null): Promise<ProviderTest> {
  const blocked = subscriptionRefusal(connection.baseUrl, connection.model);
  if (blocked) return { ok: false, message: blocked };
  if (connection.auth === "cli") return testCli(connection);
  if (!key) return { ok: false, message: "Add an API key first." };
  if (connection.kind === "elevenlabs") return testEleven(connection, key);
  if (connection.kind === "minimax") return testMiniMax(connection, key);
  if (connection.api === "anthropic-messages") return testAnthropic(connection, key, "Reply with the single word ok.");
  return testOpenAI(connection, key, "Reply with the single word ok.");
}

export async function writeLine(connection: ConnectionPublic, key: string | null, prompt: string): Promise<string> {
  const blocked = subscriptionRefusal(connection.baseUrl, connection.model);
  if (blocked) throw new Error(blocked);
  if (connection.auth === "cli") {
    const text = await runCli(connection, prompt);
    return cleanLine(text);
  }
  if (connection.kind === "elevenlabs" || connection.kind === "minimax") {
    throw new Error("ElevenLabs and MiniMax stay voice. Pick Claude, Codex, Grok, or Cursor.");
  }
  if (!key) throw new Error("Add an API key first.");
  if (connection.api === "anthropic-messages") {
    const result = await testAnthropic(connection, key, prompt);
    if (!result.ok || !result.message) throw new Error(result.message || "Claude returned nothing.");
    return cleanLine(result.message);
  }
  const result = await testOpenAI(connection, key, prompt);
  if (!result.ok) throw new Error(result.message);
  return cleanLine(result.message);
}

export async function askAssistant(connection: ConnectionPublic, key: string | null, prompt: string): Promise<string> {
  const blocked = subscriptionRefusal(connection.baseUrl, connection.model);
  if (blocked) throw new Error(blocked);
  if (connection.kind === "elevenlabs" || connection.kind === "minimax") {
    throw new Error("ElevenLabs and MiniMax stay voice. Pick Claude, Codex, Grok, or Cursor.");
  }
  if (connection.auth === "cli") return keepReply(await runCli(connection, prompt, 700));
  if (!key) throw new Error("Add an API key first.");
  if (connection.api === "anthropic-messages") {
    const result = await testAnthropic(connection, key, prompt, 700);
    if (!result.ok || !result.message) throw new Error(result.message || "The model returned nothing.");
    return keepReply(result.message);
  }
  const result = await testOpenAI(connection, key, prompt, 700, true);
  if (!result.ok) throw new Error(result.message);
  return keepReply(result.message);
}

export async function synthesize(connection: ConnectionPublic, key: string, text: string, dest: string): Promise<void> {
  if (!key) throw new Error("Add an API key first.");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (connection.kind === "elevenlabs") {
    const voice = connection.voiceId;
    if (!voice) throw new Error("Test the ElevenLabs connection so a voice can be chosen.");
    const response = await fetch(joinUrl(connection.baseUrl, `/v1/text-to-speech/${voice}`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": key,
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: connection.model || "eleven_multilingual_v2",
      }),
    });
    if (!response.ok) throw new Error(await errorText(response));
    fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (connection.kind === "minimax") {
    const response = await fetch(joinUrl(connection.baseUrl, "/t2a_v2"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "speech-02-turbo",
        text,
        stream: false,
        voice_setting: { voice_id: connection.voiceId || "English_expressive_narrator", speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      }),
    });
    const body = (await response.json()) as {
      data?: { audio?: string };
      base_resp?: { status_code?: number; status_msg?: string };
    };
    const audio = body.data?.audio;
    if (!response.ok || !audio) {
      throw new Error(body.base_resp?.status_msg || "MiniMax did not return audio.");
    }
    fs.writeFileSync(dest, Buffer.from(audio, "hex"));
    return;
  }
  throw new Error("Pick an ElevenLabs or MiniMax connection for voice.");
}

const CLAUDE_HELPER = "/Users/venomspike/.local/bin/anthropic-call";

async function testCli(connection: ConnectionPublic): Promise<ProviderTest> {
  const bin = cliBinary(connection.kind);
  if (!bin && !(connection.kind === "claude" && fs.existsSync(CLAUDE_HELPER))) {
    return { ok: false, message: missingCli(connection.kind) };
  }
  try {
    const text = cleanLine(await runCli(connection, "Reply with the single word ok."));
    const refused = loginMessage(connection.kind, text);
    if (refused) return { ok: false, message: refused };
    return { ok: text.length > 0, message: text.slice(0, 180) || "The program returned nothing." };
  } catch (error) {
    const detail = presentStatus(commandText(error));
    return { ok: false, message: (loginMessage(connection.kind, detail) || detail).slice(0, 400) || "The program call failed." };
  }
}

async function runCli(connection: ConnectionPublic, prompt: string, maxTokens = 80): Promise<string> {
  const claude = connection.kind === "claude";
  if (claude && fs.existsSync(CLAUDE_HELPER)) {
    const result = await startCli(
      CLAUDE_HELPER,
      ["--account", "auto", "--model", "haiku", "--effort", "low", "--max-tokens", String(maxTokens), "--cache", "none", "--", prompt],
      process.cwd(),
      90000,
    );
    if (result.code !== 0) throw commandFailure(result);
    return result.stdout.trim();
  }
  const bin = cliBinary(connection.kind);
  if (!bin) throw new Error(missingCli(connection.kind));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "go7-line-"));
  try {
    if (connection.kind === "grok") {
      return await runCommand(
        bin,
        [
          "-p",
          prompt,
          "-m",
          connection.model.trim() || "grok-4.7",
          "--max-turns",
          "1",
          "--output-format",
          "plain",
          "--no-plan",
          "--cwd",
          scratch,
          "--disallowed-tools",
          "web_search,web_fetch,write,search_replace,run_terminal_cmd,Bash,Agent,read_file,grep,list_dir",
        ],
        scratch,
      );
    }
    if (connection.kind === "cursor") {
      const args = ["-p", "--mode", "ask", "--output-format", "text", "--trust", "--workspace", scratch];
      if (connection.model.trim()) args.push("--model", connection.model.trim());
      args.push(prompt);
      return await runCommand(bin, args, scratch);
    }
    if (!claude) {
      const lastMessage = path.join(scratch, "last-message.txt");
      const result = await startCli(bin, codexExecArgs(connection.model, lastMessage, prompt), scratch, 120000);
      if (result.code !== 0) throw commandFailure(result);
      const written = fs.existsSync(lastMessage) ? fs.readFileSync(lastMessage, "utf8").trim() : "";
      if (written) return written;
      const parsed = codexReply(`${result.stdout}\n${result.stderr}`);
      if (parsed) return parsed;
      throw new Error("Codex returned nothing.");
    }
    return await runCommand(bin, ["-p", prompt], scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function codexExecArgs(model: string, lastMessagePath: string, prompt: string): string[] {
  return [
    "exec",
    "--color",
    "never",
    "--model",
    model.trim() || "gpt-5.6-terra",
    "--skip-git-repo-check",
    "-c",
    "model_reasoning_effort=low",
    "-o",
    lastMessagePath,
    prompt,
  ];
}

function cliBinary(kind: string): string | null {
  if (kind === "claude") return findBin("claude");
  if (kind === "codex") return findBin("codex");
  if (kind === "grok") return findBin("grok");
  if (kind === "cursor") return findBin("cursor-agent");
  return null;
}

function missingCli(kind: string): string {
  if (kind === "grok") return "Grok is not on this computer. Paste an xAI API key instead.";
  if (kind === "cursor") {
    return "Cursor's agent is not installed. This app does not store a Cursor key. Install cursor-agent and log in.";
  }
  if (kind === "claude") return "Claude Code is not on PATH. Paste an API key instead, or install the CLI and log in.";
  return "Codex is not on PATH. Paste an API key instead, or install the CLI and log in.";
}

function loginMessage(kind: string, text: string): string | null {
  const note = connectionNote(kind, text);
  const plain = presentStatus(text);
  if (!note || note === plain) return null;
  return note;
}

export function startCli(
  file: string,
  args: string[],
  cwd: string,
  timeout = 120000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  let command = file;
  let commandArgs = args;
  let windowsVerbatimArguments = false;
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    command = process.env.ComSpec || "cmd.exe";
    commandArgs = ["/d", "/s", "/c", winCommand(file, args)];
    windowsVerbatimArguments = true;
  } else if (process.platform === "win32" && /\.ps1$/i.test(file)) {
    command = "powershell.exe";
    commandArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args];
  }
  return collectSpawn(command, commandArgs, { cwd, timeout, windowsVerbatimArguments });
}

async function runCommand(file: string, args: string[], cwd: string): Promise<string> {
  try {
    const result = await startCli(file, args, cwd, 120000);
    if (result.code !== 0) throw commandFailure(result);
    return `${result.stdout}\n${result.stderr}`.trim();
  } catch (error) {
    throw new Error(commandText(error));
  }
}

function commandFailure(result: { stdout: string; stderr: string }): Error & { stdout: string; stderr: string } {
  const error = new Error("Command failed.") as Error & { stdout: string; stderr: string };
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  return error;
}

function collectSpawn(
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; windowsVerbatimArguments: boolean },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const stdio = ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"];
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
      stdio,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;
    const max = 1_000_000;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(Object.assign(new Error("The program timed out."), { stdout: "", stderr: "" })));
    }, options.timeout);
    child.stdout?.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > max) {
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > max) {
        child.kill();
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() =>
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          code,
        }),
      );
    });
  });
}

/** One cmd.exe /c string. A newline would end the command, so a prompt stays one argument. */
export function winCommand(file: string, args: string[]): string {
  const parts = [file, ...args].map((part) => quoteCmdArg(part.replace(/\r?\n/g, " ")));
  return `"${parts.join(" ")}"`;
}

function quoteCmdArg(part: string): string {
  if (!part) return '""';
  if (!/[\s"&|<>^]/.test(part)) return part;
  return `"${part.replaceAll('"', '""')}"`;
}

function commandText(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { message?: string; stderr?: string; stdout?: string };
    const detail = presentStatus(`${err.stderr ?? ""}\n${err.stdout ?? ""}`);
    if (detail) return detail.slice(0, 500);
    if (err.message) return presentStatus(err.message) || err.message;
  }
  return "The program call failed.";
}

async function testAnthropic(connection: ConnectionPublic, key: string, prompt: string, maxTokens = 200): Promise<ProviderTest> {
  const response = await fetch(joinUrl(connection.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: connection.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    content?: { text?: string }[];
    error?: { message?: string };
  } | null;
  if (!response.ok) return { ok: false, message: body?.error?.message || `Claude returned ${response.status}.` };
  const text = (body?.content ?? []).map((part) => part.text ?? "").join("").trim();
  return { ok: text.length > 0, message: text || "Claude returned nothing." };
}

async function testOpenAI(
  connection: ConnectionPublic,
  key: string,
  prompt: string,
  maxTokens = 200,
  keep = false,
): Promise<ProviderTest> {
  const response = await fetch(joinUrl(connection.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: connection.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
    base_resp?: { status_msg?: string };
  } | null;
  if (!response.ok) {
    return { ok: false, message: body?.error?.message || body?.base_resp?.status_msg || `The host returned ${response.status}.` };
  }
  const raw = body?.choices?.[0]?.message?.content ?? "";
  const text = keep ? keepReply(raw) : cleanLine(raw);
  return { ok: text.length > 0, message: text || "The host returned nothing." };
}

type MiniMaxVoiceBody = {
  system_voice?: { voice_id?: string; voice_name?: string }[];
  voice_cloning?: { voice_id?: string; voice_name?: string }[];
  voice_generation?: { voice_id?: string; voice_name?: string }[];
  base_resp?: { status_code?: number; status_msg?: string };
};

/** Voice list from POST /v1/get_voice. No audio is generated. */
export function readMiniMaxVoices(body: MiniMaxVoiceBody | null, preferredVoiceId: string): ProviderTest {
  const code = body?.base_resp?.status_code;
  if (!body || (typeof code === "number" && code !== 0)) {
    const detail = body?.base_resp?.status_msg || "MiniMax rejected the key.";
    const message = typeof code === "number" && code !== 0 && !detail.includes(String(code)) ? `${detail} (${code})` : detail;
    return { ok: false, message };
  }
  const voices = [body.system_voice, body.voice_cloning, body.voice_generation]
    .flatMap((group) => group ?? [])
    .filter((voice) => voice.voice_id)
    .slice(0, 40)
    .map((voice) => ({ id: voice.voice_id as string, name: voice.voice_name || (voice.voice_id as string) }));
  if (!voices.length) return { ok: false, message: "MiniMax returned no voices." };
  const voiceId = voices.some((voice) => voice.id === preferredVoiceId) ? preferredVoiceId : voices[0].id;
  return { ok: true, message: `Found ${voices.length} voices.`, voices, voiceId };
}

async function testMiniMax(connection: ConnectionPublic, key: string): Promise<ProviderTest> {
  const response = await fetch(joinUrl(connection.baseUrl, "/v1/get_voice"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ voice_type: "system" }),
  });
  const body = (await response.json().catch(() => null)) as MiniMaxVoiceBody | null;
  if (!response.ok && !body?.base_resp) return { ok: false, message: `MiniMax returned ${response.status}.` };
  return readMiniMaxVoices(body, connection.voiceId || "English_expressive_narrator");
}

async function testEleven(connection: ConnectionPublic, key: string): Promise<ProviderTest> {
  const response = await fetch(joinUrl(connection.baseUrl, "/v1/voices"), {
    headers: { "xi-api-key": key },
  });
  const body = (await response.json().catch(() => null)) as {
    voices?: { voice_id?: string; name?: string }[];
    detail?: { message?: string };
  } | null;
  if (!response.ok) return { ok: false, message: body?.detail?.message || `ElevenLabs returned ${response.status}.` };
  const voices = (body?.voices ?? [])
    .filter((voice) => voice.voice_id && voice.name)
    .slice(0, 40)
    .map((voice) => ({ id: voice.voice_id as string, name: voice.name as string }));
  if (!voices.length) return { ok: false, message: "ElevenLabs returned no voices." };
  return {
    ok: true,
    message: `Found ${voices.length} voices.`,
    voices,
    voiceId: connection.voiceId || voices[0].id,
  };
}

function findBin(name: string): string | null {
  const home = os.homedir();
  const extra = [
    path.join(home, ".grok", "bin"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "cursor-agent") : "",
  ];
  const dirs = [
    ...extra,
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(path.delimiter),
  ];
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".ps1"] : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const file = path.join(dir, `${name}${suffix}`);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

function joinUrl(base: string, suffix: string): string {
  const root = base.replace(/\/$/, "");
  const pathPart = suffix.startsWith("/") ? suffix : `/${suffix}`;
  if (root.endsWith("/v1") && pathPart.startsWith("/v1/")) return root + pathPart.slice(3);
  return root + pathPart;
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 400) || `Request failed (${response.status}).`;
}

function keepReply(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split(/\r?\n/)
    .filter((line) => !isCliNoise(line))
    .join("\n")
    .trim();
}

function cleanLine(text: string): string {
  const spoken = text.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  return spoken
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCliNoise(line))
    .join(" ")
    .replace(/^["']|["']$/g, "")
    .trim();
}
