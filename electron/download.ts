import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { clipLink } from "../src/shared/link";
import { clipsFromSearch, pickSubjectClips, subjectQuery, SUBJECT_CANDIDATE_COUNT, type SubjectHit } from "../src/shared/subject";

const exec = promisify(execFile);

const RELEASE: Record<string, { name: string; url: string }> = {
  win32: { name: "yt-dlp.exe", url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" },
  darwin: { name: "yt-dlp", url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" },
  linux: { name: "yt-dlp", url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" },
};

export async function ytdlpPath(binDir: string): Promise<string> {
  const fromEnv = process.env.GO7FLICKS_YTDLP;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const onPath = lookup("yt-dlp")[0];
  if (onPath) return onPath;
  const spec = RELEASE[process.platform] ?? RELEASE.linux;
  const dest = path.join(binDir, spec.name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) return dest;
  fs.mkdirSync(binDir, { recursive: true });
  const response = await fetch(spec.url, { redirect: "follow" });
  if (!response.ok) throw new Error(response.statusText || `Downloader setup stopped (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000) throw new Error("The downloader file came back incomplete.");
  const partial = `${dest}.part`;
  fs.writeFileSync(partial, bytes);
  fs.renameSync(partial, dest);
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
  return dest;
}

export type DownloadStep = "stored" | "preferred" | "fallback";

const SKIP_EXT = new Set([".part", ".ytdl", ".json", ".jpg", ".jpeg", ".png", ".webp", ".vtt", ".srt"]);
const FORMAT_FRAGMENT = /\.f\d+\.[^.]+$/i;

/** A merged file can be kept. A .part file or an unmerged format fragment cannot. */
export function isFinishedDownload(file: string): boolean {
  const name = path.basename(file);
  if (/\.part(?:$|\.)/i.test(name) || /\.ytdl$/i.test(name) || /\.temp\./i.test(name)) return false;
  if (FORMAT_FRAGMENT.test(name)) return false;
  const ext = path.extname(name).toLowerCase();
  return Boolean(ext) && !SKIP_EXT.has(ext);
}

/** The finished mp4 wins. Partials and unmerged streams do not. */
export function chooseFinishedDownload(names: string[]): string | null {
  const ready = names.filter((name) => isFinishedDownload(name));
  const mp4 = ready.filter((name) => {
    const ext = path.extname(name).toLowerCase();
    return ext === ".mp4" || ext === ".m4v";
  });
  return (mp4.length ? mp4 : ready)[0] ?? null;
}

/** A finished file already in the folder stays. A partial or a missing preferred format tries again. */
export function downloadStep(existingFile: string | null, preferredFailed: boolean): DownloadStep {
  if (existingFile && isFinishedDownload(existingFile)) return "stored";
  return preferredFailed ? "fallback" : "preferred";
}

/** Prefer MP4, H.264, about 1080p, AAC. The fallback omits that sort so some file still comes back. */
export function ytdlpDownloadArgs(input: {
  ffmpegPath: string;
  outputTemplate: string;
  link: string;
  preferred: boolean;
  /** When set, yt-dlp skips the video before downloading anything longer. */
  maxSec?: number;
}): string[] {
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--no-overwrites",
    "--ffmpeg-location",
    path.dirname(input.ffmpegPath),
    "-o",
    input.outputTemplate,
  ];
  if (input.preferred) args.push("--merge-output-format", "mp4", "-S", "vcodec:h264,res:1080,acodec:m4a");
  if (input.maxSec && input.maxSec > 0) args.push("--match-filter", `duration <= ${input.maxSec}`);
  args.push(input.link);
  return args;
}

/** A positive cap rejects a file that runs longer than Find clips allows. */
export function clipTooLong(durationSec: number, maxSec?: number): boolean {
  return typeof maxSec === "number" && maxSec > 0 && durationSec > maxSec;
}

export function searchArgs(target: string): string[] {
  return [
    "--flat-playlist",
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    "--encoding",
    "utf-8",
    "--playlist-end",
    "40",
    target,
  ];
}

export async function downloadClip(
  url: string,
  ffmpegPath: string,
  binDir: string,
  maxSec?: number,
): Promise<{ file: string; cleanup: () => void }> {
  const link = clipLink(url);
  const bin = await ytdlpPath(binDir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go7flicks-get-"));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const outputTemplate = path.join(dir, "%(title).80s.%(ext)s");
  const run = (preferred: boolean) =>
    exec(bin, ytdlpDownloadArgs({ ffmpegPath, outputTemplate, link, preferred, maxSec }), {
      timeout: 15 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
  try {
    if (downloadStep(pickedFile(dir), false) === "preferred") {
      try {
        await run(true);
      } catch {
        if (downloadStep(pickedFile(dir), true) === "fallback") await run(false);
      }
    }
  } catch (error) {
    cleanup();
    const line = toolMessage(error);
    if (maxSec && maxSec > 0 && /does not pass filter|match filter/i.test(line)) throw new Error("That clip is too long.");
    throw new Error(line);
  }
  const file = pickedFile(dir);
  if (!file) {
    cleanup();
    throw new Error("The download finished without a file.");
  }
  return { file, cleanup };
}

/** YouTube's own "under 4 minutes" search filter, so the list prefers a short clip. */
const SHORT_SEARCH = "EgQQARgB";

export async function searchSubject(subject: string, binDir: string): Promise<SubjectHit[]> {
  const query = subjectQuery(subject);
  const bin = await ytdlpPath(binDir);
  const errors: string[] = [];
  let hits: SubjectHit[] = [];
  const shortUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${SHORT_SEARCH}`;
  try {
    hits = await listSearch(bin, shortUrl);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "The search stopped.");
  }
  if (pickSubjectClips(hits, SUBJECT_CANDIDATE_COUNT, query).length < SUBJECT_CANDIDATE_COUNT) {
    try {
      const more = await listSearch(bin, `ytsearch40:${query}`);
      const seen = new Set(hits.map((hit) => hit.url));
      for (const hit of more) {
        if (seen.has(hit.url)) continue;
        hits.push(hit);
        seen.add(hit.url);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "The search stopped.");
    }
  }
  const picked = pickSubjectClips(hits, SUBJECT_CANDIDATE_COUNT, query);
  if (!picked.length) throw new Error(errors.at(-1) || "No video clips for that subject.");
  return picked;
}

async function listSearch(bin: string, target: string): Promise<SubjectHit[]> {
  let result: { stdout: string };
  try {
    result = await exec(bin, searchArgs(target), {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(toolMessage(error));
  }
  const text = result.stdout ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No video clips for that subject.");
  return clipsFromSearch(JSON.parse(text.slice(start, end + 1)));
}

function pickedFile(dir: string): string | null {
  const names = fs.readdirSync(dir).filter((name) => isFinishedDownload(name));
  if (!names.length) return null;
  const mp4 = names.filter((name) => {
    const ext = path.extname(name).toLowerCase();
    return ext === ".mp4" || ext === ".m4v";
  });
  const pool = mp4.length ? mp4 : names;
  pool.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size);
  return path.join(dir, pool[0]);
}

function toolMessage(error: unknown): string {
  const failed = error as { stdout?: string; stderr?: string; message?: string };
  const lines = `${failed.stderr ?? ""}\n${failed.stdout ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const reported = [...lines].reverse().find((line) => /^ERROR:/i.test(line));
  if (reported) return reported.replace(/^ERROR:\s*/i, "");
  const last = lines.at(-1);
  if (last) return last;
  return failed.message || "The download stopped.";
}

function lookup(command: string): string[] {
  try {
    const tool = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(tool, [command], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && fs.existsSync(line));
  } catch {
    return [];
  }
}
