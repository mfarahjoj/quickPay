import { currencyFromApiCode, formatAmount, parseCurrency, toLimitCents } from "../utils/money";
import { DEFAULT_RATES } from "../config/rates";

describe("money helpers", () => {
  it("counts shillings against dollar limits at the rate, rounding up", () => {
    expect(toLimitCents(8_000, "SLS", 8_000)).toBe(100);
    expect(toLimitCents(30_000, "SLS", 8_000)).toBe(375);
    // 1 shilling is a fraction of a cent: it still counts as one.
    expect(toLimitCents(1, "SLS", 8_000)).toBe(1);
    expect(toLimitCents(1_250, "USD", 8_000)).toBe(1_250);
  });

  it("ships a limits rate, set in whole shillings", () => {
    expect(DEFAULT_RATES.slsPerUsd).toBe(8_000);
  });

  it("formats each currency as people write it", () => {
    expect(formatAmount(1_250, "USD")).toBe("$12.50");
    expect(formatAmount(30_000, "SLS")).toBe("30,000 SLSH");
    expect(formatAmount(-500, "USD")).toBe("-$5.00");
  });

  it("reads the API's SLSH as the ledger's SLS", () => {
    expect(currencyFromApiCode("SLSH")).toBe("SLS");
    expect(currencyFromApiCode("USD")).toBe("USD");
    expect(currencyFromApiCode("EUR")).toBeNull();
    expect(parseCurrency(undefined)).toBe("USD");
    expect(parseCurrency("SLS")).toBe("SLS");
    expect(parseCurrency("KES")).toBeNull();
  });
});
