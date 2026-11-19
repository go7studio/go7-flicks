import type { CallResult, ChannelFile, ConnectionDraft, ConnectionPublic, Flick, GpuProbe, MediaAsset, RecentChannel, ShelfEntry, Template } from "./model";
import type { FoundClip } from "./subject";

export type ResolvedMedia = MediaAsset & {
  absolutePath: string;
  missing: boolean;
  previewUrl: string | null;
  workingCopy?: boolean;
  madeAt?: string;
};

export type ChannelPayload = {
  dir: string;
  channel: ChannelFile;
  media: ResolvedMedia[];
  mediaBase: string;
};

export type FlickPayload = ChannelPayload & {
  flick: Flick;
  voicePreview: string | null;
  soundPreviews?: Record<string, string>;
};

export type FlicksApi = {
  gpu: () => Promise<GpuProbe>;
  recent: () => Promise<RecentChannel[]>;
  forgetRecent: (dir: string) => Promise<CallResult>;
  pickDirectory: () => Promise<string | null>;
  pickVideo: () => Promise<string | null>;
  pickSave: (defaultPath: string) => Promise<string | null>;
  createChannel: (parent: string, name: string) => Promise<CallResult & Partial<ChannelPayload>>;
  openChannel: (dir: string) => Promise<CallResult & Partial<ChannelPayload>>;
  updateChannel: (dir: string, patch: { name?: string; accent?: string }) => Promise<CallResult & { channel?: ChannelFile }>;
  renameChannel: (dir: string, name: string) => Promise<CallResult & { channel?: ChannelFile }>;
  createFlick: (dir: string, name: string, templateId: string) => Promise<CallResult & { flick?: Flick }>;
  readFlick: (dir: string, flickId: string) => Promise<CallResult & Partial<FlickPayload>>;
  saveFlick: (dir: string, flick: Flick) => Promise<CallResult & { flick?: Flick }>;
  addSound: (dir: string, flickId: string, clipId: string) => Promise<CallResult & { flick?: Flick; previewUrl?: string; clipId?: string }>;
  clearSound: (dir: string, flickId: string, clipId: string) => Promise<CallResult & { flick?: Flick; clipId?: string }>;
  duplicateFlick: (dir: string, flickId: string) => Promise<CallResult & { flick?: Flick; channel?: ChannelFile }>;
  deleteFlick: (dir: string, flickId: string) => Promise<CallResult & { channel?: ChannelFile }>;
  importMedia: (dir: string, mode: "copy" | "link") => Promise<CallResult & { asset?: MediaAsset; media?: ResolvedMedia[]; workingCopy?: boolean }>;
  downloadMedia: (dir: string, url: string) => Promise<CallResult & { asset?: MediaAsset; media?: ResolvedMedia[]; sourceUrl?: string; workingCopy?: boolean }>;
  findClips: (dir: string, subject: string, count: number) => Promise<CallResult & { clips?: FoundClip[]; media?: ResolvedMedia[]; workingCopy?: boolean }>;
  importAudio: (dir: string) => Promise<CallResult & { asset?: MediaAsset; media?: ResolvedMedia[]; workingCopy?: boolean }>;
  stageMedia: (dir: string, assetId: string) => Promise<CallResult & { media?: ResolvedMedia[] }>;
  removeMedia: (dir: string, mediaId: string) => Promise<CallResult & { media?: ResolvedMedia[] }>;
  staging: () => Promise<{ stagingDir: string }>;
  chooseStaging: () => Promise<CallResult & { stagingDir?: string }>;
  cleanUnused: () => Promise<CallResult & { removedCopies?: number; removedExports?: number }>;
  shelf: () => Promise<ShelfEntry[]>;
  useShelf: (dir: string, id: string) => Promise<CallResult & { asset?: MediaAsset; media?: ResolvedMedia[]; kind?: ShelfEntry["kind"]; credit?: string; workingCopy?: boolean }>;
  templates: () => Promise<Template[]>;
  saveTemplate: (flick: Flick, name: string, replaceId?: string) => Promise<CallResult & { template?: Template }>;
  connections: () => Promise<ConnectionPublic[]>;
  saveConnection: (draft: ConnectionDraft) => Promise<CallResult & { connection?: ConnectionPublic }>;
  deleteConnection: (id: string) => Promise<CallResult>;
  testConnection: (id: string) => Promise<CallResult & { connection?: ConnectionPublic }>;
  setVoice: (id: string, voiceId: string) => Promise<CallResult & { connection?: ConnectionPublic }>;
  hearVoice: (id: string) => Promise<CallResult & { audioBase64?: string }>;
  writeLine: (connectionId: string, prompt: string) => Promise<CallResult>;
  askAssistant: (connectionId: string, prompt: string) => Promise<CallResult>;
  makeVoice: (connectionId: string, dir: string, flickId: string, text: string, startSec?: number) => Promise<CallResult>;
  exportCut: (dir: string, flickId: string, outputPath: string) => Promise<CallResult>;
  exportStyled: (dir: string, flickId: string, outputPath: string) => Promise<CallResult>;
};

declare global {
  interface Window {
    flicks?: FlicksApi;
  }
}
