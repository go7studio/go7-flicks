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

export function musicVolume(hasVoice: boolean): number {
  return hasVoice ? MUSIC_VOLUME_WITH_VOICE : MUSIC_VOLUME;
}

export function creditDrawtext(fontFile: string, textFile: string): string {
  return `drawtext=fontfile=${quoteFilter(fontFile)}:textfile=${quoteFilter(textFile)}:fontsize=28:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-80`;
}

/** Filter graph for export cut once the silent picture exists. Null means voice-only or silent. */
export function cutAudioFilter(input: { hasVoice: boolean; hasMusic: boolean; drawtext: string | null }): string | null {
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

function quoteFilter(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'")}'`;
}
