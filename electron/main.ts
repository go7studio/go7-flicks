import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, type NativeImage } from "electron";

app.setName("Go7Flicks");

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { exportCut, resolveAsset, styledVoiceStart } from "./cut";
import { clipTooLong, downloadClip, searchSubject } from "./download";
import { clipLink } from "../src/shared/link";
import {
  connectionKey,
  createChannel,
  createFlick,
  deleteConnection,
  getConnection,
  importMedia,
  listConnections,
  listTemplates,
  markConnection,
  openChannel,
  readChannel,
  deleteFlick,
  duplicateFlick,
  forgetRecent,
  readFlick,
  attachSound,
  clearSound,
  recentChannels,
  removeMedia,
  saveConnection,
  saveFlick,
  saveTemplate,
  updateChannel,
} from "./library";
import { mediaMadeAt } from "./made";
import { startMediaServer, type MediaGate } from "./media-server";
import { cleanUnused } from "./cleanup";
import { setStagingDir, stagingDir } from "./settings";
import { listShelf, shelfSource } from "./shelf";
import { stageSource, stagedPathIfReady } from "./stage";
import { userDir } from "./vault";
import { failureLine, trimToAction } from "./action";
import { probeGpu, probeMedia } from "./probe";
import { allowsMicrophone, narrationBytes, writeNarration } from "./narration";
import { askAssistant, previewSpeech, synthesize, testProvider, writeLine } from "./providers";
import { seedMachineAccounts } from "./seed-accounts";
import { renderFlick } from "./styled";
import type { FlickProps } from "../src/remotion/FlickComposition";
import { storedSoundRelative, storedVoiceStart, type ChannelFile, type ConnectionDraft, type Flick, type MediaAsset } from "../src/shared/model";
import { SHORT_CLIP_SEC, subjectCount } from "../src/shared/subject";

const gate: MediaGate = { channelDir: null, channel: null, stagingDir: null };
let mediaBase = "";

function useStaging(): string {
  const dir = stagingDir();
  gate.stagingDir = dir;
  return dir;
}

function fileUrl(absolute: string): string {
  return `${mediaBase}/file?path=${encodeURIComponent(absolute)}`;
}

function usedMediaIds(flick: Flick): Set<string> {
  const ids = new Set<string>();
  for (const clip of flick.clips) {
    if (clip.mediaId) ids.add(clip.mediaId);
  }
  if (flick.musicId) ids.add(flick.musicId);
  return ids;
}

/** A clip that already points at this link, with the file still on disk. */
function storedClipFile(dir: string, url: string): { asset: MediaAsset; file: string } | null {
  let want: string;
  try {
    want = clipLink(url);
  } catch {
    return null;
  }
  let channel: ChannelFile;
  try {
    channel = readChannel(dir);
  } catch {
    return null;
  }
  for (const summary of channel.flicks) {
    let flick: Flick;
    try {
      flick = readFlick(dir, summary.id);
    } catch {
      continue;
    }
    for (const clip of flick.clips) {
      if (!clip.mediaId || !clip.sourceUrl) continue;
      let storedUrl: string;
      try {
        storedUrl = clipLink(clip.sourceUrl);
      } catch {
        continue;
      }
      if (storedUrl !== want) continue;
      const asset = channel.media.find((item) => item.id === clip.mediaId);
      const file = resolveAsset(dir, asset);
      if (!asset || !file || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      return { asset, file };
    }
  }
  return null;
}

function fileInside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function localAsset(dir: string, asset: MediaAsset): Promise<MediaAsset> {
  const source = resolveAsset(dir, asset);
  if (!source || !fs.existsSync(source)) return asset;
  const local = await stageSource(source, useStaging());
  if (path.resolve(local) === path.resolve(source)) return asset;
  return { ...asset, absolutePath: local, relativePath: undefined };
}

function fail(error: unknown): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : "Something went wrong." };
}

function projectRoot(): string {
  const candidates = [process.cwd(), app.getAppPath()];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "src/remotion/index.ts"))) ?? process.cwd();
}

