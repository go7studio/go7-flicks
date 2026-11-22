import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { visibleRegions } from "../src/shared/canvas";
import { creditDrawtext, cutAudioFilter } from "../src/shared/mix";
import { clipDuration, storedVoiceStart, type Flick, type MediaAsset } from "../src/shared/model";

const exec = promisify(execFile);

/** Styled export reads this. Missing or invalid becomes 0 so the voice starts with the picture. */
export function styledVoiceStart(flick: { voiceStartSec?: number } | null | undefined): number {
  return storedVoiceStart(flick?.voiceStartSec);
}

/** adelay on both channels. Zero and missing stay silent of any delay. */
export function voiceDelayFilter(startSec: number | undefined): string {
  const seconds = storedVoiceStart(startSec);
  if (seconds <= 0) return "";
  const ms = Math.round(seconds * 1000);
  if (ms <= 0) return "";
  return `adelay=${ms}|${ms}`;
}

/** Insert the voice delay on the voice input. The picture map is left alone. */
export function delayVoiceInFilter(filter: string, startSec: number | undefined): string {
  const delay = voiceDelayFilter(startSec);
  if (!delay || !filter.includes("[2:a]")) return filter;
  return filter.replace("[2:a]", `[2:a]${delay},`);
}

/** Pad the voice so a short file does not end the picture. -shortest then stops on the video. */
function voicePadFilter(startSec: number | undefined): string {
  const delay = voiceDelayFilter(startSec);
  const chain = delay ? `${delay},apad` : "apad";
  return `[1:a]${chain}[a]`;
}

/** Copy the picture. Delay only the voice input when the flick asks for it. */
export function voiceMuxArgs(silent: string, voice: string, output: string, startSec: number | undefined): string[] {
  return [
    "-y",
    "-i",
    silent,
    "-i",
    voice,
    "-filter_complex",
    voicePadFilter(startSec),
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    output,
  ];
}

export async function exportCut(input: {
  ffmpeg: string;
  encoder: string;
  channelDir: string;
  flick: Flick;
  media: MediaAsset[];
  outputPath: string;
  voiceFile?: string;
  /** Local paths, already copied off a network drive when that was the source. */
  soundFiles?: Record<string, string>;
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
    const soundHits: { file: string; startSec: number }[] = [];
    let packed = 0;
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
      const soundFile = input.soundFiles?.[clip.id];
      if (clip.soundRelative && !soundFile) throw new Error("The sound file is missing.");
      if (soundFile) soundHits.push({ file: soundFile, startSec: Math.round(packed * 1000) / 1000 });
      packed += span;
      const canCopy =
        asset?.codec === "h264" && asset.width === input.flick.width && asset.height === input.flick.height;
      const budget = cutBudget(span);
      let wrote = false;
      if (canCopy) {
        try {
          await run(
            input.ffmpeg,
            ["-y", ...segmentSeekArgs(start, end, source), "-an", "-c:v", "copy", "-avoid_negative_ts", "make_zero", segment],
            budget,
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
              ...segmentSeekArgs(start, end, source),
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
            budget,
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
    const film = cutBudget(packed);
    await joinSegments(input.ffmpeg, segments, silent, input.flick, input.encoder, input.videoBitrate, film);
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
    const rawFilter = cutAudioFilter({
      hasVoice: voiceReady,
      hasMusic: musicReady,
      drawtext,
      sounds: soundHits.map((hit) => ({ startSec: hit.startSec })),
      voiceStartSec: input.flick.voiceStartSec,
    });
    const filter = soundHits.length || !rawFilter ? rawFilter : delayVoiceInFilter(rawFilter, input.flick.voiceStartSec);
    if (soundHits.length && filter) {
      await muxBed(
        input.ffmpeg,
        silent,
        musicReady && music ? music : "",
        voiceReady && voice ? voice : "",
        soundHits,
        filter,
        Boolean(drawtext),
        input.outputPath,
        input.encoder,
        input.videoBitrate,
        film,
      );
    } else if (!musicReady && voiceReady && voice) {
      await muxVoice(input.ffmpeg, silent, voice, input.outputPath, input.encoder, input.videoBitrate, input.flick.voiceStartSec, film);
    } else if (musicReady && filter && music) {
      await muxMusic(input.ffmpeg, silent, music, voiceReady ? voice : "", filter, Boolean(drawtext), input.outputPath, input.encoder, input.videoBitrate, film);
    } else {
      fs.copyFileSync(silent, input.outputPath);
    }
    if (!ready(input.outputPath)) throw new Error("Export cut did not write a video.");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Fast seek to the in point, and stop on the out point in the source. */
export function segmentSeekArgs(start: number, end: number, source: string): string[] {
  return ["-ss", String(start), "-to", String(end), "-i", source];
}

/** Encode budget grows with the cut. A short clip keeps the two-minute floor. */
export function cutBudget(spanSec: number): number {
  const span = Number.isFinite(spanSec) && spanSec > 0 ? spanSec : 1;
  return Math.min(30 * 60 * 1000, Math.max(120_000, Math.ceil(span * 4_000)));
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
  timeout: number,
): Promise<void> {
  const list = path.join(path.dirname(silent), "list.txt");
  fs.writeFileSync(
    list,
    segments.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
  );
  try {
    await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent], timeout);
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
    await runVideo(ffmpeg, args, silent, encoder, videoBitrate, timeout);
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
  startSec: number | undefined,
  timeout: number,
): Promise<void> {
  try {
    await run(ffmpeg, voiceMuxArgs(silent, voice, output, startSec), timeout);
    if (ready(output)) return;
  } catch {
    fs.rmSync(output, { force: true });
  }
  const lead = ["-y", "-i", silent, "-i", voice, "-filter_complex", voicePadFilter(startSec), "-map", "0:v", "-map", "[a]"];
  await runVideo(
    ffmpeg,
    [...lead, "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
    output,
    encoder,
    videoBitrate,
    timeout,
  );
}

async function muxBed(
  ffmpeg: string,
  silent: string,
  music: string,
  voice: string,
  sounds: { file: string }[],
  filter: string,
  drawtext: boolean,
  output: string,
  encoder: string,
  videoBitrate: string | undefined,
  timeout: number,
): Promise<void> {
  const args = ["-y", "-i", silent];
  if (music) args.push("-stream_loop", "-1", "-i", music);
  if (voice) args.push("-i", voice);
  for (const hit of sounds) args.push("-i", hit.file);
  args.push("-filter_complex", filter);
  if (!drawtext) {
    try {
      await run(ffmpeg, [...args, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", output], timeout);
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
    timeout,
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
  timeout: number,
): Promise<void> {
  const args = ["-y", "-i", silent, "-stream_loop", "-1", "-i", music];
  if (voice) args.push("-i", voice);
  args.push("-filter_complex", filter);
  if (!drawtext) {
    try {
      await run(ffmpeg, [...args, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", output], timeout);
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
    timeout,
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
