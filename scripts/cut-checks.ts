import { readWhichClip } from "../src/shared/assist";
import { skipSubjectTitle } from "../src/shared/subject";

/** Labels the desks must show. The unit test reads the source. The live script reads the window. */
export const HOME_LABELS = ["Video Ranking", "Dual video"] as const;

export const RANKING_LABELS = [
  "Play ranking",
  "This clip",
  "Find clips",
  "Caption",
  "Show captions",
  "Paste captions",
  "Countdown",
  "Listed",
  "Skip around",
  "Shuffle",
] as const;

export const DUAL_LABELS = ["Face on top", "Gameplay on top", "Half", "Face larger", "Gameplay larger"] as const;

/** The canvas button that runs export cut. The styled button keeps its own name. */
export const CUT_BUTTON = "Export top picture";
export const STYLED_BUTTON = "Save vertical video";

export const SHORT_LINKS = [
  {
    name: "Me at the zoo",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    caption: "Me at the zoo",
  },
  {
    name: "Flower",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    caption: "A flower",
  },
] as const;

export const PARKOUR_FLICK = "6ded349e-2cf4-43ed-9b1b-6d3398034cbe";

const KEEPER_FILES = new Set([
  "walk check.mp4",
  "parkour-fails-short-cut-prove.mp4",
  "parkour-fails-short-styled-prove.mp4",
  "voice overlay check.mp4",
]);

export type Check = {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
};

export function checkLine(check: Check): string {
  return `${check.ok ? "PASS" : "FAIL"} ${check.id} ${check.name} — ${check.detail}`;
}

export function missingLabels(text: string, labels: readonly string[]): string[] {
  return labels.filter((label) => !text.includes(label));
}

/** In and out sit inside the file, with a real span. */
export function rangeInsideFile(range: { inSec: number; outSec: number }, duration: number): boolean {
  if (!(duration > 0)) return false;
  return range.inSec >= -0.001 && range.outSec <= duration + 0.05 && range.outSec > range.inSec + 0.05;
}

/** A caption is words. A file name, a stem, or a blank does not count. */
export function captionIsNotFileName(caption: string, fileName: string): boolean {
  const text = caption.trim();
  if (!text) return false;
  if (/\.(mp4|mov|m4v|webm|mkv|jpg|jpeg|png|webp)$/i.test(text)) return false;
  const base = fileName.replace(/^.*[/\\]/, "");
  const stem = base.replace(/\.[^.]+$/, "");
  if (text.toLowerCase() === base.toLowerCase()) return false;
  if (stem && text.toLowerCase() === stem.toLowerCase()) return false;
  return true;
}

/** The picture is input 0. A padded voice plus -shortest stops on that picture. */
export function shortVoiceKeepsPicture(args: readonly string[]): boolean {
  const mapAt = args.indexOf("-map");
  return args.includes("-shortest") && args.some((arg) => arg.includes("apad")) && mapAt >= 0 && args[mapAt + 1] === "0:v";
}

export function refusesKeeper(filePath: string): boolean {
  const norm = filePath.replace(/\//g, "\\").toLowerCase();
  const base = norm.split("\\").pop() ?? "";
  if (KEEPER_FILES.has(base)) return true;
  if (norm.includes(PARKOUR_FLICK) && base === "voice.mp3") return true;
  return false;
}

export const GTA_SUBJECT = "GTA gameplay fails";
export const GTA_EXPORT_NAME = "gta-gameplay-fails-cut.mp4";

/** Short public gameplay clips. Used only when Find clips returns trailers or news. */
export const GTA_FALLBACK_LINKS = [
  "https://www.youtube.com/shorts/oMgPeaMRYVY",
  "https://www.youtube.com/shorts/UPsyZbb0mfY",
] as const;

const GTA_OFF = [
  /\btrailers?\b/i,
  /\bteasers?\b/i,
  /\bnews\b/i,
  /\bcompilations?\b/i,
  /\bmontage\b/i,
  /\bofficial\b/i,
  /\bcinematic\b/i,
  /\breveal\b/i,
];

/** A short gameplay clip. Trailers, news desks, compilations, and long files stay out. */
export function gameplayClipOk(title: string, durationSec: number | null, subject = GTA_SUBJECT): boolean {
  if (!title.trim()) return false;
  if (durationSec !== null && (!Number.isFinite(durationSec) || durationSec < 2 || durationSec > 90)) return false;
  if (GTA_OFF.some((pattern) => pattern.test(title))) return false;
  if (skipSubjectTitle(title, subject)) return false;
  return titleAboutSubject(title, subject);
}

/** A few seconds around the action, never the whole long file. */
export function fewSecondsAround(inSec: number, outSec: number, durationSec: number): { inSec: number; outSec: number } {
  const duration = durationSec > 0 ? durationSec : Math.max(outSec, 4);
  let start = Number.isFinite(inSec) ? Math.max(0, inSec) : 0;
  let end = Number.isFinite(outSec) ? outSec : start + 4;
  if (end > duration) end = duration;
  if (end - start > 6) end = Math.min(duration, start + 4);
  if (end - start < 0.8) {
    start = Math.max(0, Math.min(start, Math.max(0, duration - 3)));
    end = Math.min(duration, start + 4);
  }
  if (end < start + 0.4) end = Math.min(duration, start + 0.4);
  return {
    inSec: Math.round(start * 1000) / 1000,
    outSec: Math.round(Math.max(start + 0.4, end) * 1000) / 1000,
  };
}

const OPTIONAL_SUBJECT_WORDS = new Set(["funny", "fails", "fail"]);

/** The title names the subject that was asked for. */
export function titleAboutSubject(title: string, subject: string): boolean {
  const words = subject
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4);
  const needed = words.filter((word) => !OPTIONAL_SUBJECT_WORDS.has(word));
  const check = needed.length ? needed : words;
  if (!check.length) return false;
  return check.every((word) => {
    const forms = word.endsWith("s") ? [word, word.slice(0, -1)] : [word, `${word}s`];
    return forms.some((form) => new RegExp(`\\b${form}\\b`, "i").test(title));
  });
}

/**
 * Which clip passes when the reply names a clip that is already on the flick.
 * An unknown id is not turned into a ranking.
 */
export function whichClipVerdict(
  reply: string,
  ids: string[],
  names: string[],
): { ok: boolean; named: string | null; detail: string } {
  const pick = readWhichClip(reply, ids);
  const known = new Set(ids);
  if (pick.strongestId && !known.has(pick.strongestId)) {
    return { ok: false, named: null, detail: `kept an unknown clip ${pick.strongestId}` };
  }
  if (pick.titles.some((item) => !known.has(item.id))) {
    return { ok: false, named: null, detail: "kept a title for a clip that is not on the flick" };
  }
  const fromId = pick.strongestId ? names[Number(pick.strongestId.slice(1)) - 1] ?? null : null;
  const fromText = names.find((name) => name.trim() && reply.toLowerCase().includes(name.trim().toLowerCase())) ?? null;
  const named = (fromId || fromText || "").trim() || null;
  if (!named) return { ok: false, named: null, detail: "reply did not name a clip on the flick" };
  return { ok: true, named, detail: `named ${named}` };
}
