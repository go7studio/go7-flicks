/** Short reason when the microphone cannot start. Never throws. */
export function microphoneMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Microphone permission was denied.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone is busy.";
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Could not use the microphone.";
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const triple = (first << 16) | (second << 8) | third;
    output += BASE64[(triple >> 18) & 63];
    output += BASE64[(triple >> 12) & 63];
    output += hasSecond ? BASE64[(triple >> 6) & 63] : "=";
    output += hasThird ? BASE64[triple & 63] : "=";
  }
  return output;
}
