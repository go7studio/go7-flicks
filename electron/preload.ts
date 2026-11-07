import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionDraft, Flick } from "../src/shared/model";

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

contextBridge.exposeInMainWorld("flicks", {
  gpu: () => invoke("gpu:probe"),
  recent: () => invoke("recent:list"),
  pickDirectory: () => invoke("dialog:directory"),
  pickVideo: () => invoke("dialog:video"),
  pickSave: (defaultPath: string) => invoke("dialog:save", defaultPath),
  createChannel: (parent: string, name: string) => invoke("channel:create", parent, name),
  openChannel: (dir: string) => invoke("channel:open", dir),
  updateChannel: (dir: string, patch: { name?: string; accent?: string }) => invoke("channel:update", dir, patch),
  createFlick: (dir: string, name: string, templateId: string) => invoke("flick:create", dir, name, templateId),
  readFlick: (dir: string, flickId: string) => invoke("flick:read", dir, flickId),
  saveFlick: (dir: string, flick: Flick) => invoke("flick:save", dir, flick),
  importMedia: (dir: string, mode: "copy" | "link") => invoke("media:import", dir, mode),
  templates: () => invoke("template:list"),
  saveTemplate: (flick: Flick, name: string, replaceId?: string) => invoke("template:save", flick, name, replaceId),
  connections: () => invoke("connection:list"),
  saveConnection: (draft: ConnectionDraft) => invoke("connection:save", draft),
  deleteConnection: (id: string) => invoke("connection:delete", id),
  testConnection: (id: string) => invoke("connection:test", id),
  setVoice: (id: string, voiceId: string) => invoke("connection:voice", id, voiceId),
  writeLine: (connectionId: string, prompt: string) => invoke("ai:write", connectionId, prompt),
  makeVoice: (connectionId: string, dir: string, flickId: string, text: string) => invoke("ai:voice", connectionId, dir, flickId, text),
  exportCut: (dir: string, flickId: string, outputPath: string) => invoke("export:cut", dir, flickId, outputPath),
  exportStyled: (dir: string, flickId: string, outputPath: string) => invoke("export:styled", dir, flickId, outputPath),
});
