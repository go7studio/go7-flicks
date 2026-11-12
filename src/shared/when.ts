const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PHONE = /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})?(?!\d)/;

export function phoneMadeIso(name: string): string | null {
  const match = PHONE.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.toISOString();
}

export function whenPhrase(label: "Clipped" | "Made", iso: string, now = new Date()): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return year === now.getFullYear() ? `${label} ${month} ${day}` : `${label} ${month} ${day}, ${year}`;
}

export function latestUpdatedAt(flicks: { updatedAt?: string }[]): string | undefined {
  let best: string | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const flick of flicks) {
    if (!flick.updatedAt) continue;
    const ms = Date.parse(flick.updatedAt);
    if (!Number.isFinite(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = flick.updatedAt;
  }
  return best;
}
