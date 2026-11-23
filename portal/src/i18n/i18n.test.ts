import { describe, expect, it } from "vitest";
import en from "./en.json";
import so from "./so.json";
import ar from "./ar.json";

describe("i18n", () => {
  it("every key ships in en, so and ar", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(so).sort()).toEqual(keys);
    expect(Object.keys(ar).sort()).toEqual(keys);
    for (const table of [en, so, ar]) for (const v of Object.values(table)) expect(v.trim()).not.toBe("");
  });

  it("keeps the same placeholders in every language", () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect([k, ph(so[k])]).toEqual([k, ph(en[k])]);
      expect([k, ph(ar[k])]).toEqual([k, ph(en[k])]);
    }
  });
});
