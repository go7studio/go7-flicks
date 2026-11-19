/** Heard clip audio stays on when a voice file is present. */
export function clipAudible(track: { muted: boolean } | undefined, hasVoice = false): boolean {
  return Boolean(track) && !track?.muted && hasVoice === hasVoice;
}

export const VOICE_VOLUME = 1;
export const MUSIC_VOLUME = 0.22;
export const MUSIC_VOLUME_WITH_VOICE = 0.1;

export const VOICE_GAIN = "1.0";
export const MUSIC_GAIN = "0.22";
export const MUSIC_GAIN_UNDER_VOICE = "0.10";
/** A cut sound sits under the voice. */
export const SOUND_GAIN = "0.45";
export const SOUND_VOLUME = 0.45;

export function musicVolume(hasVoice: boolean): number {
  return hasVoice ? MUSIC_VOLUME_WITH_VOICE : MUSIC_VOLUME;
}

export function creditDrawtext(fontFile: string, textFile: string): string {
  return `drawtext=fontfile=${quoteFilter(fontFile)}:textfile=${quoteFilter(textFile)}:fontsize=28:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-80`;
}

export type CutSound = { startSec: number };

/** Filter graph for export cut once the silent picture exists. Null means voice-only or silent. */
export function cutAudioFilter(input: {
  hasVoice: boolean;
  hasMusic: boolean;
  drawtext: string | null;
  sounds?: CutSound[];
  voiceStartSec?: number;
}): string | null {
  const sounds = (input.sounds ?? []).filter((item) => Number.isFinite(item.startSec) && item.startSec >= 0);
  if (sounds.length) return mixBed(input, sounds);
  if (!input.hasMusic) return null;
  const parts: string[] = [];
  if (input.drawtext) parts.push(`[0:v]${input.drawtext}[v]`);
  if (input.hasVoice) {
    // A short voice must not end the picture. The looped music is the long input, and the cut command stops on the video.
    parts.push(`[2:a]apad,volume=${VOICE_GAIN}[voice]`);
    parts.push(`[1:a]volume=${MUSIC_GAIN_UNDER_VOICE}[music]`);
    parts.push(`[voice][music]amix=inputs=2:normalize=0:duration=longest:dropout_transition=0[a]`);
  } else {
    parts.push(`[1:a]volume=${MUSIC_GAIN}[a]`);
  }
  return parts.join(";");
}

/** Inputs are the silent picture, then music, then voice, then each cut sound. */
function mixBed(
  input: { hasVoice: boolean; hasMusic: boolean; drawtext: string | null; voiceStartSec?: number },
  sounds: CutSound[],
): string {
  const parts: string[] = [];
  if (input.drawtext) parts.push(`[0:v]${input.drawtext}[v]`);
  let next = 1;
  const labels: string[] = [];
  if (input.hasMusic) {
    const gain = input.hasVoice ? MUSIC_GAIN_UNDER_VOICE : MUSIC_GAIN;
    parts.push(`[${next}:a]volume=${gain}[music]`);
    labels.push("[music]");
    next += 1;
  }
  if (input.hasVoice) {
    const delayMs = Math.round(Math.max(0, input.voiceStartSec ?? 0) * 1000);
    const delay = delayMs > 0 ? `adelay=${delayMs}|${delayMs},` : "";
    parts.push(`[${next}:a]${delay}apad,volume=${VOICE_GAIN}[voice]`);
    labels.push("[voice]");
    next += 1;
  }
  sounds.forEach((sound, index) => {
    const delayMs = Math.round(sound.startSec * 1000);
    const delay = delayMs > 0 ? `adelay=${delayMs}|${delayMs},` : "";
    const label = labels.length === 0 && index === sounds.length - 1 ? "[a]" : `[hit${next}]`;
    parts.push(`[${next}:a]${delay}volume=${SOUND_GAIN},apad${label}`);
    if (label !== "[a]") labels.push(label);
    next += 1;
  });
  if (labels.length === 1) {
    const last = parts.length - 1;
    parts[last] = parts[last].replace(/\[[^\]]+\]$/, "[a]");
  } else if (labels.length > 1) {
    parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0[a]`);
  }
  return parts.join(";");
}

function quoteFilter(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'")}'`;
}