function watch(dir: string): ChannelFile {
  const channel = readChannel(dir);
  gate.channelDir = dir;
  gate.channel = channel;
  return channel;
}

async function present(dir: string, channel: ChannelFile, stageIds?: Set<string>) {
  const staging = useStaging();
  const rows = [];
  for (const asset of channel.media) {
    const stored = resolveAsset(dir, asset) ?? "";
    const missing = !stored || !fs.existsSync(stored);
    let readable = stored;
    if (!missing && stageIds?.has(asset.id)) readable = await stageSource(stored, staging);
    else if (!missing) readable = stagedPathIfReady(stored, staging) ?? stored;
    const madeAt = mediaMadeAt(asset.name, stored || null);
    rows.push({
      ...asset,
      absolutePath: stored,
      missing,
      workingCopy: !missing && path.resolve(readable) !== path.resolve(stored),
      previewUrl: missing ? null : fileUrl(readable),
      ...(madeAt ? { madeAt } : {}),
    });
  }
  return rows;
}

async function payload(dir: string, channel: ChannelFile, stageIds?: Set<string>) {
  return { ok: true as const, dir, channel, media: await present(dir, channel, stageIds), mediaBase };
}

async function soundPreviewMap(dir: string, flick: Flick): Promise<Record<string, string>> {
  const staging = useStaging();
  const previews: Record<string, string> = {};
  for (const clip of flick.clips) {
    const relative = storedSoundRelative(clip.soundRelative);
    if (!relative) continue;
    const absolute = path.join(dir, "flicks", flick.id, relative);
    if (!fs.existsSync(absolute)) continue;
    const local = await stageSource(absolute, staging);
    previews[clip.id] = fileUrl(local);
  }
  return previews;
}

async function stagedSounds(dir: string, flick: Flick): Promise<Record<string, string>> {
  const staging = useStaging();
  const files: Record<string, string> = {};
  for (const clip of flick.clips) {
    const relative = storedSoundRelative(clip.soundRelative);
    if (!relative) continue;
    const absolute = path.join(dir, "flicks", flick.id, relative);
    if (!fs.existsSync(absolute)) throw new Error("The sound file is missing.");
    files[clip.id] = await stageSource(absolute, staging);
  }
  return files;
}

async function voicePreview(dir: string, flick: Flick): Promise<string | null> {
  if (flick.voiceRelative !== "voice.mp3") return null;
  const absolute = path.join(dir, "flicks", flick.id, "voice.mp3");
  if (!fs.existsSync(absolute)) return null;
  const local = await stageSource(absolute, useStaging());
  return fileUrl(local);
}

