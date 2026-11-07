import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ConnectionPublic, VoiceOption } from "../src/shared/model";

const exec = promisify(execFile);

export type ProviderTest = {
  ok: boolean;
  message: string;
  voices?: VoiceOption[];
  voiceId?: string;
};

export async function testProvider(connection: ConnectionPublic, key: string | null): Promise<ProviderTest> {
  if (connection.auth === "cli") return testCli(connection);
  if (!key) return { ok: false, message: "Add an API key first." };
  if (connection.kind === "elevenlabs") return testEleven(connection, key);
  if (connection.api === "anthropic-messages") return testAnthropic(connection, key, "Reply with the single word ok.");
  return testOpenAI(connection, key, "Reply with the single word ok.");
}

export async function writeLine(connection: ConnectionPublic, key: string | null, prompt: string): Promise<string> {
  if (connection.auth === "cli") {
    const text = await runCli(connection, prompt);
    return cleanLine(text);
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
  if (connection.kind === "claude" && fs.existsSync(CLAUDE_HELPER)) {
    try {
      const text = await runCli(connection, "Reply with the single word ok.");
      return { ok: text.trim().length > 0, message: cleanLine(text).slice(0, 180) || "The CLI returned nothing." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "The Claude helper call failed." };
    }
  }
  const bin = findBin(connection.kind === "claude" ? "claude" : "codex");
  if (!bin) {
    return {
      ok: false,
      message: `${connection.kind === "claude" ? "Claude Code" : "Codex"} is not on PATH. Paste an API key instead, or install the CLI and log in.`,
    };
  }
  try {
    const text = await runCli(connection, "Reply with the single word ok.");
    return { ok: text.trim().length > 0, message: cleanLine(text).slice(0, 180) || "The CLI returned nothing." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The CLI call failed." };
  }
}

async function runCli(connection: ConnectionPublic, prompt: string): Promise<string> {
  const claude = connection.kind === "claude";
  if (claude && fs.existsSync(CLAUDE_HELPER)) {
    const result = await exec(
      CLAUDE_HELPER,
      ["--account", "auto", "--model", "haiku", "--effort", "low", "--max-tokens", "80", "--cache", "none", "--", prompt],
      { timeout: 90000, encoding: "utf8", maxBuffer: 1_000_000 },
    );
    return (result.stdout ?? "").trim();
  }
  const bin = findBin(claude ? "claude" : "codex");
  if (!bin) throw new Error(claude ? "Claude Code is not installed." : "Codex is not installed.");
  const args = claude ? ["-p", prompt] : ["exec", "--skip-git-repo-check", prompt];
  const result = await exec(bin, args, { timeout: 90000, encoding: "utf8", maxBuffer: 1_000_000 });
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

async function testAnthropic(connection: ConnectionPublic, key: string, prompt: string): Promise<ProviderTest> {
  const response = await fetch(joinUrl(connection.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: connection.model,
      max_tokens: 200,
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

async function testOpenAI(connection: ConnectionPublic, key: string, prompt: string): Promise<ProviderTest> {
  const response = await fetch(joinUrl(connection.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: connection.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
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
  const text = body?.choices?.[0]?.message?.content?.trim() ?? "";
  return { ok: text.length > 0, message: text || "The host returned nothing." };
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
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const tool = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(tool, [name], { encoding: "utf8" });
    const file = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return file || null;
  } catch {
    return null;
  }
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

function cleanLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("warning:"))
    .join(" ")
    .replace(/^["']|["']$/g, "")
    .trim();
}
