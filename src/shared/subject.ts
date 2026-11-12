import { pictureFocus } from "./action";

/** How many clips Find clips downloads for one subject. */
export const SUBJECT_CLIP_COUNT = 3;

export const SUBJECT_CANDIDATE_COUNT = 12;
const MAX_SEC = 90;
const SKIP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "your", "into", "best", "most", "top", "ever", "very"]);
const OFF_SUBJECT = [
  /\batlas\b/i,
  /boston dynamics/i,
  /\brobots?\b/i,
  /\brobotics\b/i,
  /\bnews\b/i,
  /\binterview\b/i,
  /building collapse/i,
  /\bcompilations?\b/i,
  /\bmontage\b/i,
  /world'?s best/i,
  /fail army/i,
  /\btop \d+\b/i,
  /\bbest of\b/i,
  /assassin'?s creed/i,
  /\bmoments\b/i,
  /caught on camera/i,
  /caught on .+ camera/i,
  /\bfurbo\b/i,
];
const VIDEO_ID = /^[\w-]{11}$/;

export type SubjectHit = {
  url: string;
  title: string;
  durationSec: number | null;
};

export type FoundClip = {
  mediaId: string;
  mediaName: string;
  previewUrl: string | null;
  durationSec: number;
  sourceUrl: string;
  title: string;
  madeAt?: string;
  inSec?: number;
  outSec?: number;
  /** 0 is the left edge of the picture, 1 is the right. The crop keeps the person there. */
  focus?: number;
};

/** Headline and the word to color, taken from the subject the person named. */
export function subjectLine(raw: string): { headline: string; accent: string } {
  const text = subjectQuery(raw);
  const headline = text.charAt(0).toUpperCase() + text.slice(1);
  const words = text.split(" ");
  const accent = words.find((word) => word.length > 2 && !SKIP_WORDS.has(word.toLowerCase())) ?? words[0] ?? text;
  return { headline, accent };
}

type SlotMedia = {
  mediaId: string | null;
  mediaName: string;
  previewUrl: string | null;
  duration: number;
  note: string;
  title: string;
  inSec: number;
  outSec: number;
  focus?: number;
  madeAt?: string;
};

type RawEntry = {
  _type?: string;
  id?: string;
  url?: string;
  webpage_url?: string;
  title?: string;
  duration?: number | null;
  live_status?: string | null;
  entries?: unknown;
};

export function subjectQuery(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || /[\u0000-\u001f]/.test(text)) throw new Error("Name a subject.");
  if (text.length > 80) throw new Error("Name a shorter subject.");
  return text;
}

export function subjectCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 1) return SUBJECT_CLIP_COUNT;
  return Math.min(SUBJECT_CLIP_COUNT, count);
}

/** A YouTube watch or Shorts link. Channels, playlists, and pictures are not clips. */
export function videoUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return `https://www.youtube.com/watch?v=${text}`;
  let url: URL;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v") ?? "";
      return VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    const shorts = /^\/shorts\/([\w-]{11})/.exec(url.pathname);
    if (shorts) return `https://www.youtube.com/watch?v=${shorts[1]}`;
    const embed = /^\/embed\/([\w-]{11})/.exec(url.pathname);
    if (embed) return `https://www.youtube.com/watch?v=${embed[1]}`;
    return null;
  }
  return null;
}

function asEntry(value: unknown): RawEntry | null {
  if (!value || typeof value !== "object") return null;
  return value as RawEntry;
}

function collect(value: unknown, into: RawEntry[]): void {
  const raw = asEntry(value);
  if (!raw) return;
  if (Array.isArray(raw.entries)) {
    for (const child of raw.entries) collect(child, into);
    if (raw._type === "playlist") return;
  }
  if (raw.id || raw.url || raw.webpage_url) into.push(raw);
}

export function clipsFromSearch(payload: unknown): SubjectHit[] {
  const root = asEntry(payload);
  const rows: RawEntry[] = [];
  if (root && Array.isArray(root.entries)) {
    for (const child of root.entries) collect(child, rows);
  } else if (Array.isArray(payload)) {
    for (const child of payload) collect(child, rows);
  } else if (root) {
    collect(root, rows);
  }
  const seen = new Set<string>();
  const hits: SubjectHit[] = [];
  for (const row of rows) {
    if (row.live_status === "is_live" || row.live_status === "is_upcoming" || row.live_status === "post_live") continue;
    if (row._type === "playlist" || row._type === "channel") continue;
    const url = videoUrl(String(row.url || row.webpage_url || row.id || ""));
    if (!url || seen.has(url)) continue;
    const duration = typeof row.duration === "number" && Number.isFinite(row.duration) ? row.duration : null;
    if (duration !== null && duration < 2) continue;
    seen.add(url);
    hits.push({
      url,
      title: typeof row.title === "string" ? row.title.trim() : "",
      durationSec: duration,
    });
  }
  return hits;
}

