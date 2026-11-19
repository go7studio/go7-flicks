import { spokenLine } from "./canvas";

/** Shown after a successful export. The file is the Short. YouTube gets the words separately. */
export const UPLOAD_FILE_NOTE =
  "The video file is 1080x1920. Upload that file to YouTube and paste the title and description there.";

export type UploadClip = {
  id?: string;
  line?: string;
  startSec: number;
  /** Smaller is higher on the frame. Missing counts as 0. */
  stack?: number;
  mediaName?: string;
};

export type UploadHandout = {
  title: string;
  description: string;
};

/**
 * One line for the YouTube title.
 * The flick headline wins. A blank headline uses the flick name.
 * Runs of whitespace, including line breaks, become a single space.
 */
export function uploadTitle(headline: string | undefined, flickName: string): string {
  const head = oneLine(headline);
  return head || oneLine(flickName);
}

/**
 * One paragraph for the YouTube description.
 * Captions stay in order: start time, then higher on the frame, then clip id.
 * A caption is the spoken line. A file name, a machine id, or a camera stamp is left out.
 * Each caption is its own sentence. A music credit, when one is passed, is the last sentence.
 * This text does not add hashtags or view counts.
 */
export function uploadDescription(clips: UploadClip[], musicCredit?: string): string {
  const sentences = [...clips]
    .sort(compareClips)
    .map((clip) => spokenLine(clip.line, clip.mediaName))
    .filter((line) => line.length > 0)
    .map(asSentence);
  const credit = oneLine(musicCredit);
  if (credit) sentences.push(asSentence(`Music: ${credit}`));
  return sentences.join(" ");
}

/**
 * Title and description for the flick that was just exported.
 * A credit counts only when this flick still has a music file.
 */
export function uploadHandout(
  flick: {
    name: string;
    headline?: string;
    musicId?: string;
    musicCredit?: string;
    regions?: { trackId: string; y: number }[];
    clips: {
      id?: string;
      line?: string;
      startSec: number;
      trackId?: string;
      mediaId?: string | null;
    }[];
  },
  media: { id: string; name: string }[] = [],
): UploadHandout {
  const names = new Map(media.map((item) => [item.id, item.name]));
  const stacks = new Map<string, number>();
  for (const region of flick.regions ?? []) {
    const current = stacks.get(region.trackId);
    if (current === undefined || region.y < current) stacks.set(region.trackId, region.y);
  }
  return {
    title: uploadTitle(flick.headline, flick.name),
    description: uploadDescription(
      flick.clips.map((clip) => ({
        id: clip.id,
        line: clip.line,
        startSec: clip.startSec,
        stack: clip.trackId ? stacks.get(clip.trackId) : undefined,
        mediaName: clip.mediaId ? names.get(clip.mediaId) : undefined,
      })),
      flick.musicId ? flick.musicCredit : undefined,
    ),
  };
}

function oneLine(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function asSentence(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "";
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

function compareClips(a: UploadClip, b: UploadClip): number {
  return a.startSec - b.startSec || stackOf(a) - stackOf(b) || (a.id ?? "").localeCompare(b.id ?? "");
}

function stackOf(clip: UploadClip): number {
  return typeof clip.stack === "number" && Number.isFinite(clip.stack) ? clip.stack : 0;
}
