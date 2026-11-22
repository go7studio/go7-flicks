import { builtinTemplates, flickFromTemplate, storedLineColor, storedLineSize, storedOverlayPlace, storedRankColor, storedRankSize, storedTitleFont, storedWarmth, templateFromFlick } from "../shared/canvas";
import type { ResolvedMedia } from "../shared/api";
import {
  type ChannelFile,
  type ConnectionDraft,
  type ConnectionKind,
  type ConnectionPublic,
  type Flick,
  type MediaAsset,
  type RecentChannel,
  type Template,
  defaultsFor,
  storedSoundRelative,
  subscriptionRefusal,
  uid,
} from "../shared/model";
import { latestUpdatedAt } from "../shared/when";
import { decodeBase64, disk, type PhoneDisk } from "./disk";

export const COMPUTER_APP = "Use the computer app for that.";
export const NOT_ON_PHONE = "Not on the phone. Use the computer app for that.";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["claude", "codex", "grok", "cursor", "elevenlabs", "minimax", "other"] as const;
const RECENT = "go7/recent.json";
const TEMPLATES = "go7/templates.json";
const CONNECTIONS = "go7/connections.json";
const SECRETS = "go7/secrets.json";
const RECENT_LIMIT = 12;

const previews = new Map<string, string>();

type StoredRecent = { path: string; name: string; madeAt?: string };
type StoredConnection = Omit<ConnectionPublic, "hasCredential">;
type SecretFile = Record<string, string>;

export type ChannelResult = {
  ok: true;
  message: string;
  dir: string;
  channel: ChannelFile;
  media: ResolvedMedia[];
  mediaBase: string;
};

function store(): Promise<PhoneDisk> {
  return disk();
}

export async function createChannel(parent: unknown, rawName: string): Promise<ChannelResult> {
  const name = safeName(rawName);
  const dir = joinChannel(parent, name);
  if (await readJson(channelPath(dir))) throw new Error("That folder already exists.");
  const channel: ChannelFile = { version: 1, name, accent: "#e2b340", media: [], flicks: [] };
  await writeChannel(dir, channel);
  await remember(dir, name);
  return payload(dir, channel);
}

export async function openChannel(dir: unknown): Promise<ChannelResult> {
  const folder = requireDir(dir);
  const channel = await readChannel(folder);
  await remember(folder, channel.name);
  return payload(folder, channel);
}

