/**
 * Hargeisa's calendar, as the read model keys it (functions/src/merchantStats/time.ts).
 * A shop's "today" and "6pm" are Hargeisa time on any computer, also an
 * owner's laptop abroad.
 */

export const SHOP_TIME_ZONE = "Africa/Mogadishu";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const pad = (n: number) => String(n).padStart(2, "0");

export interface LocalParts {
  day: string;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

export function localParts(ms: number): LocalParts {
  const p: Record<string, string> = {};
  for (const { type, value } of PARTS.formatToParts(new Date(ms))) p[type] = value;
  const y = +p.year;
  const mo = +p.month;
  const d = +p.day;
  return {
    day: `${y}-${pad(mo)}-${pad(d)}`,
    hour: +p.hour % 24,
    minute: +p.minute,
    weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
  };
}

function parse(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parse(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(day: string): number {
  const [y, m, d] = parse(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parse(a);
  const [y2, m2, d2] = parse(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** The `n` days ending with `last`, oldest first. */
export function dayRange(last: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(last, i - (n - 1)));
}

/** Start of a local day in epoch ms (Hargeisa has no daylight saving). */
export function dayStartMs(day: string): number {
  const [y, m, d] = parse(day);
  return Date.UTC(y, m - 1, d) - 3 * 3600_000;
}
