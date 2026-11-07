import type { CallResult, ChannelFile, ConnectionDraft, ConnectionPublic, Flick, GpuProbe, MediaAsset, RecentChannel, Template } from "./model";

export type ResolvedMedia = MediaAsset & {
  absolutePath: string;
  missing: boolean;
  previewUrl: string | null;
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
};

export type FlicksApi = {
  gpu: () => Promise<GpuProbe>;
  recent: () => Promise<RecentChannel[]>;
  pickDirectory: () => Promise<string | null>;
  pickVideo: () => Promise<string | null>;
  pickSave: (defaultPath: string) => Promise<string | null>;
  createChannel: (parent: string, name: string) => Promise<CallResult & Partial<ChannelPayload>>;
  openChannel: (dir: string) => Promise<CallResult & Partial<ChannelPayload>>;
  updateChannel: (dir: string, patch: { name?: string; accent?: string }) => Promise<CallResult & { channel?: ChannelFile }>;
  createFlick: (dir: string, name: string, templateId: string) => Promise<CallResult & { flick?: Flick }>;
  readFlick: (dir: string, flickId: string) => Promise<CallResult & Partial<FlickPayload>>;
  saveFlick: (dir: string, flick: Flick) => Promise<CallResult & { flick?: Flick }>;
  importMedia: (dir: string, mode: "copy" | "link") => Promise<CallResult & { asset?: MediaAsset; media?: ResolvedMedia[] }>;
  templates: () => Promise<Template[]>;
  saveTemplate: (flick: Flick, name: string, replaceId?: string) => Promise<CallResult & { template?: Template }>;
  connections: () => Promise<ConnectionPublic[]>;
  saveConnection: (draft: ConnectionDraft) => Promise<CallResult & { connection?: ConnectionPublic }>;
  deleteConnection: (id: string) => Promise<CallResult>;
  testConnection: (id: string) => Promise<CallResult & { connection?: ConnectionPublic }>;
  setVoice: (id: string, voiceId: string) => Promise<CallResult & { connection?: ConnectionPublic }>;
  writeLine: (connectionId: string, prompt: string) => Promise<CallResult>;
  makeVoice: (connectionId: string, dir: string, flickId: string, text: string) => Promise<CallResult>;
  exportCut: (dir: string, flickId: string, outputPath: string) => Promise<CallResult>;
  exportStyled: (dir: string, flickId: string, outputPath: string) => Promise<CallResult>;
};

declare global {
  interface Window {
    flicks?: FlicksApi;
  }
}