async function flickProps(dir: string, channel: ChannelFile, flick: Flick, preview: boolean): Promise<FlickProps> {
  const staging = useStaging();
  const clips = [];
  for (const clip of flick.clips) {
    const asset = channel.media.find((item) => item.id === clip.mediaId);
    const stored = resolveAsset(dir, asset);
    const ready = Boolean(stored && fs.existsSync(stored));
    const absolute = ready && stored ? await stageSource(stored, staging) : stored;
    const soundRelative = storedSoundRelative(clip.soundRelative);
    const soundAbs = soundRelative ? path.join(dir, "flicks", flick.id, soundRelative) : "";
    const soundLocal = soundAbs && fs.existsSync(soundAbs) ? await stageSource(soundAbs, staging) : "";
    clips.push({
      id: clip.id,
      trackId: clip.trackId,
      startSec: clip.startSec,
      inSec: clip.inSec,
      outSec: clip.outSec,
      label: clip.label,
      line: clip.line,
      fileName: asset?.name,
      focus: clip.focus,
      src: absolute ? fileUrl(absolute) : undefined,
      soundSrc: soundLocal ? fileUrl(soundLocal) : undefined,
    });
  }
  const voiceAbs = flick.voiceRelative ? path.join(dir, "flicks", flick.id, flick.voiceRelative) : "";
  const voiceReady = Boolean(voiceAbs && fs.existsSync(voiceAbs));
  const voiceLocal = voiceReady ? await stageSource(voiceAbs, staging) : "";
  const musicAsset = channel.media.find((item) => item.id === flick.musicId);
  const musicAbs = resolveAsset(dir, musicAsset);
  const musicReady = Boolean(musicAbs && fs.existsSync(musicAbs));
  const musicLocal = musicReady && musicAbs ? await stageSource(musicAbs, staging) : "";
  return {
    fps: flick.fps,
    width: flick.width,
    height: flick.height,
    accent: channel.accent,
    headline: flick.headline,
    headlineColor: flick.headlineColor,
    accentWords: flick.accentWords,
    titleStroke: flick.titleStroke,
    showRank: flick.showRank,
    showCaptions: flick.showCaptions,
    titleFont: flick.titleFont,
    lineColor: flick.lineColor,
    lineSize: flick.lineSize,
    rankSize: flick.rankSize,
    rankColor: flick.rankColor,
    rankPlace: flick.rankPlace,
    linePlace: flick.linePlace,
    pictureWarmth: flick.pictureWarmth,
    regions: flick.regions,
    tracks: flick.tracks,
    clips,
    voiceSrc: voiceLocal ? fileUrl(voiceLocal) : undefined,
    voiceStartSec: styledVoiceStart(flick),
    musicSrc: musicLocal ? fileUrl(musicLocal) : undefined,
    musicCredit: musicLocal ? flick.musicCredit?.trim() || undefined : undefined,
    preview,
  };
}

async function exportFile(kind: "cut" | "styled", dir: string, flickId: string, outputPath: string) {
  const channel = watch(dir);
  const flick = readFlick(dir, flickId);
  const ids = usedMediaIds(flick);
  const media: MediaAsset[] = [];
  for (const asset of channel.media) {
    media.push(ids.has(asset.id) ? await localAsset(dir, asset) : asset);
  }
  const voiceStored = flick.voiceRelative ? path.join(dir, "flicks", flick.id, flick.voiceRelative) : "";
  const voiceFile = voiceStored && fs.existsSync(voiceStored) ? await stageSource(voiceStored, useStaging()) : undefined;
  if (kind === "cut") {
    const gpu = await probeGpu();
    if (!gpu.ffmpegPath || !gpu.chosenEncoder) throw new Error("ffmpeg is not available for cutting.");
    await exportCut({
      ffmpeg: gpu.ffmpegPath,
      encoder: gpu.chosenEncoder,
      channelDir: dir,
      flick,
      media,
      outputPath,
      voiceFile,
      soundFiles: await stagedSounds(dir, flick),
      videoBitrate: "8M",
    });
  } else {
    await renderFlick({
      entry: path.join(projectRoot(), "src/remotion/index.ts"),
      resourcesPath: process.resourcesPath,
      outputPath,
      props: await flickProps(dir, channel, flick, false),
      videoBitrate: "8M",
    });
  }
  return { ok: true as const, message: "Export ready.", outputPath };
}

function windowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

/** Keep the native file window in front of this app. On Windows it otherwise opens behind the window and looks like a silent failure. */
async function withDialogInFront<T>(parent: BrowserWindow | null, run: (parent: BrowserWindow) => Promise<T>): Promise<T> {
  if (!parent) throw new Error("Could not open the file window. The app window is not open.");
  if (parent.isMinimized()) parent.restore();
  parent.show();
  parent.focus();
  const wasOnTop = parent.isAlwaysOnTop();
  parent.setAlwaysOnTop(true);
  try {
    return await run(parent);
  } finally {
    if (!wasOnTop) parent.setAlwaysOnTop(false);
    if (!parent.isDestroyed()) parent.focus();
  }
}

