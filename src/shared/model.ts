export type ConnectionKind = "claude" | "codex" | "grok" | "cursor" | "elevenlabs" | "minimax" | "other";

export type ChatApi = "anthropic-messages" | "openai-completions";

export type ConnectionAuth = "cli" | "key";

export type VoiceOption = {
  id: string;
  name: string;
};

export type ConnectionPublic = {
  id: string;
  kind: ConnectionKind;
  name: string;
  connected: boolean;
  auth: ConnectionAuth;
  baseUrl: string;
  model: string;
  api: ChatApi;
  voiceId: string;
  voices: VoiceOption[];
  hasCredential: boolean;
  statusNote: string;
};

export type ConnectionDraft = {
  id?: string;
  kind: ConnectionKind;
  name: string;
  auth: ConnectionAuth;
  baseUrl: string;
  model: string;
  api: ChatApi;
  voiceId: string;
  apiKey?: string;
};

export type Track = {
  id: string;
  name: string;
  kind: "video";
  muted: boolean;
};

export type Region = {
  id: string;
  trackId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hidden: boolean;
};

export type Clip = {
  id: string;
  mediaId: string | null;
  trackId: string;
  startSec: number;
  inSec: number;
  outSec: number;
  label: string;
  sourceUrl?: string;
  line?: string;
  /** 0 is the left edge of the picture, 1 is the right. The vertical crop keeps the person there. */
  focus?: number;
  /** One local audio file copied onto this cut. It plays once when the cut starts. */
  soundRelative?: string;
};

export type MediaAsset = {
  id: string;
  name: string;
  relativePath?: string;
  absolutePath?: string;
  durationSec: number;
  width: number;
  height: number;
  codec: string;
};

export type Flick = {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  regions: Region[];
  tracks: Track[];
  clips: Clip[];
  voiceRelative?: string;
  /** Where the single voice.mp3 starts on the flick. Omitted on old files. */
  voiceStartSec?: number;
  musicId?: string;
  musicCredit?: string;
  templateId?: string;
  headline?: string;
  headlineColor?: string;
  accentWords?: string;
  titleStroke?: number;
  showRank?: boolean;
  showCaptions?: boolean;
  titleFont?: string;
  lineColor?: string;
  lineSize?: number;
  pictureWarmth?: number;
};

export type FlickSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

export type ChannelFile = {
  version: 1;
  name: string;
  accent: string;
  media: MediaAsset[];
  flicks: FlickSummary[];
};

export type Template = {
  id: string;
  name: string;
  builtin: boolean;
  fps: number;
  width: number;
  height: number;
  regions: Region[];
  tracks: Track[];
  clips: Clip[];
  headline?: string;
  headlineColor?: string;
  accentWords?: string;
  titleStroke?: number;
  showRank?: boolean;
  showCaptions?: boolean;
  titleFont?: string;
  lineColor?: string;
  lineSize?: number;
  pictureWarmth?: number;
};

export type GpuProbe = {
  ffmpegPath: string | null;
  ffmpegSource: "none" | "env" | "path" | "bundled";
  encoders: {
    videotoolbox: boolean;
    nvenc: boolean;
    qsv: boolean;
    amf: boolean;
    libx264: boolean;
  };
  chosen: string;
  chosenEncoder: string | null;
};

export type RecentChannel = {
  path: string;
  name: string;
  clippedAt?: string;
  madeAt?: string;
};

export type ShelfKind = "audio" | "video";

export type ShelfEntry = {
  id: string;
  name: string;
  kind: ShelfKind;
  durationSec: number;
  width: number;
  height: number;
  codec: string;
  credit?: string;
  madeAt?: string;
};

export type CallResult = {
  ok: boolean;
  message: string;
  text?: string;
  relativePath?: string;
  outputPath?: string;
};

export const FRAME = { width: 1080, height: 1920, fps: 30 } as const;

export function uid(): string {
  return crypto.randomUUID();
}

export function clipDuration(clip: { inSec: number; outSec: number }): number {
  return Math.max(0, clip.outSec - clip.inSec);
}

export function timelineEnd(clips: { startSec: number; inSec: number; outSec: number }[]): number {
  return clips.reduce((max, clip) => Math.max(max, clip.startSec + clipDuration(clip)), 0);
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const SOUND_FILE = /^sound-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|m4a|wav|aac)$/i;

/** A sound file lives beside the flick. Anything else is dropped. */
export function storedSoundRelative(value: unknown): string | undefined {
  if (typeof value !== "string" || !SOUND_FILE.test(value)) return undefined;
  return value;
}

/** One voice.mp3 for the flick. A missing or negative offset starts at the beginning. */
export function storedVoiceStart(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return round3(value);
}

const SUBSCRIPTION_TARGET = /antigravity|cloudcode-pa|gemini\.google\.com/i;

/** The Gemini API stays available. The app subscription and Antigravity do not. */
export function subscriptionRefusal(baseUrl: string, model: string): string | null {
  if (!SUBSCRIPTION_TARGET.test(`${baseUrl} ${model}`)) return null;
  return "This app does not call the Gemini subscription or Antigravity.";
}

export function defaultsFor(kind: ConnectionKind): Pick<ConnectionDraft, "auth" | "baseUrl" | "model" | "api" | "voiceId" | "name"> {
  if (kind === "claude") {
    return {
      name: "Claude",
      auth: "key",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      api: "anthropic-messages",
      voiceId: "",
    };
  }
  if (kind === "codex") {
    return {
      name: "Codex",
      auth: "key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-6.1-terra",
      api: "openai-completions",
      voiceId: "",
    };
  }
  if (kind === "grok") {
    return {
      name: "Grok",
      auth: "key",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.7",
      api: "openai-completions",
      voiceId: "",
    };
  }
  if (kind === "cursor") {
    return {
      name: "Cursor",
      auth: "cli",
      baseUrl: "",
      model: "",
      api: "openai-completions",
      voiceId: "",
    };
  }
  if (kind === "elevenlabs") {
    return {
      name: "ElevenLabs",
      auth: "key",
      baseUrl: "https://api.elevenlabs.io",
      model: "eleven_multilingual_v2",
      api: "openai-completions",
      voiceId: "",
    };
  }
  if (kind === "minimax") {
    return {
      name: "MiniMax",
      auth: "key",
      baseUrl: "https://api.minimax.io/v1",
      model: "speech-02-turbo",
      api: "openai-completions",
      voiceId: "English_expressive_narrator",
    };
  }
  return {
    name: "Other",
    auth: "key",
    baseUrl: "",
    model: "",
    api: "openai-completions",
    voiceId: "",
  };
}