export async function updateChannel(dir: unknown, patch: { name?: string; accent?: string } | null): Promise<ChannelResult> {
  const folder = requireDir(dir);
  const channel = await readChannel(folder);
  if (patch?.name) channel.name = safeName(patch.name);
  if (patch?.accent && /^#[0-9a-f]{6}$/i.test(patch.accent)) channel.accent = patch.accent;
  await writeChannel(folder, channel);
  await remember(folder, channel.name);
  return payload(folder, channel);
}

export async function renameChannel(dir: unknown, name: string): Promise<ChannelResult> {
  return updateChannel(dir, { name });
}

export async function createFlick(dir: unknown, rawName: string, templateId: string): Promise<{ ok: true; message: string; flick: Flick }> {
  const folder = requireDir(dir);
  const template = (await listTemplates()).find((item) => item.id === templateId);
  if (!template) throw new Error("Pick a template.");
  const flick = flickFromTemplate(template, safeName(rawName));
  const channel = await readChannel(folder);
  channel.flicks.unshift({ id: flick.id, name: flick.name, updatedAt: new Date().toISOString() });
  await writeFlick(folder, flick);
  await writeChannel(folder, channel);
  await remember(folder, channel.name);
  return { ok: true, message: flick.name, flick };
}

export async function readFlick(dir: unknown, flickId: string): Promise<ChannelResult & { flick: Flick; voicePreview: string | null; soundPreviews: Record<string, string> }> {
  const folder = requireDir(dir);
  const channel = await readChannel(folder);
  const flick = await readFlickFile(folder, flickId);
  const soundPreviews: Record<string, string> = {};
  for (const clip of flick.clips ?? []) {
    const relative = storedSoundRelative(clip.soundRelative);
    if (!relative) continue;
    const url = await playable(`${root(folder)}/flicks/${flick.id}/${relative}`, mimeOf(relative));
    if (url) soundPreviews[clip.id] = url;
  }
  const voicePreview = flick.voiceRelative === "voice.mp3"
    ? await playable(`${root(folder)}/flicks/${flick.id}/voice.mp3`, "audio/mpeg")
    : null;
  return { ...(await payload(folder, channel)), flick, voicePreview, soundPreviews };
}

export async function saveFlick(dir: unknown, flick: Flick): Promise<{ ok: true; message: string; flick: Flick }> {
  const folder = requireDir(dir);
  const saved = await persistFlick(folder, flick);
  return { ok: true, message: "Saved.", flick: saved };
}

export async function duplicateFlick(dir: unknown, flickId: string): Promise<{ ok: true; message: string; flick: Flick; channel: ChannelFile }> {
  const folder = requireDir(dir);
  assertId(flickId);
  const channel = await readChannel(folder);
  if (!channel.flicks.some((item) => item.id === flickId)) throw new Error("That flick is not in this channel.");
  const source = await readFlickFile(folder, flickId);
  const copy = JSON.parse(JSON.stringify(source)) as Flick;
  copy.id = uid();
  await copySideFiles(folder, flickId, copy);
  await writeFlick(folder, copy);
  channel.flicks.unshift({ id: copy.id, name: copy.name, updatedAt: new Date().toISOString() });
  await writeChannel(folder, channel);
  return { ok: true, message: copy.name, flick: copy, channel };
}

export async function deleteFlick(dir: unknown, flickId: string): Promise<{ ok: true; message: string; channel: ChannelFile }> {
  const folder = requireDir(dir);
  assertId(flickId);
  const channel = await readChannel(folder);
  if (!channel.flicks.some((item) => item.id === flickId)) throw new Error("That flick is not in this channel.");
  channel.flicks = channel.flicks.filter((item) => item.id !== flickId);
  await writeChannel(folder, channel);
  await (await store()).remove(`${root(folder)}/flicks/${flickId}`);
  return { ok: true, message: "Removed.", channel };
}

export async function recentChannels(): Promise<RecentChannel[]> {
  const rows = await readRecent();
  const next: RecentChannel[] = [];
  for (const row of rows) {
    let channel: ChannelFile;
    try {
      channel = await readChannel(row.path);
    } catch {
      continue;
    }
    const clippedAt = latestUpdatedAt(channel.flicks);
    next.push({
      path: row.path,
      name: channel.name || row.name,
      ...(clippedAt ? { clippedAt } : {}),
      ...(row.madeAt ? { madeAt: row.madeAt } : {}),
    });
  }
  return next;
}

export async function forgetRecent(dir: unknown): Promise<{ ok: true; message: string }> {
  const folder = requireDir(dir);
  const next = (await readRecent()).filter((item) => !sameDir(item.path, folder));
  await writeJson(RECENT, next);
  return { ok: true, message: "Removed." };
}

export async function listTemplates(): Promise<Template[]> {
  const saved = await readJson<Template[]>(TEMPLATES);
  const extra = (saved ?? []).filter((item) => item && !item.builtin && ID.test(item.id));
  return [...builtinTemplates(), ...extra];
}

export async function saveTemplate(flick: Flick, rawName: string, replaceId?: string): Promise<{ ok: true; message: string; template: Template }> {
  const saved = (await readJson<Template[]>(TEMPLATES) ?? []).filter((item) => item && !item.builtin && ID.test(item.id));
  if (replaceId) {
    if (!ID.test(replaceId) || !saved.some((item) => item.id === replaceId)) {
      throw new Error("Only a template you saved can be replaced.");
    }
    const next = templateFromFlick(flick, safeName(rawName), replaceId);
    await writeJson(TEMPLATES, saved.map((item) => (item.id === replaceId ? next : item)));
    return { ok: true, message: "Template saved.", template: next };
  }
  const created = templateFromFlick(flick, safeName(rawName));
  await writeJson(TEMPLATES, [...saved, created]);
  return { ok: true, message: "Template saved.", template: created };
}

export async function importMedia(dir: unknown, _mode: "copy" | "link"): Promise<{ ok: true; message: string; asset: MediaAsset; media: ResolvedMedia[]; workingCopy: false } | { ok: false; message: string }> {
  const folder = requireDir(dir);
  // Link and copy both keep a local copy. The phone has no separate original file.
  const picked = await chooseFile("video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.webm,.mkv");
  if (!picked) return { ok: false, message: "No file chosen." };
  const channel = await readChannel(folder);
  const asset = await keepVideo(folder, picked);
  channel.media.push(asset);
  await writeChannel(folder, channel);
  const media = await present(folder, channel);
  return { ok: true, message: asset.name, asset, media, workingCopy: false };
}

/** pickVideo has no channel. The desks receive a URL a video tag can play. */
export async function pickVideo(): Promise<string | null> {
  const picked = await chooseFile("video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.webm,.mkv");
  if (!picked) return null;
  const id = uid();
  const ext = extensionOf(picked.file.name);
  const path = `go7/picks/${id}${ext}`;
  await (await store()).writeBytes(path, picked.bytes);
  return playable(path, picked.file.type || mimeOf(picked.file.name));
}

export async function saveNarration(dir: unknown, flickId: string, audioBase64: string, mime: string): Promise<{ ok: true; message: string; relativePath: string; previewUrl?: string; voiceStartSec?: number; flick: Flick }> {
  const folder = requireDir(dir);
  assertId(flickId);
  const bytes = decodeBase64(String(audioBase64 ?? ""));
  if (!bytes.length) throw new Error("The recording was empty.");
  const file = `${root(folder)}/flicks/${flickId}/voice.mp3`;
  await (await store()).writeBytes(file, bytes);
  const flick = await readFlickFile(folder, flickId);
  flick.voiceRelative = "voice.mp3";
  const saved = await persistFlick(folder, flick);
  const type = mime.startsWith("audio/") ? mime : "audio/mpeg";
  const previewUrl = await playable(file, type);
  return {
    ok: true,
    message: "Narration saved.",
    relativePath: "voice.mp3",
    ...(previewUrl ? { previewUrl } : {}),
    voiceStartSec: saved.voiceStartSec,
    flick: saved,
  };
}

export async function listConnections(): Promise<ConnectionPublic[]> {
  const secrets = await readSecrets();
  return (await readConnections()).map((row) => publish(row, secrets));
}

export async function saveConnection(draft: ConnectionDraft): Promise<{ ok: true; message: string; connection: ConnectionPublic }> {
  const kind = draft?.kind;
  if (!isKind(kind)) throw new Error("Unknown connection.");
  const defaults = defaultsFor(kind);
  const rows = await readConnections();
  const secrets = await readSecrets();
  const id = draft.id && ID.test(draft.id) ? draft.id : uid();
  const existing = rows.find((item) => item.id === id);
  const auth = kind === "cursor" ? "cli" : kind === "claude" || kind === "codex" || kind === "grok" ? draft.auth : "key";
  if (auth === "key" && !draft.apiKey?.trim() && !existing) throw new Error("Paste an API key.");
  if (kind === "other" && (!(draft.baseUrl ?? "").trim() || !(draft.model ?? "").trim())) {
    throw new Error("Other connections need a base URL and a model.");
  }
  const blocked = subscriptionRefusal(draft.baseUrl || defaults.baseUrl, draft.model || defaults.model);
  if (blocked) throw new Error(blocked);
  if (draft.apiKey?.trim()) secrets[id] = draft.apiKey.trim();
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
  await writeJson(CONNECTIONS, [...rows.filter((item) => item.id !== id), next]);
  await writeJson(SECRETS, secrets);
  return { ok: true, message: "Saved. Test it before using it.", connection: publish(next, secrets) };
}

export async function deleteConnection(id: string): Promise<{ ok: true; message: string }> {
  assertId(id);
  const secrets = await readSecrets();
  delete secrets[id];
  await writeJson(CONNECTIONS, (await readConnections()).filter((item) => item.id !== id));
  await writeJson(SECRETS, secrets);
  return { ok: true, message: "Removed." };
}

export async function setVoice(id: string, voiceId: string): Promise<{ ok: true; message: string; connection: ConnectionPublic }> {
  const connection = await markConnection(id, { voiceId: String(voiceId ?? "") });
  return { ok: true, message: "Voice updated.", connection };
}

export async function testConnection(id: string): Promise<{ ok: false; message: string; connection?: ConnectionPublic }> {
  if (!ID.test(id)) return { ok: false, message: "Pick a connection." };
  const rows = await readConnections();
  if (!rows.some((item) => item.id === id)) return { ok: false, message: "Pick a connection." };
  const connection = await markConnection(id, { connected: false, statusNote: NOT_ON_PHONE });
  return { ok: false, message: NOT_ON_PHONE, connection };
}

async function persistFlick(dir: string, flick: Flick): Promise<Flick> {
  assertId(flick.id);
  const channel = await readChannel(dir);
  if (!channel.flicks.some((item) => item.id === flick.id)) throw new Error("That flick is not in this channel.");
  const clean = sanitizeFlick(flick);
  await writeFlick(dir, clean);
  channel.flicks = channel.flicks.map((item) =>
    item.id === clean.id ? { ...item, name: clean.name, updatedAt: new Date().toISOString() } : item,
  );
  await writeChannel(dir, channel);
  await remember(dir, channel.name);
  return clean;
}

async function copySideFiles(dir: string, fromId: string, copy: Flick): Promise<void> {
  const holder = await store();
  if (copy.voiceRelative === "voice.mp3") {
    const bytes = await holder.readBytes(`${root(dir)}/flicks/${fromId}/voice.mp3`);
    if (bytes) await holder.writeBytes(`${root(dir)}/flicks/${copy.id}/voice.mp3`, bytes);
  }
  for (const clip of copy.clips ?? []) {
    const relative = storedSoundRelative(clip.soundRelative);
    if (!relative) continue;
    const bytes = await holder.readBytes(`${root(dir)}/flicks/${fromId}/${relative}`);
    if (bytes) await holder.writeBytes(`${root(dir)}/flicks/${copy.id}/${relative}`, bytes);
  }
}

async function keepVideo(dir: string, picked: PickedFile): Promise<MediaAsset> {
  const id = uid();
  const ext = extensionOf(picked.file.name);
  const relativePath = `media/${id}${ext}`;
  const stored = `${root(dir)}/${relativePath}`;
  await (await store()).writeBytes(stored, picked.bytes);
  const preview = await playable(stored, picked.file.type || mimeOf(picked.file.name));
  const info = await probeVideo(preview);
  return {
    id,
    name: picked.file.name.trim() || `clip${ext}`,
    relativePath,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    codec: info.codec,
  };
}

async function present(dir: string, channel: ChannelFile): Promise<ResolvedMedia[]> {
  const rows: ResolvedMedia[] = [];
  for (const asset of channel.media) {
    const stored = mediaStored(dir, asset.relativePath);
    const bytes = stored ? await (await store()).readBytes(stored) : null;
    const missing = !stored || !bytes || bytes.length === 0;
    const previewUrl = !missing && stored ? await playable(stored, mimeOf(asset.relativePath || asset.name)) : null;
    rows.push({
      ...asset,
      absolutePath: stored ?? "",
      missing,
      previewUrl,
      workingCopy: false,
    });
  }
  return rows;
}

async function playable(path: string, mime: string): Promise<string | null> {
  const native = await (await store()).nativeUrl(path);
  if (native) return native;
  const cached = previews.get(path);
  if (cached) return cached;
  const bytes = await (await store()).readBytes(path);
  if (!bytes) return null;
  const url = blobUrl(bytes, mime);
  if (url) previews.set(path, url);
  return url;
}

async function payload(dir: string, channel: ChannelFile): Promise<ChannelResult> {
  return { ok: true, message: channel.name, dir, channel, media: await present(dir, channel), mediaBase: "" };
}

async function readChannel(dir: string): Promise<ChannelFile> {
  const raw = await readJson<ChannelFile>(channelPath(dir));
  if (!raw) throw new Error("That folder is not a Go7Flicks channel.");
  if (raw.version !== 1 || !Array.isArray(raw.flicks) || !Array.isArray(raw.media)) {
    throw new Error("That channel file cannot be read.");
  }
  return raw;
}

async function writeChannel(dir: string, channel: ChannelFile): Promise<void> {
  await writeJson(channelPath(dir), channel);
}

async function readFlickFile(dir: string, flickId: string): Promise<Flick> {
  assertId(flickId);
  const raw = await readJson<Flick>(`${root(dir)}/flicks/${flickId}/flick.json`);
  if (!raw) throw new Error("That flick is missing.");
  return raw;
}

async function writeFlick(dir: string, flick: Flick): Promise<void> {
  await writeJson(`${root(dir)}/flicks/${flick.id}/flick.json`, flick);
}

async function remember(dir: string, name: string): Promise<void> {
  const next = [{ path: dir, name, madeAt: new Date().toISOString() }, ...(await readRecent()).filter((item) => !sameDir(item.path, dir))].slice(0, RECENT_LIMIT);
  await writeJson(RECENT, next);
}

async function readRecent(): Promise<StoredRecent[]> {
  const rows = await readJson<StoredRecent[]>(RECENT);
  return (rows ?? []).filter((item) => item && typeof item.path === "string" && typeof item.name === "string");
}

async function readConnections(): Promise<StoredConnection[]> {
  const rows = await readJson<StoredConnection[]>(CONNECTIONS);
  return (rows ?? []).filter((item) => item && ID.test(item.id) && isKind(item.kind));
}

async function readSecrets(): Promise<SecretFile> {
  const rows = await readJson<SecretFile>(SECRETS);
  return rows && typeof rows === "object" ? rows : {};
}

async function markConnection(id: string, patch: Partial<Pick<ConnectionPublic, "connected" | "statusNote" | "voices" | "voiceId">>): Promise<ConnectionPublic> {
  assertId(id);
  const rows = await readConnections();
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error("That connection is gone.");
  const next = { ...row, ...patch };
  await writeJson(CONNECTIONS, rows.map((item) => (item.id === id ? next : item)));
  return publish(next, await readSecrets());
}

function publish(row: StoredConnection, secrets: SecretFile): ConnectionPublic {
  return {
    ...row,
    hasCredential: Boolean(secrets[row.id]),
    voices: row.voices ?? [],
    statusNote: row.statusNote ?? "",
    voiceId: row.voiceId ?? "",
  };
}

function sanitizeFlick(flick: Flick): Flick {
  assertId(flick.id);
  const voiceStartSec = voiceStartOf(flick);
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
  } as Flick;
  if (voiceStartSec === undefined) delete clean.voiceStartSec;
  else clean.voiceStartSec = voiceStartSec;
  return clean;
}

