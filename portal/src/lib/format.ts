/**
 * Numbers as the merchant app writes them, in every language: Latin digits,
 * "$12.50" for dollars and "30,000 SLSH" for whole shillings.
 */

import { localParts, SHOP_TIME_ZONE } from "./time";
import { Currency } from "./types";

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Amounts and names keep their own reading order inside Arabic text: an
 * amount is isolated left to right ("125,000 SLSH", "-$4.50" stay whole),
 * a name takes the direction of its first letter ("Khadar J." keeps its dot).
 * The marks are invisible and change nothing in English or Somali.
 */
export const ltr = (s: string) => `⁦${s}⁩`;
export const iso = (s: string) => `⁨${s}⁩`;
/** Without the marks, for tests and comparisons. */
export const plain = (s: string) => s.replace(/[⁦-⁩]/g, "");

/** Exact: "$1,234.50", "30,000 SLSH", isolated for right-to-left text. */
export function money(amount: number, currency: Currency): string {
  return ltr(moneyPlain(amount, currency));
}

export function moneyPlain(amount: number, currency: Currency): string {
  if (currency === "SLS") return `${int.format(Math.round(amount))} SLSH`;
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${two.format(Math.abs(amount) / 100)}`;
}

function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `${sign}${int.format(abs)}`;
}

/** For tiles and axes: "$12.9K", "$840", "1.2M SLSH". Under $10,000, whole dollars. */
export function moneyShort(amount: number, currency: Currency): string {
  if (currency === "SLS") return ltr(`${compactNumber(amount)} SLSH`);
  const dollars = amount / 100;
  if (Math.abs(dollars) < 100) return money(amount, currency);
  return ltr(`${dollars < 0 ? "-" : ""}$${compactNumber(Math.abs(Math.round(dollars)))}`);
}

export function count(n: number): string {
  return int.format(n);
}

export function pct(n: number): string {
  return ltr(`${n > 0 ? "+" : ""}${n}%`);
}

/** "14:05", Hargeisa time. */
export function clock(ms: number): string {
  const p = localParts(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "5pm"-style hour labels are English-only; a 24-hour "17:00" reads in every language. */
export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** "18 Nov", in Hargeisa. */
export function shortDate(day: string, lang: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : lang === "so" ? "so" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function weekdayName(weekday: number, lang: string, style: "long" | "short" = "long"): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : lang === "so" ? "so" : "en-GB", {
    weekday: style,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));
}

export { SHOP_TIME_ZONE };
