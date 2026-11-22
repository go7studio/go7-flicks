import type { FlicksApi } from "../shared/api";
import { createPhoneApi } from "./api";

type Host = Window & { flicks?: FlicksApi };

function host(): Host | null {
  const scoped = (globalThis as { window?: Host }).window;
  if (scoped) return scoped;
  if (typeof window !== "undefined") return window;
  return null;
}

/** Install the phone API only when Electron has not already set window.flicks. */
export async function boot(): Promise<void> {
  const page = host();
  if (!page || page.flicks) return;
  page.flicks = createPhoneApi();
  const root = page.document?.documentElement;
  if (root) root.dataset.go7Host = "mobile";
}
