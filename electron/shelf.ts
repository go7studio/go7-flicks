import fs from "node:fs";
import path from "node:path";
import { uid, type ShelfEntry, type ShelfKind } from "../src/shared/model";

export type { ShelfEntry };

type StoredShelfItem = ShelfEntry & {
  bytes: number;
  relativePath?: string;
  absolutePath?: string;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function rememberShelf(
  root: string,
  source: string,
  info: { name?: string; durationSec: number; width: number; height: number; codec: string },
  mode: "copy" | "link",
): ShelfEntry {
  const stat = fs.statSync(source);
  if (!stat.isFile()) throw new Error("That file is missing.");
  const name = info.name?.trim() || path.basename(source);
  const kind: ShelfKind = info.width > 0 || info.height > 0 ? "video" : "audio";
  const items = readItems(root);
  const existing = items.find(
    (item) => item.name === name && item.bytes === stat.size && item.durationSec === info.durationSec && item.kind === kind,
  );
  if (existing && fileFor(root, existing)) return publish(existing);
  const id = uid();
  const stored: StoredShelfItem = {
    id,
    name,
    kind,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    codec: info.codec,
    bytes: stat.size,
  };
  if (mode === "link") {
    stored.absolutePath = path.resolve(source);
  } else {
    const ext = path.extname(source);
    const relativePath = path.posix.join("shelf", `${id}${ext}`);
    fs.mkdirSync(path.join(root, "shelf"), { recursive: true });
    fs.copyFileSync(source, path.join(root, "shelf", `${id}${ext}`));
    stored.relativePath = relativePath;
  }
  items.unshift(stored);
  writeItems(root, items.slice(0, 80));
  return publish(stored);
}

export function listShelf(root: string): ShelfEntry[] {
  return readItems(root)
    .filter((item) => fileFor(root, item))
    .map(publish);
}

export function shelfSource(root: string, id: string): { file: string; item: ShelfEntry } | null {
  if (!ID.test(id)) return null;
  const stored = readItems(root).find((item) => item.id === id);
  if (!stored) return null;
  const file = fileFor(root, stored);
  if (!file) return null;
  return { file, item: publish(stored) };
}

export function noteShelfCredit(root: string, match: { name: string; bytes: number; durationSec: number }, credit: string): void {
  const trimmed = credit.trim();
  if (!trimmed) return;
  const items = readItems(root);
  const found = items.find(
    (item) => item.kind === "audio" && item.name === match.name && item.bytes === match.bytes && item.durationSec === match.durationSec,
  );
  if (!found || found.credit === trimmed) return;
  found.credit = trimmed;
  writeItems(root, items);
}

function publish(item: StoredShelfItem): ShelfEntry {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    durationSec: item.durationSec,
    width: item.width,
    height: item.height,
    codec: item.codec,
    credit: item.credit?.trim() || undefined,
  };
}

function fileFor(root: string, item: StoredShelfItem): string | null {
  if (item.relativePath) {
    const file = path.resolve(root, item.relativePath);
    const shelf = path.resolve(root, "shelf");
    if (!file.startsWith(`${shelf}${path.sep}`) || !fs.existsSync(file)) return null;
    return file;
  }
  if (item.absolutePath && fs.existsSync(item.absolutePath)) return item.absolutePath;
  return null;
}

function readItems(root: string): StoredShelfItem[] {
  const file = path.join(root, "shelf.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredShelfItem[];
  return Array.isArray(parsed) ? parsed.filter((item) => item && ID.test(item.id) && item.name && item.bytes > 0) : [];
}

function writeItems(root: string, items: StoredShelfItem[]): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "shelf.json"), JSON.stringify(items, null, 2));
}
