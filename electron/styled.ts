import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import type { FlickProps } from "../src/remotion/FlickComposition";

let devBundle: Promise<string> | null = null;

export async function renderFlick(input: {
  entry: string;
  resourcesPath: string;
  outputPath: string;
  props: FlickProps;
  logLevel?: "info" | "verbose";
}): Promise<void> {
  const serveUrl = await ensureBundle(input.entry, input.resourcesPath);
  const composition = await selectComposition({
    serveUrl,
    id: "Flick",
    inputProps: input.props,
  });
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: input.outputPath,
    inputProps: input.props,
    hardwareAcceleration: "if-possible",
    videoBitrate: "8M",
    crf: null,
    overwrite: true,
    logLevel: input.logLevel ?? "info",
  });
}

async function ensureBundle(entry: string, resourcesPath: string): Promise<string> {
  const packed = path.join(resourcesPath, "remotion-bundle");
  if (fs.existsSync(path.join(packed, "index.html"))) return packed;
  devBundle ??= bundle({
    entryPoint: entry,
    webpackOverride: (config) => config,
  });
  return devBundle;
}
