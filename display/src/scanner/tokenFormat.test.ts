import { describe, expect, it } from "vitest";
import fixtures from "../../../functions/src/counterDisplay/__fixtures__/scannedTokens.json";
import { normaliseScannedToken } from "./tokenFormat";

describe("normaliseScannedToken (shared fixture with the server)", () => {
  for (const f of fixtures as { name: string; raw: string; expected: string | null }[]) {
    it(f.name, () => expect(normaliseScannedToken(f.raw)).toBe(f.expected));
  }
  it("refuses non-strings and huge input", () => {
    expect(normaliseScannedToken(undefined)).toBeNull();
    expect(normaliseScannedToken(42)).toBeNull();
    expect(normaliseScannedToken("v2:" + "a".repeat(5000))).toBeNull();
  });
});
