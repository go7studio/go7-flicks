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
  voiceFile?: string;
  videoBitrate?: string;
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
      const span = end - start;
      if (span <= 0.05 || clipDuration(clip) <= 0) continue;
      const canCopy =
        asset?.codec === "h264" && asset.width === input.flick.width && asset.height === input.flick.height;
      let wrote = false;
      if (canCopy) {
        try {
          await run(
            input.ffmpeg,
            ["-y", "-ss", String(start), "-i", source, "-t", String(span), "-an", "-c:v", "copy", "-avoid_negative_ts", "make_zero", segment],
            120000,
          );
          wrote = ready(segment);
        } catch {
          wrote = false;
        }
      }
      if (!wrote) {
        fs.rmSync(segment, { force: true });
        const { width, height } = input.flick;
        try {
          await runVideo(
            input.ffmpeg,
            [
              "-y",
              "-ss",
              String(start),
              "-i",
              source,
              "-t",
              String(span),
              "-an",
              "-vf",
              `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
              "-r",
              String(input.flick.fps),
              "-pix_fmt",
              "yuv420p",
            ],
            segment,
            input.encoder,
            input.videoBitrate,
            120000,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : shortFfmpeg(error);
          throw new Error(`Could not cut “${clip.label || "that clip"}”. ${reason}`);
        }
      }
      segments.push(segment);
    }
    if (!segments.length) throw new Error("Those clips have no duration.");
    const silent = path.join(tmp, "silent.mp4");
    await joinSegments(input.ffmpeg, segments, silent, input.flick, input.encoder, input.videoBitrate);
    fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
    const voice =
      input.voiceFile ??
      (input.flick.voiceRelative
        ? path.join(input.channelDir, "flicks", input.flick.id, input.flick.voiceRelative)
        : "");
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
    if (!musicReady && voiceReady && voice) {
      await muxVoice(input.ffmpeg, silent, voice, input.outputPath, input.encoder, input.videoBitrate);
    } else if (musicReady && filter && music) {
      await muxMusic(input.ffmpeg, silent, music, voiceReady ? voice : "", filter, Boolean(drawtext), input.outputPath, input.encoder, input.videoBitrate);
    } else {
      fs.copyFileSync(silent, input.outputPath);
    }
    if (!ready(input.outputPath)) throw new Error("Export cut did not write a video.");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function bitrateOf(videoBitrate: string | undefined): string {
  return videoBitrate?.trim() || "8M";
}

function videoEncodeArgs(encoder: string, videoBitrate?: string): string[] {
  return encoder === "libx264" ? ["-preset", "veryfast", "-crf", "20"] : ["-b:v", bitrateOf(videoBitrate)];
}

async function run(ffmpeg: string, args: string[], timeout: number): Promise<void> {
  await exec(ffmpeg, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
}

function ready(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).size > 500;
}

function shortFfmpeg(error: unknown): string {
  const failed = error as { stderr?: string; message?: string };
  const lines = `${failed.stderr ?? ""}\n${failed.message ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("frame=") && !line.startsWith("Command failed"));
  const useful = [...lines].reverse().find((line) => /error|invalid|fail|cannot|could not|no such|unknown/i.test(line));
  const text = useful ?? "ffmpeg could not write that video.";
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

async function runVideo(
  ffmpeg: string,
  args: string[],
  output: string,
  encoder: string,
  videoBitrate: string | undefined,
  timeout: number,
): Promise<void> {
  const encoders = encoder === "libx264" ? ["libx264"] : [encoder, "libx264"];
  let last = "ffmpeg could not write that video.";
  for (const name of encoders) {
    fs.rmSync(output, { force: true });
    try {
      await run(ffmpeg, [...args, "-c:v", name, ...videoEncodeArgs(name, videoBitrate), output], timeout);
      if (ready(output)) return;
      last = "The video file was empty.";
    } catch (error) {
      last = shortFfmpeg(error);
    }
  }
  throw new Error(last);
}

async function joinSegments(
  ffmpeg: string,
  segments: string[],
  silent: string,
  flick: Flick,
  encoder: string,
  videoBitrate: string | undefined,
): Promise<void> {
  const list = path.join(path.dirname(silent), "list.txt");
  fs.writeFileSync(
    list,
    segments.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
  );
  try {
    await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent], 120000);
    if (ready(silent)) return;
  } catch {
    // Copied pieces did not share a codec. The filter join encodes them.
  }
  fs.rmSync(silent, { force: true });
  const rate = Number.isFinite(flick.fps) && flick.fps > 0 ? flick.fps : 30;
  const parts: string[] = [];
  const labels: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    parts.push(
      `[${index}:v]scale=${flick.width}:${flick.height}:force_original_aspect_ratio=increase,crop=${flick.width}:${flick.height},setsar=1,fps=${rate}[v${index}]`,
    );
    labels.push(`[v${index}]`);
  }
  parts.push(`${labels.join("")}concat=n=${segments.length}:v=1:a=0[v]`);
  const args = ["-y"];
  for (const file of segments) args.push("-i", file);
  args.push("-filter_complex", parts.join(";"), "-map", "[v]", "-an", "-pix_fmt", "yuv420p");
  try {
    await runVideo(ffmpeg, args, silent, encoder, videoBitrate, 120000);
  } catch (error) {
    const reason = error instanceof Error ? error.message : shortFfmpeg(error);
    throw new Error(`Could not join those clips. ${reason}`);
  }
}

async function muxVoice(
  ffmpeg: string,
  silent: string,
  voice: string,
  output: string,
  encoder: string,
  videoBitrate: string | undefined,
): Promise<void> {
  try {
    await run(ffmpeg, ["-y", "-i", silent, "-i", voice, "-c:v", "copy", "-c:a", "aac", "-shortest", output], 120000);
    if (ready(output)) return;
  } catch {
    fs.rmSync(output, { force: true });
  }
  await runVideo(
    ffmpeg,
    ["-y", "-i", silent, "-i", voice, "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
    output,
    encoder,
    videoBitrate,
    120000,
  );
}

async function muxMusic(
  ffmpeg: string,
  silent: string,
  music: string,
  voice: string,
  filter: string,
  drawtext: boolean,
  output: string,
  encoder: string,
  videoBitrate: string | undefined,
): Promise<void> {
  const args = ["-y", "-i", silent, "-stream_loop", "-1", "-i", music];
  if (voice) args.push("-i", voice);
  args.push("-filter_complex", filter);
  if (!drawtext) {
    try {
      await run(ffmpeg, [...args, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", output], 120000);
      if (ready(output)) return;
    } catch {
      fs.rmSync(output, { force: true });
    }
  }
  await runVideo(
    ffmpeg,
    [...args, "-map", drawtext ? "[v]" : "0:v", "-map", "[a]", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
    output,
    encoder,
    videoBitrate,
    120000,
  );
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
