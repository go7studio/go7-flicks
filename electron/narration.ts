import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { refusesKeeper } from "../scripts/cut-checks";

const exec = promisify(execFile);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 40 * 1024 * 1024;

/** Grant the page microphone. Leave every other permission on the previous default. */
export function allowsMicrophone(permission: string, mediaTypes?: readonly string[]): boolean {
  if (permission !== "media") return false;
  if (!mediaTypes || mediaTypes.length === 0) return true;
  return mediaTypes.every((type) => type === "audio" || type === "unknown");
}

export function narrationExtension(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes("webm")) return ".webm";
  if (lower.includes("ogg")) return ".ogg";
  if (lower.includes("wav")) return ".wav";
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) return ".m4a";
  if (lower.includes("mpeg") || lower.includes("mp3")) return ".mp3";
  return ".webm";
}

/** The flick voice file Make voice already writes. Refuses the kept parkour narration. */
export function narrationFile(dir: string, flickId: string): string {
  if (!ID.test(flickId)) throw new Error("Bad id.");
  const root = path.resolve(dir);
  const dest = path.resolve(root, "flicks", flickId, "voice.mp3");
  const relative = path.relative(root, dest);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("That narration path is not in this channel.");
  if (refusesKeeper(dest)) throw new Error("That narration file is kept.");
  return dest;
}

export function narrationBytes(data: unknown): Buffer {
  if (typeof data === "string") {
    const clean = data.trim();
    if (!clean) throw new Error("The recording was empty.");
    const bytes = Buffer.from(clean, "base64");
    if (!bytes.length) throw new Error("The recording was empty.");
    if (bytes.length > MAX_BYTES) throw new Error("That recording is too long.");
    return bytes;
  }
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    const bytes = Buffer.from(data);
    if (!bytes.length) throw new Error("The recording was empty.");
    if (bytes.length > MAX_BYTES) throw new Error("That recording is too long.");
    return bytes;
  }
  throw new Error("The recording was empty.");
}

/** ffmpeg turns the browser recording into the flick voice.mp3. */
export async function writeNarration(ffmpegPath: string, dir: string, flickId: string, bytes: Buffer, mime: string): Promise<string> {
  if (!bytes.length) throw new Error("The recording was empty.");
  if (bytes.length > MAX_BYTES) throw new Error("That recording is too long.");
  const dest = narrationFile(dir, flickId);
  if (!ffmpegPath) throw new Error("ffmpeg is not available to save the narration.");
  const folder = path.dirname(dest);
  if (!fs.existsSync(path.join(folder, "flick.json"))) throw new Error("That flick is missing.");
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "go7-narration-"));
  const source = path.join(tempRoot, `take${narrationExtension(mime)}`);
  const part = path.join(tempRoot, "voice.mp3");
  try {
    await fs.promises.writeFile(source, bytes);
    try {
      await exec(
        ffmpegPath,
        ["-y", "-i", source, "-vn", "-acodec", "libmp3lame", "-q:a", "4", part],
        { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      );
    } catch (error) {
      const failed = error as { stderr?: string };
      const line = typeof failed.stderr === "string" ? failed.stderr.trim().split(/\r?\n/).filter(Boolean).pop() : "";
      throw new Error(line ? `Could not save the narration. ${line}` : "Could not save the narration.");
    }
    const stat = await fs.promises.stat(part);
    if (!stat.isFile() || stat.size < 128) throw new Error("The recording could not be saved.");
    await fs.promises.copyFile(part, dest);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
  return dest;
}
