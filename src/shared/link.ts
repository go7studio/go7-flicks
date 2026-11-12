/** A link the person pasted. Any http(s) host is accepted. */
export function clipLink(raw: string): string {
  const text = raw.trim();
  if (!text) throw new Error("Paste a link.");
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(text)) return `https://${text}`;
  throw new Error("Paste a link.");
}
