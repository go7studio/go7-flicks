import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { exportCut, resolveAsset } from "./cut";
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
  readFlick,
  recentChannels,
  saveConnection,
  saveFlick,
  saveTemplate,
  updateChannel,
} from "./library";
import { startMediaServer, type MediaGate } from "./media-server";
import { probeGpu, probeMedia } from "./probe";
import { synthesize, testProvider, writeLine } from "./providers";
import { renderFlick } from "./styled";
import type { FlickProps } from "../src/remotion/FlickComposition";
import type { ChannelFile, ConnectionDraft, Flick } from "../src/shared/model";

const gate: MediaGate = { channelDir: null, channel: null };
let mediaBase = "";

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

function present(dir: string, channel: ChannelFile) {
  return channel.media.map((asset) => {
    const absolutePath = resolveAsset(dir, asset) ?? "";
    const missing = !absolutePath || !fs.existsSync(absolutePath);
    return {
      ...asset,
      absolutePath,
      missing,
      previewUrl: missing ? null : `${mediaBase}/file?path=${encodeURIComponent(absolutePath)}`,
    };
  });
}

function payload(dir: string, channel: ChannelFile) {
  return { ok: true as const, dir, channel, media: present(dir, channel), mediaBase };
}

function voicePreview(dir: string, flick: Flick): string | null {
  if (flick.voiceRelative !== "voice.mp3") return null;
  const absolute = path.join(dir, "flicks", flick.id, "voice.mp3");
  if (!fs.existsSync(absolute)) return null;
  return `${mediaBase}/file?path=${encodeURIComponent(absolute)}`;
}

function flickProps(dir: string, channel: ChannelFile, flick: Flick, preview: boolean): FlickProps {
  const clips = flick.clips.map((clip) => {
    const asset = channel.media.find((item) => item.id === clip.mediaId);
    const absolute = resolveAsset(dir, asset);
    const ready = Boolean(absolute && fs.existsSync(absolute));
    return {
      id: clip.id,
      trackId: clip.trackId,
      startSec: clip.startSec,
      inSec: clip.inSec,
      outSec: clip.outSec,
      label: clip.label,
      line: clip.line,
      src: ready ? `${mediaBase}/file?path=${encodeURIComponent(absolute as string)}` : undefined,
    };
  });
  const voiceAbs = flick.voiceRelative ? path.join(dir, "flicks", flick.id, flick.voiceRelative) : "";
  const voiceReady = Boolean(voiceAbs && fs.existsSync(voiceAbs));
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
    regions: flick.regions,
    tracks: flick.tracks,
    clips,
    voiceSrc: voiceReady ? `${mediaBase}/file?path=${encodeURIComponent(voiceAbs)}` : undefined,
    preview,
  };
}

async function exportFile(kind: "cut" | "styled", dir: string, flickId: string, outputPath: string) {
  const channel = watch(dir);
  const flick = readFlick(dir, flickId);
  if (kind === "cut") {
    const gpu = await probeGpu();
    if (!gpu.ffmpegPath || !gpu.chosenEncoder) throw new Error("ffmpeg is not available for cutting.");
    await exportCut({
      ffmpeg: gpu.ffmpegPath,
      encoder: gpu.chosenEncoder,
      channelDir: dir,
      flick,
      media: channel.media,
      outputPath,
    });
  } else {
    await renderFlick({
      entry: path.join(projectRoot(), "src/remotion/index.ts"),
      resourcesPath: process.resourcesPath,
      outputPath,
      props: flickProps(dir, channel, flick, false),
    });
  }
  return { ok: true as const, message: "Export ready.", outputPath };
}

function registerIpc(): void {
  ipcMain.handle("gpu:probe", () => probeGpu());
  ipcMain.handle("recent:list", () => recentChannels());
  ipcMain.handle("dialog:directory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("dialog:video", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("dialog:save", async (_event, defaultPath: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  });
  ipcMain.handle("channel:create", async (_event, parent: string, name: string) => {
    try {
      const created = createChannel(parent, name);
      watch(created.dir);
      return payload(created.dir, created.channel);
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("channel:open", async (_event, dir: string) => {
    try {
      const channel = openChannel(dir);
      watch(dir);
      return payload(dir, channel);
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("channel:update", async (_event, dir: string, patch: { name?: string; accent?: string }) => {
    try {
      const channel = updateChannel(dir, patch);
      watch(dir);
      return { ok: true as const, channel, media: present(dir, channel) };
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
      return { ...payload(dir, channel), flick, voicePreview: voicePreview(dir, flick) };
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
  ipcMain.handle("media:import", async (_event, dir: string, mode: "copy" | "link") => {
    try {
      const picked = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }],
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, message: "No file chosen." };
      const gpu = await probeGpu();
      if (!gpu.ffmpegPath) throw new Error("ffmpeg is not available to read that video.");
      const info = await probeMedia(picked.filePaths[0], gpu.ffmpegPath);
      const asset = importMedia(dir, picked.filePaths[0], mode, info);
      const channel = watch(dir);
      return { ok: true as const, message: asset.name, asset, media: present(dir, channel) };
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
  ipcMain.handle("ai:write", async (_event, connectionId: string, prompt: string) => {
    try {
      if (!prompt.trim() || prompt.length > 8000) throw new Error("That line request is empty.");
      const connection = getConnection(connectionId);
      if (!connection.connected) throw new Error("Test this connection first.");
      if (connection.kind === "elevenlabs") throw new Error("Pick a chat connection, not ElevenLabs.");
      const text = await writeLine(connection, connectionKey(connectionId), prompt);
      return { ok: true as const, message: "Line written.", text };
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle("ai:voice", async (_event, connectionId: string, dir: string, flickId: string, text: string) => {
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
      saveFlick(dir, flick);
      return {
        ok: true as const,
        message: "Voice saved.",
        relativePath: "voice.mp3",
        previewUrl: `${mediaBase}/file?path=${encodeURIComponent(dest)}`,
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
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#10110f",
    title: "Go7Flicks",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.webContents.on("console-message", (_event, _level, message) => {
    if (/error|uncaught|failed/i.test(message)) console.error(message);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(async () => {
  mediaBase = await startMediaServer(gate);
  registerIpc();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
