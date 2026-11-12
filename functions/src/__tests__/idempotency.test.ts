import { https } from "firebase-functions/v2";
import {
  isValidIdempotencyKey,
  requireIdempotencyKey,
  scopedEntryId,
} from "../utils/idempotency";

describe("idempotency keys", () => {
  const validKey = "3f2a6c1e-9b4d-4a77-8e21-0c5d7a9f1b33";

  it("accepts a UUID v4", () => {
    expect(isValidIdempotencyKey(validKey)).toBe(true);
    expect(requireIdempotencyKey(validKey)).toBe(validKey);
  });

  it("rejects keys that cannot safely be part of a document ID", () => {
    // Slashes would create a subcollection path; the rest are simply not
    // plausible keys from our own client.
    for (const bad of [
      "short",
      "has/slash/in/it",
      "has spaces here",
      "..",
      "a".repeat(65),
      "",
      null,
      undefined,
      42,
      { key: validKey },
    ]) {
      expect(isValidIdempotencyKey(bad)).toBe(false);
      expect(() => requireIdempotencyKey(bad)).toThrow(https.HttpsError);
    }
  });

  it("gives the same entry ID for the same caller and key", () => {
    expect(scopedEntryId("paymerchant", "cust-1", validKey)).toBe(
      scopedEntryId("paymerchant", "cust-1", validKey)
    );
  });

  it("keeps one caller's key from naming another caller's entry", () => {
    // Without scoping, a customer could send a key they know another customer
    // used and be handed that customer's payment as a replay.
    expect(scopedEntryId("paymerchant", "cust-1", validKey)).not.toBe(
      scopedEntryId("paymerchant", "cust-2", validKey)
    );
  });

  it("separates flows that share a key", () => {
    expect(scopedEntryId("paymerchant", "cust-1", validKey)).not.toBe(
      scopedEntryId("payroll", "cust-1", validKey)
    );
  });
});
