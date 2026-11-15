import en from "./en.json";
import so from "./so.json";
import ar from "./ar.json";
import type { Lang } from "../types";

export type StringKey = keyof typeof en;
const TABLES: Record<Lang, Record<StringKey, string>> = { en, so, ar };

export function translate(lang: Lang, key: StringKey, params: Record<string, string | number> = {}): string {
  const text = TABLES[lang][key] ?? TABLES.en[key] ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ""));
}

export const isRtl = (lang: Lang) => lang === "ar";

/**
 * "$12.50", or "30,000 SLSH" for whole shillings, as the merchant app shows
 * them. Customers pay what this says, so shillings never go through cents.
 */
export function formatAmount(amount: number, currency: string = "USD"): string {
  if (currency === "SLS" || currency === "SLSH") {
    return `${Math.round(amount).toLocaleString("en-US")} SLSH`;
  }
  return "$" + (amount / 100).toFixed(2);
}

/** 9:05, or 45s under a minute. */
export function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
