import { describe, expect, it } from "vitest";
import en from "./en.json";
import so from "./so.json";
import ar from "./ar.json";
import { formatAmount, formatCountdown, translate } from ".";

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
      expect(ph(so[k])).toEqual(ph(en[k]));
      expect(ph(ar[k])).toEqual(ph(en[k]));
    }
  });
  it("fills placeholders", () => {
    expect(translate("en", "sale.payTo", { shop: "Hodan's Shop" })).toBe("Pay to Hodan's Shop");
  });
  it("formats amounts and countdowns", () => {
    expect(formatAmount(1250)).toBe("$12.50");
    expect(formatAmount(5)).toBe("$0.05");
    expect(formatCountdown(45)).toBe("45s");
    expect(formatCountdown(125)).toBe("2:05");
  });
});
