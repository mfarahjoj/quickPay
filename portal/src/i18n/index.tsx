/**
 * Three languages, as both apps ship: English, Somali, Arabic (right to left).
 * Every key exists in all three (i18n.test.ts); placeholders are {{name}}.
 * Numbers stay in Latin digits everywhere, as the apps write them.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "./en.json";
import so from "./so.json";
import ar from "./ar.json";

export type Lang = "en" | "so" | "ar";
export type StringKey = keyof typeof en;
export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: "en", label: "English" },
  { code: "so", label: "Soomaali" },
  { code: "ar", label: "العربية" },
];

const TABLES: Record<Lang, Record<StringKey, string>> = { en, so, ar };

export function translate(lang: Lang, key: StringKey, params: Record<string, string | number> = {}): string {
  const text = TABLES[lang][key] ?? TABLES.en[key] ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => (name in params ? String(params[name]) : `{{${name}}}`));
}

function initialLang(): Lang {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem("zb.lang") : null;
  if (saved === "en" || saved === "so" || saved === "ar") return saved;
  const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "en";
  return nav === "so" || nav === "ar" ? nav : "en";
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, params?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    localStorage.setItem("zb.lang", l);
    setLangState(l);
  }, []);
  const t = useCallback((key: StringKey, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
