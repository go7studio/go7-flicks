import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

export function userDir(): string {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function secretPath(id: string): string {
  const dir = path.join(userDir(), "secrets");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id}.bin`);
}

export function encryptionReady(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function saveSecret(id: string, plain: string): void {
  if (!encryptionReady()) throw new Error("This computer cannot encrypt keys.");
  fs.writeFileSync(secretPath(id), safeStorage.encryptString(plain));
}

export function hasSecret(id: string): boolean {
  return fs.existsSync(secretPath(id));
}

export function readSecret(id: string): string | null {
  const file = secretPath(id);
  if (!fs.existsSync(file)) return null;
  if (!encryptionReady()) throw new Error("This computer cannot read encrypted keys.");
  return safeStorage.decryptString(fs.readFileSync(file));
}

export function deleteSecret(id: string): void {
  const file = secretPath(id);
  if (fs.existsSync(file)) fs.rmSync(file);
}

export function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
