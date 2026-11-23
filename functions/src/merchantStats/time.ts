/**
 * Local calendar for the merchant read model: Hargeisa time, the zone every
 * schedule in this backend already runs on. Days and hours are what a shop
 * owner means by "today" and "6pm", wherever the server runs.
 */

export const STATS_TIME_ZONE = "Africa/Mogadishu";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: STATS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const pad = (n: number) => String(n).padStart(2, "0");

export interface LocalParts {
  /** "2026-11-18" */
  day: string;
  /** "2026-11" */
  month: string;
  /** 0–23 */
  hour: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

function wall(ms: number): { y: number; mo: number; d: number; h: number; mi: number } {
  const p: Record<string, string> = {};
  for (const { type, value } of PARTS.formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

export function localParts(ms: number): LocalParts {
  const { y, mo, d, h } = wall(ms);
  return {
    day: `${y}-${pad(mo)}-${pad(d)}`,
    month: `${y}-${pad(mo)}`,
    hour: h,
    weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
  };
}

/** Minutes the local zone is ahead of UTC at that moment. */
function offsetMinutes(ms: number): number {
  const { y, mo, d, h, mi } = wall(ms);
  return Math.round((Date.UTC(y, mo - 1, d, h, mi) - Math.floor(ms / 60000) * 60000) / 60000);
}

function parseDay(day: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Not a day key: ${day}`);
  return [+m[1], +m[2], +m[3]];
}

/** The local day's [start, end) in epoch ms. */
export function dayBounds(day: string): { startMs: number; endMs: number } {
  const [y, mo, d] = parseDay(day);
  const startGuess = Date.UTC(y, mo - 1, d);
  const startMs = startGuess - offsetMinutes(startGuess) * 60000;
  const endGuess = Date.UTC(y, mo - 1, d + 1);
  const endMs = endGuess - offsetMinutes(endGuess) * 60000;
  return { startMs, endMs };
}

export function addDays(day: string, n: number): string {
  const [y, mo, d] = parseDay(day);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parseDay(a);
  const [y2, m2, d2] = parseDay(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
