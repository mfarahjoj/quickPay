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

/** "$12.50", as the merchant app shows USD amounts. */
export function formatAmount(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

/** 9:05, or 45s under a minute. */
export function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
