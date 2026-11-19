import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { synthesize, testProvider } from "../electron/providers";
import type { ConnectionPublic } from "../src/shared/model";

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf("=");
    if (split < 1) continue;
    values[trimmed.slice(0, split).trim()] = trimmed.slice(split + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function safe(message: string): string {
  return message.replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]").slice(0, 140);
}

function row(partial: Partial<ConnectionPublic> & Pick<ConnectionPublic, "kind" | "auth" | "baseUrl" | "model" | "api">): ConnectionPublic {
  return {
    id: "probe",
    name: partial.kind,
    connected: false,
    voiceId: "",
    voices: [],
    hasCredential: true,
    statusNote: "",
    ...partial,
  };
}

const secrets = path.join(os.homedir(), ".openclaw", "workspace", "secrets");
const elevenKey = readEnvFile(path.join(secrets, "elevenlabs.env")).ELEVENLABS_API_KEY;
const mini = readEnvFile(path.join(secrets, "minimax.env"));

const eleven = await testProvider(
  row({
    kind: "elevenlabs",
    auth: "key",
    baseUrl: "https://api.elevenlabs.io",
    model: "eleven_multilingual_v2",
    api: "openai-completions",
  }),
  elevenKey || null,
);
console.log(`elevenlabs ${eleven.ok ? "ok" : "failed"} ${safe(eleven.message)} voices=${eleven.voices?.length ?? 0}`);
if (eleven.ok && eleven.voiceId && elevenKey) {
  const dest = "/tmp/go7-voice-probe.mp3";
  await synthesize(
    row({
      kind: "elevenlabs",
      auth: "key",
      baseUrl: "https://api.elevenlabs.io",
      model: "eleven_multilingual_v2",
      api: "openai-completions",
      voiceId: eleven.voiceId,
    }),
    elevenKey,
    "ok",
    dest,
  );
  const size = fs.statSync(dest).size;
  fs.rmSync(dest);
  console.log(`elevenlabs voice bytes=${size}`);
}

const minimax = await testProvider(
  row({
    kind: "minimax",
    auth: "key",
    baseUrl: mini.MINIMAX_ENDPOINT ? new URL(mini.MINIMAX_ENDPOINT).origin + "/v1" : "https://api.minimax.io/v1",
    model: mini.MINIMAX_MODEL || "MiniMax-M3",
    api: "openai-completions",
  }),
  mini.MINIMAX_API_KEY || null,
);
console.log(`minimax ${minimax.ok ? "ok" : "failed"} ${safe(minimax.message)}`);

const claude = await testProvider(
  row({
    kind: "claude",
    auth: "cli",
    baseUrl: "https://api.anthropic.com",
    model: "claude-haiku-4-5",
    api: "anthropic-messages",
  }),
  null,
);
console.log(`claude ${claude.ok ? "ok" : "failed"} ${safe(claude.message)}`);
