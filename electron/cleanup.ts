import fs from "node:fs";
import path from "node:path";
import type { Flick, MediaAsset } from "../src/shared/model";
import { forgetUnusedCopies, isNetworkPath } from "./stage";

const VIDEO = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CleanResult = {
  removedCopies: string[];
  removedExports: string[];
  keptCopies: number;
  skippedNetworkChannels: number;
};

type ChannelShape = {
  media?: MediaAsset[];
  flicks?: { id?: string; name?: string }[];
};

type UsedRead =
  | { unreadable: true }
  | { unreadable: false; used: Set<string>; flickNames: Set<string> };

export async function cleanUnused(stagingDir: string, channelDirs: string[]): Promise<CleanResult> {
  const used = new Set<string>();
  const protect: string[] = [];
  const removedExports: string[] = [];
  let skippedNetworkChannels = 0;
  for (const dir of channelDirs) {
    const resolved = path.resolve(dir);
    const network = isNetworkPath(resolved);
    if (network) skippedNetworkChannels += 1;
    const read = readUsed(resolved);
    if (read.unreadable) {
      protect.push(resolved);
      continue;
    }
    for (const item of read.used) used.add(item);
    if (!network) removedExports.push(...cleanExports(resolved, read.flickNames));
  }
  const copies = await forgetUnusedCopies(stagingDir, used, protect);
  return {
    removedCopies: copies.removed,
    removedExports,
    keptCopies: copies.kept,
    skippedNetworkChannels,
  };
}

function readUsed(dir: string): UsedRead {
  const file = path.join(dir, "channel.json");
  if (!fs.existsSync(file)) return { unreadable: false, used: new Set(), flickNames: new Set() };
  let channel: ChannelShape;
  try {
    channel = JSON.parse(fs.readFileSync(file, "utf8")) as ChannelShape;
  } catch {
    return { unreadable: true };
  }
  if (!channel || !Array.isArray(channel.media) || !Array.isArray(channel.flicks)) return { unreadable: true };
  const media = new Map(channel.media.map((item) => [item.id, item]));
  const used = new Set<string>();
  const flickNames = new Set<string>();
  for (const summary of channel.flicks) {
    const name = summary?.name?.trim();
    if (name) flickNames.add(name.toLowerCase());
    const id = summary?.id ?? "";
    if (!ID.test(id)) continue;
    const flickFile = path.join(dir, "flicks", id, "flick.json");
    if (!fs.existsSync(flickFile)) continue;
    let flick: Flick;
    try {
      flick = JSON.parse(fs.readFileSync(flickFile, "utf8")) as Flick;
    } catch {
      return { unreadable: true };
    }
    const ids = new Set<string>();
    for (const clip of flick.clips ?? []) {
      if (clip.mediaId) ids.add(clip.mediaId);
    }
    if (flick.musicId) ids.add(flick.musicId);
    for (const mediaId of ids) {
      const resolved = resolveMedia(dir, media.get(mediaId));
      if (resolved) used.add(resolved);
    }
    if (flick.voiceRelative) {
      const voice = path.resolve(dir, "flicks", flick.id, flick.voiceRelative);
      if (fs.existsSync(voice)) used.add(voice);
    }
  }
  return { unreadable: false, used, flickNames };
}

function resolveMedia(dir: string, asset: MediaAsset | undefined): string | null {
  if (!asset) return null;
  if (asset.absolutePath) return path.resolve(asset.absolutePath);
  if (asset.relativePath) return path.resolve(dir, asset.relativePath);
  return null;
}

function cleanExports(dir: string, flickNames: Set<string>): string[] {
  const exportsDir = path.join(dir, "exports");
  if (isNetworkPath(exportsDir) || !fs.existsSync(exportsDir)) return [];
  const dirStat = fs.lstatSync(exportsDir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return [];
  const removed: string[] = [];
  for (const name of fs.readdirSync(exportsDir)) {
    const full = path.join(exportsDir, name);
    const info = fs.lstatSync(full);
    if (!info.isFile() || info.isSymbolicLink()) continue;
    const ext = path.extname(name).toLowerCase();
    const stem = path.basename(name, ext).trim().toLowerCase();
    const partial = name.toLowerCase().endsWith(".partial");
    if (partial) {
      fs.rmSync(full, { force: true });
      removed.push(name);
      continue;
    }
    if (!VIDEO.has(ext)) continue;
    const duplicate = /^(.*) \((\d+)\)$/.exec(stem);
    const canonical = duplicate?.[1]?.trim() ?? "";
    if (!duplicate || ext !== ".mp4" || !flickNames.has(canonical)) continue;
    const kept = path.join(exportsDir, `${canonical}.mp4`);
    if (!fs.existsSync(kept)) continue;
    fs.rmSync(full, { force: true });
    removed.push(name);
  }
  return removed;
}