async function importChosen(dir: string, mode: "copy" | "link", kind: "video" | "audio", parent: BrowserWindow | null) {
  try {
    const picked = await withDialogInFront(parent, (window) =>
      dialog.showOpenDialog(window, {
        title: kind === "audio" ? "Choose a sound" : "Choose a clip",
        properties: ["openFile"],
        filters: [
          kind === "audio"
            ? { name: "Audio", extensions: ["mp3", "m4a", "wav", "aac"] }
            : { name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] },
        ],
      }),
    );
    if (picked.canceled || !picked.filePaths[0]) return { ok: false as const, message: "No file chosen." };
    const gpu = await probeGpu();
    if (!gpu.ffmpegPath) throw new Error("ffmpeg is not available to read that file.");
    const info = await probeMedia(picked.filePaths[0], gpu.ffmpegPath);
    const asset = importMedia(dir, picked.filePaths[0], mode, info);
    const channel = watch(dir);
    const media = await present(dir, channel, new Set([asset.id]));
    const workingCopy = media.find((item) => item.id === asset.id)?.workingCopy ?? false;
    return { ok: true as const, message: asset.name, asset, media, workingCopy };
  } catch (error) {
    return fail(error);
  }
}

function registerIpc(): void {
  ipcMain.handle("gpu:probe", () => probeGpu());
  ipcMain.handle("recent:list", () => recentChannels());
  ipcMain.handle("dialog:directory", async (event) => {
    const result = await withDialogInFront(windowFor(event), (window) =>
      dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] }),
    );
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("dialog:video", async (event) => {
    const result = await withDialogInFront(windowFor(event), (window) =>
      dialog.showOpenDialog(window, {
        title: "Choose a clip",
        properties: ["openFile"],
        filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }],
      }),
    );
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("dialog:save", async (event, defaultPath: string) => {
    const target = path.normalize(String(defaultPath ?? ""));
    if (!target) throw new Error("Could not open the save window. There is no file name yet.");
    try {
      if (path.isAbsolute(target)) fs.mkdirSync(path.dirname(target), { recursive: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The save folder could not be created.";
      throw new Error(`Could not open the save window. ${reason}`);
    }
    const result = await withDialogInFront(windowFor(event), (window) =>
      dialog.showSaveDialog(window, {
        title: "Save vertical video",
        defaultPath: target,
        filters: [{ name: "MP4", extensions: ["mp4"] }],
      }),
    );
    return result.canceled ? null : result.filePath ?? null;
  });
  ipcMain.handle("channel:create", async (_event, parent: string, name: string) => {
    try {
      const created = createChannel(parent, name);
      watch(created.dir);
      return await payload(created.dir, created.channel);
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("channel:open", async (_event, dir: string) => {
    try {
      const channel = openChannel(dir);
      watch(dir);
      return await payload(dir, channel);
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("channel:update", async (_event, dir: string, patch: { name?: string; accent?: string }) => {
    try {
      const channel = updateChannel(dir, patch);
      watch(dir);
      return { ok: true as const, channel, media: await present(dir, channel) };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("flick:create", async (_event, dir: string, name: string, templateId: string) => {
    try {
      watch(dir);
      return { ok: true as const, flick: createFlick(dir, name, templateId) };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("flick:read", async (_event, dir: string, flickId: string) => {
    try {
      const channel = watch(dir);
      const flick = readFlick(dir, flickId);
      return {
        ...(await payload(dir, channel, usedMediaIds(flick))),
        flick,
        voicePreview: await voicePreview(dir, flick),
        soundPreviews: await soundPreviewMap(dir, flick),
      };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("flick:save", async (_event, dir: string, flick: Flick) => {
    try {
      watch(dir);
      return { ok: true as const, flick: saveFlick(dir, flick) };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("flick:addSound", async (_event, dir: string, flickId: string, clipId: string) => {
    try {
      const picked = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Audio", extensions: ["mp3", "m4a", "wav", "aac"] }],
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false as const, message: "No file chosen." };
      watch(dir);
      const flick = attachSound(dir, flickId, clipId, picked.filePaths[0]);
      const relative = storedSoundRelative(flick.clips.find((item) => item.id === clipId)?.soundRelative);
      const absolute = relative ? path.join(dir, "flicks", flick.id, relative) : "";
      const local = absolute && fs.existsSync(absolute) ? await stageSource(absolute, useStaging()) : "";
      return {
        ok: true as const,
        message: path.basename(picked.filePaths[0]),
        flick,
        clipId,
        previewUrl: local ? fileUrl(local) : undefined,
      };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("flick:clearSound", async (_event, dir: string, flickId: string, clipId: string) => {
    try {
      watch(dir);
      return { ok: true as const, message: "Sound removed.", flick: clearSound(dir, flickId, clipId), clipId };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("media:import", async (event, dir: string, mode: "copy" | "link") =>
    importChosen(dir, mode, "video", windowFor(event)),
  );
  ipcMain.handle("media:find", async (_event, dir: string, subject: string, count?: number) => {
    const cleanups: Array<() => void> = [];
    try {
      const want = subjectCount(count);
      const gpu = await probeGpu();
      if (!gpu.ffmpegPath) throw new Error("ffmpeg is not available to read that file.");
      const hits = await searchSubject(subject, path.join(userDir(), "bin"));
      const landed: { asset: MediaAsset; sourceUrl: string; title: string; inSec: number; outSec: number; focus: number }[] = [];
      let lastError = "No video clips for that subject.";
      for (const hit of hits) {
        if (landed.length >= want) break;
        try {
          const stored = storedClipFile(dir, hit.url);
          let file: string;
          let asset: MediaAsset | null = null;
          if (stored) {
            file = stored.file;
            asset = stored.asset;
          } else {
            const got = await downloadClip(hit.url, gpu.ffmpegPath, path.join(userDir(), "bin"));
            cleanups.push(got.cleanup);
            file = got.file;
          }
          const info = await probeMedia(file, gpu.ffmpegPath);
          if (info.width < 2 || info.height < 2 || info.durationSec < 0.4) {
            lastError = "That result was not a video.";
            continue;
          }
          if (info.durationSec > SHORT_CLIP_SEC) {
            lastError = "That clip is too long.";
            continue;
          }
          const cut = await trimToAction(file, gpu.ffmpegPath, info.durationSec);
          const kept = asset ?? importMedia(dir, file, "copy", info);
          landed.push({ asset: kept, sourceUrl: hit.url, title: hit.title, inSec: cut.inSec, outSec: cut.outSec, focus: cut.focus });
        } catch (error) {
          lastError = failureLine(error);
        }
      }
      if (!landed.length) throw new Error(lastError);
      const channel = watch(dir);
      const media = await present(dir, channel, new Set(landed.map((item) => item.asset.id)));
      const clips = landed.map((item) => {
        const resolved = media.find((row) => row.id === item.asset.id);
        return {
          mediaId: item.asset.id,
          mediaName: item.asset.name,
          previewUrl: resolved?.previewUrl ?? null,
          durationSec: item.asset.durationSec,
          sourceUrl: item.sourceUrl,
          title: item.title || item.asset.name,
          inSec: item.inSec,
          outSec: item.outSec,
          focus: item.focus,
          ...(resolved?.madeAt ? { madeAt: resolved.madeAt } : {}),
        };
      });
      const workingCopy = landed.some((item) => media.find((row) => row.id === item.asset.id)?.workingCopy);
      return {
        ok: true as const,
        message: clips.length === 1 ? "Found 1 clip." : `Found ${clips.length} clips.`,
        clips,
        media,
        workingCopy,
      };
    } catch (error) {
      return fail(error);
    } finally {
      for (const cleanup of cleanups) cleanup();
    }
  });
  ipcMain.handle("media:download", async (_event, dir: string, url: string, maxSec?: number) => {
    const cap = typeof maxSec === "number" && Number.isFinite(maxSec) && maxSec > 0 ? maxSec : 0;
    let cleanup = () => {};
    try {
      const gpu = await probeGpu();
      if (!gpu.ffmpegPath) throw new Error("ffmpeg is not available to read that file.");
      const stored = storedClipFile(dir, url);
      if (stored) {
        if (clipTooLong(stored.asset.durationSec, cap)) return { ok: false as const, message: "That clip is too long." };
        const channel = watch(dir);
        const media = await present(dir, channel, new Set([stored.asset.id]));
        const workingCopy = media.find((item) => item.id === stored.asset.id)?.workingCopy ?? false;
        return { ok: true as const, message: stored.asset.name, asset: stored.asset, media, workingCopy, sourceUrl: clipLink(url) };
      }
      const got = await downloadClip(url, gpu.ffmpegPath, path.join(userDir(), "bin"), cap || undefined);
      cleanup = got.cleanup;
      const info = await probeMedia(got.file, gpu.ffmpegPath);
      if (clipTooLong(info.durationSec, cap)) throw new Error("That clip is too long.");
      const asset = importMedia(dir, got.file, "copy", info);
      const channel = watch(dir);
      const media = await present(dir, channel, new Set([asset.id]));
      const workingCopy = media.find((item) => item.id === asset.id)?.workingCopy ?? false;
      return { ok: true as const, message: asset.name, asset, media, workingCopy, sourceUrl: clipLink(url) };
    } catch (error) {
      return fail(error);
    } finally {
      cleanup();
    }
  });
  ipcMain.handle("media:importAudio", async (event, dir: string) => importChosen(dir, "copy", "audio", windowFor(event)));
  ipcMain.handle("media:stage", async (_event, dir: string, assetId: string) => {
    try {
      const channel = watch(dir);
      if (!channel.media.some((item) => item.id === assetId)) throw new Error("That file is missing.");
      const media = await present(dir, channel, new Set([assetId]));
      return { ok: true as const, message: "Ready.", media };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("library:clean", async () => {
    try {
      const result = await cleanUnused(
        useStaging(),
        recentChannels().map((item) => item.path),
      );
      const copies = result.removedCopies.length;
      const exportsRemoved = result.removedExports.length;
      const message =
        copies || exportsRemoved
          ? `Removed ${copies} unused working ${copies === 1 ? "copy" : "copies"} and ${exportsRemoved} unfinished or numbered ${exportsRemoved === 1 ? "extra" : "extras"}.`
          : "Nothing unused to clean.";
      return { ok: true as const, message, removedCopies: copies, removedExports: exportsRemoved };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("settings:get", () => ({ stagingDir: useStaging() }));
  ipcMain.handle("settings:staging", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return { ok: false as const, message: "No folder chosen.", stagingDir: useStaging() };
    try {
      const next = setStagingDir(result.filePaths[0]);
      gate.stagingDir = next;
      return { ok: true as const, message: "Working copies stay in that folder.", stagingDir: next };
    } catch (error) {
      return { ...fail(error), stagingDir: useStaging() };
    }
  });
  ipcMain.handle("shelf:list", () => listShelf(userDir()));
  ipcMain.handle("shelf:use", async (_event, dir: string, id: string) => {
    try {
      const picked = shelfSource(userDir(), id);
      if (!picked) return { ok: false as const, message: "That saved file is missing." };
      const asset = importMedia(dir, picked.file, "copy", picked.item);
      const channel = watch(dir);
      const media = await present(dir, channel, new Set([asset.id]));
      const workingCopy = media.find((item) => item.id === asset.id)?.workingCopy ?? false;
      return {
        ok: true as const,
        message: asset.name,
        asset,
        media,
        workingCopy,
        kind: picked.item.kind,
        credit: picked.item.credit,
      };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("template:list", () => listTemplates());
  ipcMain.handle("template:save", async (_event, flick: Flick, name: string, replaceId?: string) => {
    try {
      return { ok: true as const, message: "Template saved.", template: saveTemplate(flick, name, replaceId) };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("connection:list", () => listConnections());
  ipcMain.handle("connection:save", async (_event, draft: ConnectionDraft) => {
    try {
      return { ok: true as const, message: "Saved. Test it before using it.", connection: saveConnection(draft) };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("connection:delete", async (_event, id: string) => {
    try {
      deleteConnection(id);
      return { ok: true as const, message: "Removed." };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("connection:test", async (_event, id: string) => {
    try {
      const connection = getConnection(id);
      const result = await testProvider(connection, connection.auth === "key" ? connectionKey(id) : null);
      const updated = markConnection(id, {
        connected: result.ok,
        statusNote: result.message,
        ...(result.voices ? { voices: result.voices } : {}),
        ...(result.voiceId ? { voiceId: result.voiceId } : {}),
      });
      return { ok: result.ok, message: result.message, connection: updated };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("connection:voice", async (_event, id: string, voiceId: string) => {
    try {
      return { ok: true as const, message: "Voice updated.", connection: markConnection(id, { voiceId }) };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("connection:hear", async (_event, id: string) => {
    try {
      const connection = getConnection(id);
      if (!connection.connected) throw new Error("Test this connection first.");
      const key = connectionKey(id);
      if (!key) throw new Error("Add an API key first.");
      const audio = await previewSpeech(connection, key);
      return { ok: true as const, message: "Playing.", audioBase64: audio.toString("base64") };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("ai:write", async (_event, connectionId: string, prompt: string) => {
    try {
      if (!prompt.trim() || prompt.length > 8000) throw new Error("That line request is empty.");
      const connection = getConnection(connectionId);
      if (!connection.connected) throw new Error("Test this connection first.");
      if (connection.kind === "elevenlabs" || connection.kind === "minimax") {
        throw new Error("ElevenLabs and MiniMax stay voice. Pick Claude, Codex, Grok, or Cursor.");
      }
      const text = await writeLine(connection, connectionKey(connectionId), prompt);
      return { ok: true as const, message: "Line written.", text };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("ai:ask", async (_event, connectionId: string, prompt: string) => {
    try {
      if (!prompt.trim() || prompt.length > 8000) throw new Error("That request is empty.");
      const connection = getConnection(connectionId);
      if (!connection.connected) throw new Error("Test this connection first.");
      if (connection.kind === "elevenlabs" || connection.kind === "minimax") {
        throw new Error("ElevenLabs and MiniMax stay voice. Pick Claude, Codex, Grok, or Cursor.");
      }
      const text = await askAssistant(connection, connectionKey(connectionId), prompt);
      return { ok: true as const, message: "Reply ready.", text };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("ai:voice", async (_event, connectionId: string, dir: string, flickId: string, text: string, startSec?: number) => {
    try {
      if (!text.trim()) throw new Error("Write a line before making a voice.");
      const connection = getConnection(connectionId);
      if (!connection.connected) throw new Error("Test this connection first.");
      const key = connectionKey(connectionId);
      if (!key) throw new Error("Add an API key first.");
      watch(dir);
      const dest = path.join(dir, "flicks", flickId, "voice.mp3");
      await synthesize(connection, key, text.trim(), dest);
      const flick = readFlick(dir, flickId);
      flick.voiceRelative = "voice.mp3";
      flick.voiceStartSec = storedVoiceStart(startSec);
      saveFlick(dir, flick);
      const local = await stageSource(dest, useStaging());
      return {
        ok: true as const,
        message: "Voice saved.",
        relativePath: "voice.mp3",
        previewUrl: fileUrl(local),
        voiceStartSec: flick.voiceStartSec,
      };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("voice:narration", async (_event, dir: string, flickId: string, data: unknown, mime: string) => {
    try {
      const bytes = narrationBytes(data);
      const gpu = await probeGpu();
      if (!gpu.ffmpegPath) throw new Error("ffmpeg is not available to save the narration.");
      watch(dir);
      const dest = await writeNarration(gpu.ffmpegPath, dir, flickId, bytes, String(mime ?? ""));
      const flick = readFlick(dir, flickId);
      flick.voiceRelative = "voice.mp3";
      saveFlick(dir, flick);
      const local = await stageSource(dest, useStaging());
      return {
        ok: true as const,
        message: "Narration saved.",
        relativePath: "voice.mp3",
        previewUrl: fileUrl(local),
        voiceStartSec: flick.voiceStartSec,
      };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("export:cut", async (_event, dir: string, flickId: string, outputPath: string) => {
    try {
      return await exportFile("cut", dir, flickId, outputPath);
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("export:styled", async (_event, dir: string, flickId: string, outputPath: string) => {
    try {
      return await exportFile("styled", dir, flickId, outputPath);
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("recents:forget", async (_event, dir: string) => {
    try {
      forgetRecent(dir);
      return { ok: true as const, message: "Removed." };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("channel:rename", async (_event, dir: string, name: string) => {
    try {
      const channel = updateChannel(dir, { name });
      watch(dir);
      return { ok: true as const, channel, media: await present(dir, channel) };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("flick:duplicate", async (_event, dir: string, flickId: string) => {
    try {
      watch(dir);
      return { ok: true as const, flick: duplicateFlick(dir, flickId) };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("flick:delete", async (_event, dir: string, flickId: string) => {
    try {
      watch(dir);
      deleteFlick(dir, flickId);
      const channel = watch(dir);
      return { ok: true as const, message: "Removed.", channel };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("media:remove", async (_event, dir: string, mediaId: string) => {
    try {
      const channel = watch(dir);
      const asset = channel.media.find((item) => item.id === mediaId);
      if (!asset) throw new Error("That file is missing.");
      for (const summary of channel.flicks) {
        const flick = readFlick(dir, summary.id);
        if (flick.clips.some((clip) => clip.mediaId === mediaId)) throw new Error("That file is still on a flick.");
      }
      const file = resolveAsset(dir, asset);
      removeMedia(dir, mediaId);
      if (file && fileInside(dir, file) && fs.existsSync(file)) fs.rmSync(file, { force: true });
      const next = watch(dir);
      return { ok: true as const, message: "Removed.", media: await present(dir, next) };
    } catch (error) {
      return fail(error);
    }
  });
}

function appIcon(): NativeImage | undefined {
  const candidates = [
    path.join(process.resourcesPath, "icon.png"),
    path.join(__dirname, "../build/icon.png"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image;
  }
  return undefined;
}

function fittedWindow(): { x: number; y: number; width: number; height: number; minWidth: number; minHeight: number } {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1280, area.width);
  const height = Math.min(800, area.height);
  return {
    x: area.x + Math.max(0, Math.round((area.width - width) / 2)),
    y: area.y + Math.max(0, Math.round((area.height - height) / 2)),
    width,
    height,
    minWidth: Math.min(960, width),
    minHeight: Math.min(640, height),
  };
}

async function createWindow(): Promise<void> {
  const icon = appIcon();
  if (icon) app.dock?.setIcon(icon);
  const fitted = fittedWindow();
  const window = new BrowserWindow({
    x: fitted.x,
    y: fitted.y,
    width: fitted.width,
    height: fitted.height,
    minWidth: fitted.minWidth,
    minHeight: fitted.minHeight,
    backgroundColor: "#f7f3ea",
    title: "Go7Flicks",
    show: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const mediaSession = window.webContents.session;
  mediaSession.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    if (permission !== "media") return true;
    return allowsMicrophone(permission, details.mediaType ? [details.mediaType] : undefined);
  });
  mediaSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const types = "mediaTypes" in details ? details.mediaTypes : undefined;
    callback(allowsMicrophone(permission, types));
  });
  window.webContents.on("console-message", (_event, _level, message) => {
    if (/error|uncaught|failed/i.test(message)) console.error(message);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(async () => {
  try {
    const added = seedMachineAccounts();
    if (added.length) console.log(`Connections ready: ${added.join(", ")}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not prepare connections.");
  }
  mediaBase = await startMediaServer(gate);
  gate.stagingDir = stagingDir();
  registerIpc();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