function voiceStartOf(flick: Flick): number | undefined {
  const value = flick.voiceStartSec;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function readJson<T>(path: string): Promise<T | null> {
  const text = await (await store()).readText(path);
  if (text == null || text === "") return null;
  return JSON.parse(text) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await (await store()).writeText(path, JSON.stringify(value));
}

function channelPath(dir: string): string {
  return `${root(dir)}/channel.json`;
}

function root(dir: string): string {
  return `go7/channels/${encodeURIComponent(dir)}`;
}

function mediaStored(dir: string, relative: string | undefined): string | null {
  if (!relative || relative.includes("..") || relative.startsWith("/") || relative.includes("\\")) return null;
  return `${root(dir)}/${relative}`;
}

function joinChannel(parent: unknown, name: string): string {
  if (typeof parent !== "string") throw new Error(COMPUTER_APP);
  const base = parent.trim().replace(/[\\/]+$/, "");
  if (!base) throw new Error(COMPUTER_APP);
  return `${base}/${name}`;
}

function requireDir(dir: unknown): string {
  if (typeof dir !== "string" || !dir.trim()) throw new Error(COMPUTER_APP);
  return dir.trim();
}

function sameDir(left: string, right: string): boolean {
  return left.replace(/\\/g, "/").replace(/\/+$/, "") === right.replace(/\\/g, "/").replace(/\/+$/, "");
}

function safeName(name: string): string {
  const cleaned = String(name ?? "").trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 80);
  if (!cleaned) throw new Error("Name it first.");
  return cleaned;
}

