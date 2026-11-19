/**
 * Calendar days for bills, in Hargeisa time (East Africa Time, UTC+3 all
 * year). A due date is a day, "2026-12-01", not a moment: it falls due at the
 * midnight that starts it.
 */

import { Localized } from "../utils/pushTemplates";

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Parts of a valid "YYYY-MM-DD", or null. Rejects 2026-02-30. */
export function parseDay(day: unknown): { y: number; m: number; d: number } | null {
  if (typeof day !== "string") return null;
  const match = DATE_RE.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** Milliseconds at the midnight starting `day` in Hargeisa. */
export function startOfDayMs(day: string): number {
  const p = parseDay(day);
  if (!p) throw new Error(`Not a day: ${day}`);
  return Date.UTC(p.y, p.m - 1, p.d) - OFFSET_MS;
}

/** Today's date in Hargeisa. */
export function hargeisaToday(nowMs: number = Date.now()): string {
  const local = new Date(nowMs + OFFSET_MS);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((startOfDayMs(to) - startOfDayMs(from)) / DAY_MS);
}

export function addDays(day: string, days: number): string {
  return hargeisaToday(startOfDayMs(day) + days * DAY_MS);
}

/**
 * The next due date of a repeating bill. Monthly keeps to `anchorDay`, or the
 * month's last day when it is shorter: 31 Jan → 28 Feb → 31 Mar.
 */
export function nextDue(day: string, interval: "weekly" | "monthly", anchorDay: number): string {
  if (interval === "weekly") return addDays(day, 7);
  const p = parseDay(day)!;
  const y = p.m === 12 ? p.y + 1 : p.y;
  const m = p.m === 12 ? 1 : p.m + 1;
  const d = Math.min(anchorDay, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(d)}`;
}

const MONTHS: Localized[] = [
  { en: "Jan", so: "Jannaayo", ar: "يناير" },
  { en: "Feb", so: "Febraayo", ar: "فبراير" },
  { en: "Mar", so: "Maarso", ar: "مارس" },
  { en: "Apr", so: "Abriil", ar: "أبريل" },
  { en: "May", so: "Maayo", ar: "مايو" },
  { en: "Jun", so: "Juun", ar: "يونيو" },
  { en: "Jul", so: "Luulyo", ar: "يوليو" },
  { en: "Aug", so: "Ogosto", ar: "أغسطس" },
  { en: "Sep", so: "Sebteembar", ar: "سبتمبر" },
  { en: "Oct", so: "Oktoobar", ar: "أكتوبر" },
  { en: "Nov", so: "Noofeembar", ar: "نوفمبر" },
  { en: "Dec", so: "Diseembar", ar: "ديسمبر" },
];

/** "1 Dec" in each language, Latin digits, for pushes. */
export function dayForPush(day: string): Localized {
  const p = parseDay(day)!;
  const month = MONTHS[p.m - 1];
  return { en: `${p.d} ${month.en}`, so: `${p.d} ${month.so}`, ar: `${p.d} ${month.ar}` };
}
