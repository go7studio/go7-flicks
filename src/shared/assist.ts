export type AssistClip = {
  id: string;
  name: string;
  line: string;
  lengthSec: number;
  date: string;
};

export type AssistTitle = {
  id: string;
  title: string;
};

export type AssistPick = {
  strongestId: string | null;
  why: string;
  headline: string | null;
  titles: AssistTitle[];
};

const VOICE_KINDS = new Set(["elevenlabs", "minimax"]);

export function connectedChat<T extends { kind: string; connected: boolean }>(rows: T[]): T[] {
  return rows.filter((row) => row.connected && !VOICE_KINDS.has(row.kind));
}

export function voiceOnly<T extends { kind: string; connected: boolean }>(rows: T[]): boolean {
  const connected = rows.filter((row) => row.connected);
  return connected.length > 0 && connected.every((row) => VOICE_KINDS.has(row.kind));
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function assistLines(clips: AssistClip[]): string[] {
  return clips.map((clip, index) => {
    const name = oneLine(clip.name) || "Clip";
    const line = oneLine(clip.line) || "(none)";
    const date = oneLine(clip.date) || "no date";
    const length = Number.isFinite(clip.lengthSec) ? `${Math.max(0, clip.lengthSec).toFixed(1)}s` : "unknown";
    return `${index + 1}. id=c${index + 1} name=${name} line=${line} length=${length} date=${date}`;
  });
}

export function whichClipPrompt(clips: AssistClip[]): string {
  return [
    "You are choosing the strongest hook among clips already on this flick.",
    "Use only the list below. Do not browse the web. Do not suggest a download. Do not tell the app to reorder or delete clips.",
    "Reply in this shape and nothing else:",
    "STRONGEST: <id from the list>",
    "WHY: <two short sentences>",
    "HEADLINE: <one headline for the whole video>",
    "TITLE <id>: <a short title for that clip>",
    "Repeat TITLE once for every clip. Copy each id exactly.",
    "",
    ...assistLines(clips),
  ].join("\n");
}

export function trendPrompt(clips: AssistClip[]): string {
  return [
    "These clips are already on this flick. In two sentences, say what trend or video type this set belongs to.",
    "Do not browse the web. Do not invent view counts. Do not suggest a download.",
    "",
    ...assistLines(clips),
  ].join("\n");
}

function cleanToken(value: string): string {
  return value.trim().replace(/^["'`]+|["'`,.]+$/g, "").split(/\s+/)[0] ?? "";
}

export function readWhichClip(text: string, ids: string[]): AssistPick {
  const known = new Set(ids);
  let strongestId: string | null = null;
  let why = "";
  let headline: string | null = null;
  const titles: AssistTitle[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const strong = /^STRONGEST:\s*(.+)$/i.exec(line);
    if (strong) {
      const id = cleanToken(strong[1]);
      if (known.has(id)) strongestId = id;
      continue;
    }
    const whyMatch = /^WHY:\s*(.*)$/i.exec(line);
    if (whyMatch) {
      why = whyMatch[1].trim();
      continue;
    }
    const head = /^HEADLINE:\s*(.*)$/i.exec(line);
    if (head) {
      const next = head[1].trim().replace(/\\n/g, "\n");
      headline = next || null;
      continue;
    }
    const title = /^TITLE\s+(\S+):\s*(.*)$/i.exec(line);
    if (!title) continue;
    const id = cleanToken(title[1]);
    const words = title[2].trim();
    if (!known.has(id) || !words) continue;
    const existing = titles.findIndex((item) => item.id === id);
    if (existing >= 0) titles[existing] = { id, title: words };
    else titles.push({ id, title: words });
  }
  return { strongestId, why, headline, titles };
}
