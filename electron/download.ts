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

export async function downloadClip(url: string, ffmpegPath: string, binDir: string): Promise<{ file: string; cleanup: () => void }> {
  const link = clipLink(url);
  const bin = await ytdlpPath(binDir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go7flicks-get-"));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    await exec(
      bin,
      [
        "--no-playlist",
        "--restrict-filenames",
        "--ffmpeg-location",
        path.dirname(ffmpegPath),
        "-o",
        path.join(dir, "%(title).80s.%(ext)s"),
        link,
      ],
      { timeout: 15 * 60 * 1000, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
    );
  } catch (error) {
    cleanup();
    throw new Error(toolMessage(error));
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
    result = await exec(
      bin,
      ["--flat-playlist", "--dump-single-json", "--skip-download", "--no-warnings", "--playlist-end", "40", target],
      { timeout: 90_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
    );
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
  const names = fs.readdirSync(dir).filter((name) => {
    const ext = path.extname(name).toLowerCase();
    return ext && ![".part", ".ytdl", ".json", ".jpg", ".jpeg", ".png", ".webp", ".vtt", ".srt"].includes(ext);
  });
  if (!names.length) return null;
  names.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size);
  return path.join(dir, names[0]);
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
