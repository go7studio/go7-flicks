import fs from "node:fs";
import path from "node:path";
import { builtinTemplates, flickFromTemplate, storedLineColor, storedLineSize, storedOverlayPlace, storedRankColor, storedRankSize, storedTitleFont, storedWarmth, templateFromFlick } from "../src/shared/canvas";
import {
  defaultsFor,
  subscriptionRefusal,
  type ChannelFile,
  type ConnectionDraft,
  type ConnectionKind,
  type ConnectionPublic,
  type Flick,
  type MediaAsset,
  type RecentChannel,
  type Template,
  storedSoundRelative,
  uid,
} from "../src/shared/model";
import { latestUpdatedAt } from "../src/shared/when";
import { noteShelfCredit, rememberShelf } from "./shelf";
import { deleteSecret, hasSecret, readJson, readSecret, saveSecret, userDir, writeJson } from "./vault";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StoredConnection = Omit<ConnectionPublic, "hasCredential"> & { hasCredential?: boolean };

function storedRecents(): { path: string; name: string }[] {
  return readJson<RecentChannel[]>(path.join(userDir(), "recent.json"), [])
    .filter((item) => item?.path && fs.existsSync(path.join(item.path, "channel.json")))
    .map((item) => ({ path: item.path, name: item.name }));
}

export function recentChannels(): RecentChannel[] {
  return storedRecents().map((item) => {
    const clippedAt = latestClipped(item.path);
    const madeAt = channelTouched(item.path);
    return {
      ...item,
      ...(clippedAt ? { clippedAt } : {}),
      ...(madeAt ? { madeAt } : {}),
    };
  });
}

