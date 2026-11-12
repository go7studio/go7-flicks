import fs from "node:fs";
import path from "node:path";
import { isNetworkPath } from "./stage";
import { readJson, userDir, writeJson } from "./vault";

type AppSettings = {
  stagingDir?: string;
};

function settingsFile(): string {
  return path.join(userDir(), "settings.json");
}

export function defaultStagingDir(): string {
  return path.join(userDir(), "staging");
}

export function stagingDir(): string {
  const saved = readJson<AppSettings>(settingsFile(), {}).stagingDir?.trim() ?? "";
  if (saved) {
    const usable = localFolder(saved);
    if (usable) return usable;
  }
  return defaultStagingDir();
}

export function setStagingDir(dir: string): string {
  const usable = localFolder(dir);
  if (!usable) {
    const resolved = dir.trim() ? path.resolve(dir.trim()) : "";
    if (resolved && isNetworkPath(resolved)) {
      throw new Error("That folder is on a network drive. Working copies stay on this computer.");
    }
    throw new Error("Pick a folder on this computer.");
  }
  const current = readJson<AppSettings>(settingsFile(), {});
  writeJson(settingsFile(), { ...current, stagingDir: usable });
  return usable;
}

function localFolder(dir: string): string | null {
  const trimmed = dir.trim();
  if (!trimmed) return null;
  try {
    const resolved = path.resolve(trimmed);
    if (isNetworkPath(resolved)) return null;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}
