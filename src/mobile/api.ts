import type { FlicksApi } from "../shared/api";
import type { GpuProbe } from "../shared/model";
import { builtinTemplates } from "../shared/canvas";
import {
  COMPUTER_APP,
  createChannel,
  createFlick,
  deleteConnection,
  deleteFlick,
  duplicateFlick,
  forgetRecent,
  importMedia,
  listConnections,
  listTemplates,
  openChannel,
  pickVideo,
  readFlick,
  recentChannels,
  renameChannel,
  saveConnection,
  saveFlick,
  saveNarration,
  saveTemplate,
  setVoice,
  testConnection,
  updateChannel,
} from "./library";

const phoneGpu = (): GpuProbe => ({
  ffmpegPath: null,
  ffmpegSource: "none",
  encoders: { videotoolbox: false, nvenc: false, qsv: false, amf: false, libx264: false },
  chosen: "phone",
  chosenEncoder: null,
});

function refused(): { ok: false; message: string } {
  return { ok: false, message: COMPUTER_APP };
}

async function run<T>(work: () => Promise<T>): Promise<T | { ok: false; message: string }> {
  try {
    return await work();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export function createPhoneApi(): FlicksApi {
  return {
    gpu: async () => phoneGpu(),
    recent: async () => {
      try {
        return await recentChannels();
      } catch {
        return [];
      }
    },
    forgetRecent: (dir) => run(() => forgetRecent(dir)),
    pickDirectory: async (): Promise<string | null> => refused() as unknown as string | null,
    pickVideo: async () => {
      try {
        return await pickVideo();
      } catch {
        return null;
      }
    },
    pickSave: async (): Promise<string | null> => refused() as unknown as string | null,
    createChannel: (parent, name) => run(() => createChannel(parent, name)),
    openChannel: (dir) => run(() => openChannel(dir)),
    updateChannel: (dir, patch) => run(() => updateChannel(dir, patch)),
    renameChannel: (dir, name) => run(() => renameChannel(dir, name)),
    createFlick: (dir, name, templateId) => run(() => createFlick(dir, name, templateId)),
    readFlick: (dir, flickId) => run(() => readFlick(dir, flickId)),
    saveFlick: (dir, flick) => run(() => saveFlick(dir, flick)),
    addSound: async () => refused(),
    clearSound: async () => refused(),
    duplicateFlick: (dir, flickId) => run(() => duplicateFlick(dir, flickId)),
    deleteFlick: (dir, flickId) => run(() => deleteFlick(dir, flickId)),
    importMedia: (dir, mode) => run(() => importMedia(dir, mode)),
    downloadMedia: async () => refused(),
    findClips: async () => refused(),
    importAudio: async () => refused(),
    stageMedia: async () => refused(),
    removeMedia: async () => refused(),
    staging: async () => ({ stagingDir: "" }),
    chooseStaging: async () => refused(),
    cleanUnused: async () => refused(),
    shelf: async () => [],
    useShelf: async () => refused(),
    templates: async () => {
      try {
        return await listTemplates();
      } catch {
        return builtinTemplates();
      }
    },
    saveTemplate: (flick, name, replaceId) => run(() => saveTemplate(flick, name, replaceId)),
    connections: async () => {
      try {
        return await listConnections();
      } catch {
        return [];
      }
    },
    saveConnection: (draft) => run(() => saveConnection(draft)),
    deleteConnection: (id) => run(() => deleteConnection(id)),
    testConnection: (id) => run(() => testConnection(id)),
    setVoice: (id, voiceId) => run(() => setVoice(id, voiceId)),
    hearVoice: async () => refused(),
    writeLine: async () => refused(),
    askAssistant: async () => refused(),
    makeVoice: async () => refused(),
    saveNarration: (dir, flickId, audioBase64, mime) => run(() => saveNarration(dir, flickId, audioBase64, mime)),
    exportCut: async () => refused(),
    exportStyled: async () => refused(),
  };
}
