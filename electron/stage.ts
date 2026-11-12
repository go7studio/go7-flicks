import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type FileCopier = (source: string, dest: string) => Promise<void>;

type Stamp = {
  source: string;
  size: number;
  mtimeMs: number;
};

type IndexEntry = {
  dest: string;
  size: number;
  mtimeMs: number;
};

const driveCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let indexChain: Promise<void> = Promise.resolve();
let readDriveType: (letter: string) => string = windowsDriveType;
let copyFileImpl: FileCopier = (source, dest) => fs.promises.copyFile(source, dest);

export function setDriveTypeReader(reader: ((letter: string) => string) | null): void {
  readDriveType = reader ?? windowsDriveType;
  driveCache.clear();
}

export function setFileCopier(next: FileCopier | null): void {
  copyFileImpl = next ?? ((source, dest) => fs.promises.copyFile(source, dest));
}

export function isNetworkPath(filePath: string): boolean {
  const win = filePath.replaceAll("/", "\\");
  if (win.startsWith("\\\\?\\UNC\\") || win.startsWith("\\\\.\\UNC\\")) return true;
  const extended = /^\\\\\?\\([A-Za-z]):/.exec(win);
  if (extended) return networkLetter(extended[1]);
  if (win.startsWith("\\\\")) return true;
  const letter = /^([A-Za-z]):/.exec(win);
  if (!letter) return false;
  return networkLetter(letter[1]);
}

export function stagedPathIfReady(source: string, stagingDir: string): string | null {
  const resolved = path.resolve(source);
  if (!isNetworkPath(resolved)) return null;
  const entry = readIndex(stagingDir)[resolved];
  if (!entry || !fs.existsSync(entry.dest)) return null;
  if (fs.statSync(entry.dest).size !== entry.size) return null;
  return entry.dest;
}

export async function stageSource(source: string, stagingDir: string): Promise<string> {
  const resolved = path.resolve(source);
  if (!isNetworkPath(resolved)) return resolved;
  if (!fs.existsSync(resolved)) throw new Error("That file is missing.");
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("That file is missing.");
  const size = stat.size;
  const mtimeMs = Math.round(stat.mtimeMs);
  const key = cacheKey(resolved, size, mtimeMs);
  const flight = `${path.resolve(stagingDir)}\0${key}`;
  const pending = inflight.get(flight);
  if (pending) return pending;
  const job = writeStaged(resolved, stagingDir, key, size, mtimeMs);
  inflight.set(flight, job);
  try {
    return await job;
  } finally {
    inflight.delete(flight);
  }
}

async function writeStaged(resolved: string, stagingDir: string, key: string, size: number, mtimeMs: number): Promise<string> {
  await fs.promises.mkdir(stagingDir, { recursive: true });
  const ext = path.extname(resolved);
  const dest = path.join(stagingDir, `${key}${ext}`);
  const stampFile = path.join(stagingDir, `${key}.stamp`);
  if (stampMatches(dest, stampFile, resolved, size, mtimeMs)) {
    await remember(stagingDir, resolved, dest, size, mtimeMs);
    return dest;
  }
  const tmp = path.join(stagingDir, `${key}.${process.pid}.${Date.now()}.partial`);
  try {
    await copyFileImpl(resolved, tmp);
    const copied = await fs.promises.stat(tmp);
    if (copied.size !== size) throw new Error("The copy onto this computer stopped early.");
    if (fs.existsSync(dest)) await fs.promises.rm(dest, { force: true });
    await fs.promises.rename(tmp, dest);
    await fs.promises.writeFile(stampFile, JSON.stringify({ source: resolved, size, mtimeMs } satisfies Stamp));
    await remember(stagingDir, resolved, dest, size, mtimeMs);
    return dest;
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function stampMatches(dest: string, stampFile: string, source: string, size: number, mtimeMs: number): boolean {
  if (!fs.existsSync(dest) || !fs.existsSync(stampFile)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(stampFile, "utf8")) as Stamp;
    if (saved.source !== source || saved.size !== size || saved.mtimeMs !== mtimeMs) return false;
    return fs.statSync(dest).size === size;
  } catch {
    return false;
  }
}

function remember(stagingDir: string, source: string, dest: string, size: number, mtimeMs: number): Promise<void> {
  const run = indexChain.then(() => {
    const index = readIndex(stagingDir);
    index[source] = { dest, size, mtimeMs };
    const file = path.join(stagingDir, "index.json");
    const tmp = path.join(stagingDir, `index.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(index));
    fs.renameSync(tmp, file);
  });
  indexChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readIndex(stagingDir: string): Record<string, IndexEntry> {
  const file = path.join(stagingDir, "index.json");
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, IndexEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function forgetUnusedCopies(
  stagingDir: string,
  used: ReadonlySet<string>,
  protectPrefixes: readonly string[] = [],
): Promise<{ removed: string[]; kept: number }> {
  const root = stagingDir.trim() ? path.resolve(stagingDir) : "";
  if (!root || isNetworkPath(root) || !fs.existsSync(root)) return Promise.resolve({ removed: [], kept: 0 });
  const run = indexChain.then(() => dropUnused(root, used, protectPrefixes));
  indexChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function dropUnused(root: string, used: ReadonlySet<string>, protectPrefixes: readonly string[]): { removed: string[]; kept: number } {
  const index = readIndex(root);
  const next: Record<string, IndexEntry> = {};
  const removed: string[] = [];
  let kept = 0;
  for (const [source, entry] of Object.entries(index)) {
    const sourcePath = path.resolve(source);
    const dest = entry?.dest ? path.resolve(entry.dest) : "";
    const keep =
      used.has(sourcePath) ||
      (dest && used.has(dest)) ||
      protectPrefixes.some((prefix) => insideDir(sourcePath, prefix) || (dest && insideDir(dest, prefix))) ||
      !dest ||
      !insideDir(dest, root);
    if (keep) {
      next[source] = entry;
      kept += 1;
      continue;
    }
    if (fs.existsSync(dest) && fs.statSync(dest).isFile()) fs.rmSync(dest, { force: true });
    const stamp = path.join(root, `${path.basename(dest, path.extname(dest))}.stamp`);
    if (insideDir(stamp, root) && fs.existsSync(stamp)) fs.rmSync(stamp, { force: true });
    removed.push(path.basename(dest));
  }
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith(".partial")) continue;
      const full = path.join(root, name);
      if (!fs.statSync(full).isFile()) continue;
      fs.rmSync(full, { force: true });
      removed.push(name);
    }
  }
  const file = path.join(root, "index.json");
  const tmp = path.join(root, `index.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, file);
  return { removed, kept };
}

function insideDir(file: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function cacheKey(source: string, size: number, mtimeMs: number): string {
  return crypto.createHash("sha256").update(`${source}\0${size}\0${mtimeMs}`).digest("hex");
}

function networkLetter(letter: string): boolean {
  return /network/i.test(driveType(letter));
}

function driveType(letter: string): string {
  const key = letter.toUpperCase();
  const cached = driveCache.get(key);
  if (cached !== undefined) return cached;
  const value = readDriveType(key);
  driveCache.set(key, value);
  return value;
}

function windowsDriveType(letter: string): string {
  if (process.platform !== "win32") return "Fixed Drive";
  try {
    return execFileSync("fsutil", ["fsinfo", "drivetype", `${letter}:`], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
  } catch {
    return "Fixed Drive";
  }
}
