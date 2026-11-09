import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { visibleRegions } from "../src/shared/canvas";
import { creditDrawtext, cutAudioFilter } from "../src/shared/mix";
import { clipDuration, type Flick, type MediaAsset } from "../src/shared/model";

const exec = promisify(execFile);

export async function exportCut(input: {
  ffmpeg: string;
  encoder: string;
  channelDir: string;
  flick: Flick;
  media: MediaAsset[];
  outputPath: string;
}): Promise<void> {
  const trackId = visibleRegions(input.flick.regions)[0]?.trackId ?? input.flick.tracks[0]?.id;
  const clips = input.flick.clips
    .filter((clip) => clip.trackId === trackId && clip.mediaId)
    .sort((a, b) => a.startSec - b.startSec);
  if (!clips.length) throw new Error("Add a clip on the top region before cutting an export.");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "go7flicks-"));
  try {
    const segments: string[] = [];
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const asset = input.media.find((item) => item.id === clip.mediaId);
      const source = resolveAsset(input.channelDir, asset);
      if (!source || !fs.existsSync(source)) throw new Error(`Missing media for ${clip.label}.`);
      const segment = path.join(tmp, `seg-${index}.mp4`);
      const available = asset?.durationSec && asset.durationSec > 0 ? asset.durationSec : clip.outSec;
      const end = Math.min(clip.outSec, available);
      const start = Math.min(clip.inSec, Math.max(0, end - 0.05));
      if (end - start <= 0.05) continue;
      const copy =
        asset?.codec === "h264" && asset.width === input.flick.width && asset.height === input.flick.height;
      const args = ["-y", "-ss", String(start), "-to", String(end), "-i", source, "-an"];
      if (copy) {
        args.push("-c", "copy", segment);
      } else {
        const { width, height } = input.flick;
        args.push(
          "-vf",
          `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
          "-pix_fmt",
          "yuv420p",
          "-c:v",
          input.encoder,
          ...(input.encoder === "libx264" ? ["-preset", "veryfast", "-crf", "20"] : ["-b:v", "8M"]),
          segment,
        );
      }
      await exec(input.ffmpeg, args, { timeout: 120000 });
      if (clipDuration(clip) <= 0) continue;
      segments.push(segment);
    }
    if (!segments.length) throw new Error("Those clips have no duration.");
    const list = path.join(tmp, "list.txt");
    fs.writeFileSync(
      list,
      segments.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
    );
    const silent = path.join(tmp, "silent.mp4");
    await exec(input.ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent], {
      timeout: 120000,
    });
    fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
    const voice = input.flick.voiceRelative
      ? path.join(input.channelDir, "flicks", input.flick.id, input.flick.voiceRelative)
      : "";
    const voiceReady = Boolean(voice && fs.existsSync(voice));
    const musicAsset = input.media.find((item) => item.id === input.flick.musicId);
    const music = input.flick.musicId ? resolveAsset(input.channelDir, musicAsset) : null;
    if (input.flick.musicId && (!music || !fs.existsSync(music))) throw new Error("The music file is missing.");
    const musicReady = Boolean(music && fs.existsSync(music));
    const credit = musicReady ? input.flick.musicCredit?.trim() ?? "" : "";
    const font = credit ? findCreditFont() : null;
    if (credit && !font) throw new Error("A font is needed to draw the music credit.");
    const textFile = credit ? path.join(tmp, "credit.txt") : "";
    if (credit && textFile) fs.writeFileSync(textFile, credit, "utf8");
    const drawtext = credit && font && textFile ? creditDrawtext(font, textFile) : null;
    const filter = cutAudioFilter({ hasVoice: voiceReady, hasMusic: musicReady, drawtext });
    if (!musicReady && voiceReady) {
      await exec(
        input.ffmpeg,
        ["-y", "-i", silent, "-i", voice, "-c:v", "copy", "-c:a", "aac", "-shortest", input.outputPath],
        { timeout: 120000 },
      );
    } else if (musicReady && filter && music) {
      const args = ["-y", "-i", silent, "-stream_loop", "-1", "-i", music];
      if (voiceReady) args.push("-i", voice);
      args.push("-filter_complex", filter);
      if (drawtext) {
        args.push("-map", "[v]", "-map", "[a]", "-pix_fmt", "yuv420p", "-c:v", input.encoder, ...videoEncodeArgs(input.encoder));
      } else {
        args.push("-map", "0:v", "-map", "[a]", "-c:v", "copy");
      }
      args.push("-c:a", "aac", "-shortest", input.outputPath);
      await exec(input.ffmpeg, args, { timeout: 120000 });
    } else {
      fs.copyFileSync(silent, input.outputPath);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function videoEncodeArgs(encoder: string): string[] {
  return encoder === "libx264" ? ["-preset", "veryfast", "-crf", "20"] : ["-b:v", "8M"];
}

export function findCreditFont(): string | null {
  const candidates = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

export function resolveAsset(channelDir: string, asset: MediaAsset | undefined): string | null {
  if (!asset) return null;
  if (asset.absolutePath) return asset.absolutePath;
  if (asset.relativePath) return path.join(channelDir, asset.relativePath);
  return null;
}