function assertId(id: string): void {
  if (!ID.test(id)) throw new Error("Bad id.");
}

function isKind(value: string): value is ConnectionKind {
  return (KINDS as readonly string[]).includes(value);
}

type PickedFile = { file: File; bytes: Uint8Array };

function chooseFile(accept: string): Promise<PickedFile | null> {
  const doc = pageDocument();
  if (!doc?.createElement) return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = accept;
    let done = false;
    const finish = (file: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      void file.arrayBuffer().then(
        (buffer) => resolve({ file, bytes: new Uint8Array(buffer) }),
        () => resolve(null),
      );
    };
    input.addEventListener("change", () => finish(input.files && input.files.length > 0 ? input.files[0] : null));
    input.addEventListener("cancel", () => finish(null));
    doc.body?.appendChild(input);
    input.click();
  });
}

function pageDocument(): Document | null {
  const scoped = (globalThis as { window?: { document?: Document } }).window?.document;
  if (scoped) return scoped;
  if (typeof document !== "undefined") return document;
  return null;
}

async function probeVideo(url: string | null): Promise<{ durationSec: number; width: number; height: number; codec: string }> {
  const empty = { durationSec: 0, width: 0, height: 0, codec: "" };
  const doc = pageDocument();
  if (!url || !doc?.createElement) return empty;
  return new Promise((resolve) => {
    const video = doc.createElement("video");
    let settled = false;
    const finish = (info: { durationSec: number; width: number; height: number; codec: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* A stub element has no media element methods. */
      }
      resolve(info);
    };
    const timer = setTimeout(() => finish(empty), 8000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      finish({
        durationSec: Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : 0,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        codec: "",
      });
    };
    video.onerror = () => finish(empty);
    video.src = url;
  });
}

function extensionOf(name: string): string {
  const match = /\.(mp4|mov|m4v|webm|mkv|mp3|m4a|wav|aac)$/i.exec(name.trim());
  return match ? match[0].toLowerCase() : ".mp4";
}

function mimeOf(name: string): string {
  const ext = extensionOf(name);
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov" || ext === ".m4v") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a" || ext === ".aac") return "audio/mp4";
  if (ext === ".wav") return "audio/wav";
  return "video/mp4";
}

function blobUrl(bytes: Uint8Array, mime: string): string | null {
  try {
    if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
    return URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mime }));
  } catch {
    return null;
  }
}