export function subjectWords(subject: string): string[] {
  return subject
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !SKIP_WORDS.has(word));
}

/** A robot, a news desk, an interview, or a long compilation is not the human subject. */
export function skipSubjectTitle(title: string, subject: string): boolean {
  const asked = subject.toLowerCase();
  return OFF_SUBJECT.some((pattern) => pattern.test(title) && !pattern.test(asked));
}

const OPTIONAL_WORDS = new Set([
  "fail",
  "fails",
  "fall",
  "falls",
  "fell",
  "jump",
  "jumps",
  "jumping",
  "climb",
  "climbs",
  "climbing",
  "bail",
  "bails",
  "faceplant",
  "funny",
  "funnier",
  "funniest",
  "cute",
  "cutest",
  "hilarious",
  "silly",
]);

function showsAPerson(title: string): boolean {
  return /\b(fails?|falls?|fell|jumps?|jumping|climbs?|climbing|bails?|faceplant|crash|wipeout)\b/i.test(title);
}

function hasWord(title: string, word: string): boolean {
  const forms = word.endsWith("s") ? [word, word.slice(0, -1)] : [word, `${word}s`];
  return forms.some((form) => new RegExp(`\\b${form}\\b`, "i").test(title));
}

function namesTheSubject(title: string, subject: string): boolean {
  const words = subjectWords(subject);
  const named = words.filter((word) => !OPTIONAL_WORDS.has(word));
  const needed = named.length ? named : words;
  return needed.every((word) => hasWord(title, word));
}

/** Short clips of the subject. A fall or a jump stays. A robot, a news story, or a long compilation does not. */
export function pickSubjectClips(hits: SubjectHit[], count = SUBJECT_CANDIDATE_COUNT, subject = ""): SubjectHit[] {
  const short = hits.filter((hit) => {
    if (hit.durationSec === null || hit.durationSec < 2 || hit.durationSec > MAX_SEC) return false;
    if (subject && skipSubjectTitle(hit.title, subject)) return false;
    if (subject && !namesTheSubject(hit.title, subject)) return false;
    return true;
  });
  const withPerson = short.filter((hit) => showsAPerson(hit.title));
  const ordered = withPerson.length >= SUBJECT_CLIP_COUNT ? withPerson : [...withPerson, ...short.filter((hit) => !showsAPerson(hit.title))];
  return ordered.slice(0, count);
}

function clampFoundRange(inSec: number, outSec: number, duration: number): { inSec: number; outSec: number } {
  const limit = duration > 0 ? duration : Math.max(outSec, inSec + 0.4);
  let start = Math.min(Math.max(0, inSec), Math.max(0, limit - 0.4));
  let end = Math.min(Math.max(outSec, start + 0.4), limit);
  if (end < start + 0.4) start = Math.max(0, end - 0.4);
  return {
    inSec: Math.round(start * 1000) / 1000,
    outSec: Math.round(Math.max(start + 0.4, end) * 1000) / 1000,
  };
}

/** Put found clips in empty slots. A slot that already has a clip stays where it is. */
export function placeFoundClips<T extends SlotMedia>(
  slots: T[],
  clips: FoundClip[],
): { slots: Array<T & { focus: number }>; placed: number } {
  const next: Array<T & { focus: number }> = slots.map((item) => ({ ...item, focus: pictureFocus(item.focus) }));
  let placed = 0;
  for (const clip of clips) {
    const index = next.findIndex((item) => !item.mediaId);
    if (index < 0) break;
    const duration = clip.durationSec > 0 ? clip.durationSec : 3;
    const current = next[index];
    const range =
      typeof clip.inSec === "number" && typeof clip.outSec === "number"
        ? clampFoundRange(clip.inSec, clip.outSec, duration)
        : { inSec: 0, outSec: Math.min(4, Math.max(0.4, duration)) };
    next[index] = {
      ...current,
      mediaId: clip.mediaId,
      mediaName: clip.mediaName,
      previewUrl: clip.previewUrl,
      duration,
      inSec: range.inSec,
      outSec: range.outSec,
      title: current.title.trim() ? current.title : clip.title.replace(/\.[^.]+$/, ""),
      focus: pictureFocus(clip.focus),
      note: clip.sourceUrl,
      ...(clip.madeAt ? { madeAt: clip.madeAt } : {}),
    };
    placed += 1;
  }
  return { slots: next, placed };
}