function channelTouched(dir: string): string | undefined {
  try {
    const file = path.join(dir, "channel.json");
    if (!fs.existsSync(file)) return undefined;
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function latestClipped(dir: string): string | undefined {
  try {
    return latestUpdatedAt(readChannel(dir).flicks);
  } catch {
    return undefined;
  }
}

export function rememberChannel(dir: string, name: string): void {
  const next = [{ path: dir, name }, ...storedRecents().filter((item) => item.path !== dir)].slice(0, 12);
  writeJson(path.join(userDir(), "recent.json"), next);
}

export function forgetRecent(dir: string): void {
  const target = path.resolve(dir);
  const next = storedRecents().filter((item) => path.resolve(item.path) !== target);
  writeJson(path.join(userDir(), "recent.json"), next);
}

export function createChannel(parent: string, rawName: string): { dir: string; channel: ChannelFile } {
  const name = safeName(rawName);
  const dir = path.join(parent, name);
  if (fs.existsSync(dir)) throw new Error("That folder already exists.");
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
  fs.mkdirSync(path.join(dir, "flicks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "exports"), { recursive: true });
  const channel: ChannelFile = { version: 1, name, accent: "#e2b340", media: [], flicks: [] };
  writeJson(path.join(dir, "channel.json"), channel);
  rememberChannel(dir, name);
  return { dir, channel };
}

export function openChannel(dir: string): ChannelFile {
  const channel = readChannel(dir);
  rememberChannel(dir, channel.name);
  return channel;
}

export function updateChannel(dir: string, patch: { name?: string; accent?: string }): ChannelFile {
  const channel = readChannel(dir);
  if (patch.name) channel.name = safeName(patch.name);
  if (patch.accent && /^#[0-9a-f]{6}$/i.test(patch.accent)) channel.accent = patch.accent;
  writeJson(path.join(dir, "channel.json"), channel);
  rememberChannel(dir, channel.name);
  return channel;
}

export function createFlick(dir: string, rawName: string, templateId: string): Flick {
  const template = listTemplates().find((item) => item.id === templateId);
  if (!template) throw new Error("Pick a template.");
  const flick = flickFromTemplate(template, safeName(rawName));
  const channel = readChannel(dir);
  channel.flicks.unshift({ id: flick.id, name: flick.name, updatedAt: new Date().toISOString() });
  writeFlick(dir, flick);
  writeJson(path.join(dir, "channel.json"), channel);
  return flick;
}

const SOUND_EXT = new Set([".mp3", ".m4a", ".wav", ".aac"]);

/** Copy one local audio file onto a cut. A second file on that cut replaces the first. */
export function attachSound(dir: string, flickId: string, clipId: string, source: string): Flick {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("That file is missing.");
  const ext = path.extname(source).toLowerCase();
  if (!SOUND_EXT.has(ext)) throw new Error("Use an mp3, m4a, wav, or aac file.");
  assertId(clipId);
  const flick = readFlick(dir, flickId);
  const clip = flick.clips.find((item) => item.id === clipId);
  if (!clip) throw new Error("Select a cut, then add a sound.");
  const relative = `sound-${clipId}${ext}`;
  const folder = path.join(dir, "flicks", flickId);
  fs.mkdirSync(folder, { recursive: true });
  const previous = storedSoundRelative(clip.soundRelative);
  if (previous && previous !== relative) {
    const oldFile = path.join(folder, previous);
    if (fs.existsSync(oldFile)) fs.rmSync(oldFile, { force: true });
  }
  fs.copyFileSync(source, path.join(folder, relative));
  clip.soundRelative = relative;
  return saveFlick(dir, flick);
}

/** Drop the sound on one cut and delete the copied file. */
export function clearSound(dir: string, flickId: string, clipId: string): Flick {
  assertId(clipId);
  const flick = readFlick(dir, flickId);
  const clip = flick.clips.find((item) => item.id === clipId);
  if (!clip) throw new Error("That cut is missing.");
  const relative = storedSoundRelative(clip.soundRelative);
  if (relative) {
    const file = path.join(dir, "flicks", flickId, relative);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  clip.soundRelative = undefined;
  return saveFlick(dir, flick);
}

export function readFlick(dir: string, flickId: string): Flick {
  assertId(flickId);
  const file = path.join(dir, "flicks", flickId, "flick.json");
  if (!fs.existsSync(file)) throw new Error("That flick is missing.");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Flick;
}

export function saveFlick(dir: string, flick: Flick): Flick {
  assertId(flick.id);
  const channel = readChannel(dir);
  if (!channel.flicks.some((item) => item.id === flick.id)) throw new Error("That flick is not in this channel.");
  const clean = sanitizeFlick(flick);
  writeFlick(dir, clean);
  channel.flicks = channel.flicks.map((item) =>
    item.id === clean.id ? { ...item, name: clean.name, updatedAt: new Date().toISOString() } : item,
  );
  writeJson(path.join(dir, "channel.json"), channel);
  const music = clean.musicId ? channel.media.find((item) => item.id === clean.musicId) : undefined;
  const musicFile = music ? resolveChannelMedia(dir, music) : null;
  if (music && musicFile && clean.musicCredit && fs.existsSync(musicFile)) {
    noteShelfCredit(
      userDir(),
      { name: music.name, bytes: fs.statSync(musicFile).size, durationSec: music.durationSec },
      clean.musicCredit,
    );
  }
  return clean;
}

export function duplicateFlick(dir: string, flickId: string): Flick {
  assertId(flickId);
  const sourceFile = path.join(dir, "flicks", flickId, "flick.json");
  if (!fs.existsSync(sourceFile)) throw new Error("That flick is missing.");
  const channel = readChannel(dir);
  if (!channel.flicks.some((item) => item.id === flickId)) throw new Error("That flick is not in this channel.");
  const copy = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as Flick;
  copy.id = uid();
  const destFolder = path.join(dir, "flicks", copy.id);
  fs.cpSync(path.join(dir, "flicks", flickId), destFolder, { recursive: true });
  writeJson(path.join(destFolder, "flick.json"), copy);
  channel.flicks.unshift({ id: copy.id, name: copy.name, updatedAt: new Date().toISOString() });
  writeJson(path.join(dir, "channel.json"), channel);
  return copy;
}

export function deleteFlick(dir: string, flickId: string): void {
  assertId(flickId);
  const channel = readChannel(dir);
  if (!channel.flicks.some((item) => item.id === flickId)) throw new Error("That flick is not in this channel.");
  channel.flicks = channel.flicks.filter((item) => item.id !== flickId);
  writeJson(path.join(dir, "channel.json"), channel);
  fs.rmSync(path.join(dir, "flicks", flickId), { recursive: true, force: true });
}

export function importMedia(dir: string, source: string, mode: "copy" | "link", info: Omit<MediaAsset, "id" | "name" | "relativePath" | "absolutePath"> & { name?: string }): MediaAsset {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("That file is missing.");
  const channel = readChannel(dir);
  const id = uid();
  const name = info.name?.trim() || path.basename(source);
  const asset: MediaAsset = {
    id,
    name,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    codec: info.codec,
  };
  if (mode === "link") {
    asset.absolutePath = path.resolve(source);
  } else {
    const ext = path.extname(source);
    const relativePath = path.posix.join("media", `${id}${ext}`);
    fs.copyFileSync(source, path.join(dir, "media", `${id}${ext}`));
    asset.relativePath = relativePath;
  }
  channel.media.push(asset);
  writeJson(path.join(dir, "channel.json"), channel);
  rememberShelf(userDir(), source, { name, ...info }, mode);
  return asset;
}

export function removeMedia(dir: string, mediaId: string): void {
  assertId(mediaId);
  const channel = readChannel(dir);
  const asset = channel.media.find((item) => item.id === mediaId);
  if (!asset) throw new Error("That file is not in this channel.");
  for (const summary of channel.flicks) {
    if (!ID.test(summary.id)) continue;
    const file = path.join(dir, "flicks", summary.id, "flick.json");
    if (!fs.existsSync(file)) continue;
    const flick = JSON.parse(fs.readFileSync(file, "utf8")) as { clips?: { mediaId?: string | null }[]; musicId?: string };
    if ((flick.clips ?? []).some((clip) => clip.mediaId === mediaId) || flick.musicId === mediaId) {
      throw new Error("A clip still uses that file.");
    }
  }
  const file = resolveChannelMedia(dir, asset);
  channel.media = channel.media.filter((item) => item.id !== mediaId);
  writeJson(path.join(dir, "channel.json"), channel);
  if (file && fs.existsSync(file) && fileInside(dir, file)) fs.rmSync(file);
}

export function listTemplates(): Template[] {
  const saved = readJson<Template[]>(path.join(userDir(), "templates.json"), []);
  return [...builtinTemplates(), ...saved.filter((item) => item && !item.builtin && ID.test(item.id))];
}

export function saveTemplate(flick: Flick, rawName: string, replaceId?: string): Template {
  const saved = readJson<Template[]>(path.join(userDir(), "templates.json"), []).filter(
    (item) => item && !item.builtin && ID.test(item.id),
  );
  if (replaceId) {
    if (!ID.test(replaceId) || !saved.some((item) => item.id === replaceId)) {
      throw new Error("Only a template you saved can be replaced.");
    }
    const next = templateFromFlick(flick, safeName(rawName), replaceId);
    writeJson(
      path.join(userDir(), "templates.json"),
      saved.map((item) => (item.id === replaceId ? next : item)),
    );
    return next;
  }
  const created = templateFromFlick(flick, safeName(rawName));
  writeJson(path.join(userDir(), "templates.json"), [...saved, created]);
  return created;
}

export function listConnections(): ConnectionPublic[] {
  return readConnections().map(publish);
}

export function saveConnection(draft: ConnectionDraft): ConnectionPublic {
  const kind = draft.kind;
  if (!isKind(kind)) throw new Error("Unknown connection.");
  const defaults = defaultsFor(kind);
  const rows = readConnections();
  const id = draft.id && ID.test(draft.id) ? draft.id : uid();
  const existing = rows.find((item) => item.id === id);
  const auth = kind === "cursor" ? "cli" : kind === "claude" || kind === "codex" || kind === "grok" ? draft.auth : "key";
  if (auth === "key" && !draft.apiKey && !existing) throw new Error("Paste an API key.");
  if (kind === "other" && (!draft.baseUrl.trim() || !draft.model.trim())) {
    throw new Error("Other connections need a base URL and a model.");
  }
  const blocked = subscriptionRefusal(draft.baseUrl || defaults.baseUrl, draft.model || defaults.model);
  if (blocked) throw new Error(blocked);
  if (draft.apiKey) saveSecret(id, draft.apiKey.trim());
  const next: StoredConnection = {
    id,
    kind,
    name: safeName(draft.name || defaults.name),
    connected: false,
    auth,
    baseUrl: (draft.baseUrl || defaults.baseUrl).trim(),
    model: (draft.model || defaults.model).trim(),
    api: draft.api || defaults.api,
    voiceId: draft.voiceId || defaults.voiceId,
    voices: existing?.voices ?? [],
    statusNote: "Not tested yet.",
  };
  const without = rows.filter((item) => item.id !== id);
  writeJson(path.join(userDir(), "connections.json"), [...without, next]);
  return publish(next);
}

export function deleteConnection(id: string): void {
  assertId(id);
  writeJson(
    path.join(userDir(), "connections.json"),
    readConnections().filter((item) => item.id !== id),
  );
  deleteSecret(id);
}

export function markConnection(id: string, patch: Partial<Pick<ConnectionPublic, "connected" | "statusNote" | "voices" | "voiceId">>): ConnectionPublic {
  const rows = readConnections();
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error("That connection is gone.");
  const next = { ...row, ...patch };
  writeJson(
    path.join(userDir(), "connections.json"),
    rows.map((item) => (item.id === id ? next : item)),
  );
  return publish(next);
}

export function connectionKey(id: string): string | null {
  return readSecret(id);
}

export function getConnection(id: string): ConnectionPublic {
  const row = readConnections().find((item) => item.id === id);
  if (!row) throw new Error("Pick a connection.");
  return publish(row);
}

export function readChannel(dir: string): ChannelFile {
  const file = path.join(dir, "channel.json");
  if (!fs.existsSync(file)) throw new Error("That folder is not a Go7Flicks channel.");
  const channel = JSON.parse(fs.readFileSync(file, "utf8")) as ChannelFile;
  if (channel.version !== 1 || !Array.isArray(channel.flicks) || !Array.isArray(channel.media)) {
    throw new Error("That channel file cannot be read.");
  }
  return channel;
}

function writeFlick(dir: string, flick: Flick): void {
  const folder = path.join(dir, "flicks", flick.id);
  fs.mkdirSync(folder, { recursive: true });
  writeJson(path.join(folder, "flick.json"), flick);
}

function readConnections(): StoredConnection[] {
  const rows = readJson<StoredConnection[]>(path.join(userDir(), "connections.json"), []);
  return rows.filter((item) => item && ID.test(item.id) && isKind(item.kind));
}

function publish(row: StoredConnection): ConnectionPublic {
  return {
    ...row,
    hasCredential: hasSecret(row.id),
    voices: row.voices ?? [],
    statusNote: row.statusNote ?? "",
    voiceId: row.voiceId ?? "",
  };
}

function voiceStartSecOf(flick: Flick): number | undefined {
  const value = (flick as { voiceStartSec?: unknown }).voiceStartSec;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeFlick(flick: Flick): Flick {
  assertId(flick.id);
  const voiceStartSec = voiceStartSecOf(flick);
  const clean = {
    ...flick,
    name: safeName(flick.name),
    fps: 30,
    width: 1080,
    height: 1920,
    voiceRelative: flick.voiceRelative === "voice.mp3" ? "voice.mp3" : undefined,
    musicId: flick.musicId && ID.test(flick.musicId) ? flick.musicId : undefined,
    musicCredit: flick.musicId && ID.test(flick.musicId) ? flick.musicCredit?.trim() || undefined : undefined,
    headline: flick.headline?.trim() || undefined,
    headlineColor: flick.headlineColor?.trim() || undefined,
    accentWords: flick.accentWords?.trim() || undefined,
    titleStroke: Number.isFinite(flick.titleStroke) ? flick.titleStroke : undefined,
    showRank: flick.showRank,
    showCaptions: flick.showCaptions === false ? false : undefined,
    titleFont: storedTitleFont(flick.titleFont),
    lineColor: storedLineColor(flick.lineColor),
    lineSize: storedLineSize(flick.lineSize),
    rankSize: storedRankSize(flick.rankSize),
    rankColor: storedRankColor(flick.rankColor),
    rankPlace: storedOverlayPlace(flick.rankPlace, "top"),
    linePlace: storedOverlayPlace(flick.linePlace, "bottom"),
    pictureWarmth: storedWarmth(flick.pictureWarmth),
    regions: flick.regions ?? [],
    tracks: flick.tracks ?? [],
    clips: (flick.clips ?? []).map((clip) => ({
      ...clip,
      sourceUrl: clip.sourceUrl?.trim() || undefined,
      line: clip.line?.trim() || undefined,
      focus: typeof clip.focus === "number" && Number.isFinite(clip.focus) ? Math.min(1, Math.max(0, clip.focus)) : undefined,
      soundRelative: storedSoundRelative(clip.soundRelative),
    })),
  } as Flick & { voiceStartSec?: number };
  if (voiceStartSec === undefined) delete clean.voiceStartSec;
  else clean.voiceStartSec = voiceStartSec;
  return clean;
}

function resolveChannelMedia(dir: string, asset: MediaAsset): string | null {
  if (asset.absolutePath) return asset.absolutePath;
  if (asset.relativePath) return path.join(dir, asset.relativePath);
  return null;
}

function fileInside(dir: string, file: string): boolean {
  const root = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
  const target = fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file);
  const rel = path.relative(root, target);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function safeName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 80);
  if (!cleaned) throw new Error("Name it first.");
  return cleaned;
}

function assertId(id: string): void {
  if (!ID.test(id)) throw new Error("Bad id.");
}

function isKind(value: string): value is ConnectionKind {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "grok" ||
    value === "cursor" ||
    value === "elevenlabs" ||
    value === "minimax" ||
    value === "other"
  );
}
