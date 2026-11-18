/** The words after Codex's transcript marker. A plain reply is kept as it is. */
export function codexReply(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const start = lines.lastIndexOf("codex");
  if (start >= 0) {
    const body: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (/^tokens used\b/i.test(line)) break;
      if (isCliNoise(line)) continue;
      body.push(line);
    }
    return body.join(" ").replace(/\s+/g, " ").trim();
  }
  const kept = lines.filter((line) => !isCliNoise(line));
  if (lines.some((line) => /^OpenAI Codex\b/i.test(line) || line === "--------")) return "";
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/** CLI chatter that should not sit on a connection row. */
export function isCliNoise(line: string): boolean {
  const trimmed = line.trim();
  if (/^warning:/i.test(trimmed)) return true;
  if (/no stdin data received/i.test(trimmed)) return true;
  if (/reading additional input from stdin/i.test(trimmed)) return true;
  if (/cursor-retrieval:\s*tracing/i.test(trimmed)) return true;
  if (/^OpenAI Codex\b/i.test(trimmed)) return true;
  if (trimmed === "--------") return true;
  if (/^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):\s+\S+$/i.test(trimmed)) return true;
  if (/^tokens used\b/i.test(trimmed)) return true;
  return false;
}

/** One readable sentence from a program's stdout and stderr. */
export function presentStatus(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCliNoise(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The line a person should read on the Connections row. */
export function connectionNote(kind: string, text: string): string {
  const clean = presentStatus(text);
  if (!clean) return "";
  if (kind === "claude" && /401|oauth|failed to authenticate|token has expired/i.test(clean)) {
    return "Claude is not signed in. The saved login has expired. Paste an API key, or sign in with the Claude program.";
  }
  if (kind === "cursor" && /not logged in|authenticate|CURSOR_API_KEY|login required|sign in/i.test(clean)) {
    return "Cursor is not logged in. Run cursor-agent login, or set CURSOR_API_KEY. This app does not store a Cursor key.";
  }
  if (kind === "grok" && /not signed in|XAI_API_KEY/i.test(clean)) {
    return "Grok is not signed in, and no xAI API key is saved. Paste a key on the Grok row. The host is https://api.x.ai/v1 and the model is grok-4.7.";
  }
  return clean;
}
