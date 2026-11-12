import fs from "node:fs";
import path from "node:path";
import { phoneMadeIso } from "../src/shared/when";

export function mediaMadeAt(name: string, file: string | null | undefined): string | undefined {
  const stamped = phoneMadeIso(name) ?? (file ? phoneMadeIso(path.basename(file)) : null);
  if (stamped) return stamped;
  if (!file) return undefined;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return undefined;
    return stat.mtime.toISOString();
  } catch {
    return undefined;
  }
}
