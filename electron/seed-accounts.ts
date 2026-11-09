import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listConnections, saveConnection } from "./library";
import { defaultsFor, type ConnectionKind } from "../src/shared/model";

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf("=");
    if (split < 1) continue;
    const key = trimmed.slice(0, split).trim();
    const value = trimmed.slice(split + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value) values[key] = value;
  }
  return values;
}

function minimaxBase(endpoint: string | undefined): string {
  const fallback = defaultsFor("minimax").baseUrl;
  if (!endpoint) return fallback;
  try {
    const url = new URL(endpoint);
    return `${url.origin}/v1`;
  } catch {
    return fallback;
  }
}

function remember(kind: ConnectionKind, apiKey: string, extra?: { baseUrl?: string; model?: string; auth?: "cli" | "key" }): void {
  const defaults = defaultsFor(kind);
  saveConnection({
    kind,
    name: defaults.name,
    auth: extra?.auth ?? defaults.auth,
    baseUrl: extra?.baseUrl || defaults.baseUrl,
    model: extra?.model || defaults.model,
    api: defaults.api,
    voiceId: defaults.voiceId,
    apiKey: extra?.auth === "cli" ? undefined : apiKey,
  });
}

export function seedMachineAccounts(): string[] {
  const home = os.homedir();
  const secrets = path.join(home, ".openclaw", "workspace", "secrets");
  const eleven = process.env.ELEVENLABS_API_KEY || readEnvFile(path.join(secrets, "elevenlabs.env")).ELEVENLABS_API_KEY;
  const miniFile = readEnvFile(path.join(secrets, "minimax.env"));
  const mini = process.env.MINIMAX_API_KEY || miniFile.MINIMAX_API_KEY;
  const rows = listConnections();
  const added: string[] = [];
  if (eleven && !rows.some((row) => row.kind === "elevenlabs")) {
    remember("elevenlabs", eleven);
    added.push("elevenlabs");
  }
  const savedMini = rows.find((row) => row.kind === "minimax");
  if (mini && !savedMini) {
    remember("minimax", mini, {
      baseUrl: minimaxBase(miniFile.MINIMAX_ENDPOINT),
      model: miniFile.MINIMAX_MODEL || defaultsFor("minimax").model,
    });
    added.push("minimax");
  } else if (savedMini && savedMini.baseUrl.includes("/chat/completions")) {
    saveConnection({
      id: savedMini.id,
      kind: "minimax",
      name: savedMini.name,
      auth: "key",
      baseUrl: minimaxBase(savedMini.baseUrl),
      model: savedMini.model,
      api: savedMini.api,
      voiceId: savedMini.voiceId,
    });
    added.push("minimax-url");
  }
  if (!rows.some((row) => row.kind === "claude")) {
    remember("claude", "", { auth: "cli" });
    added.push("claude");
  }
  if (!rows.some((row) => row.kind === "codex")) {
    remember("codex", "", { auth: "cli", model: "gpt-5.6-terra" });
    added.push("codex");
  }
  return added;
}
