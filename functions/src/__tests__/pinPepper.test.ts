import * as admin from "firebase-admin";
import * as bcrypt from "bcrypt";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

import { hashPin, verifyPin, pinHashNeedsUpgrade } from "../utils/encryption";
import { verifyUserPin } from "../auth/validatePin";
import { isStoredPinHash } from "../auth/pinStore";

/** ONBOARDING_SECURITY_REVIEW.md A2: PINs are peppered before bcrypt. */
describe("PIN pepper", () => {
  let restore: (() => void) | undefined;
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  it("stores bcrypt of the HMAC, not of the PIN", async () => {
    const hash = await hashPin("482915");
    expect(hash.startsWith("p1$")).toBe(true);
    expect(isStoredPinHash(hash)).toBe(true);
    expect(pinHashNeedsUpgrade(hash)).toBe(false);
    // Without the pepper the PIN alone doesn't match.
    expect(await bcrypt.compare("482915", hash.slice(3))).toBe(false);
    expect(await verifyPin("482915", hash)).toBe(true);
    expect(await verifyPin("482916", hash)).toBe(false);
    // Real cost-12 bcrypt, three times: slow on a busy machine.
  }, 30_000);

  it("refuses to hash without the pepper", async () => {
    const saved = process.env.PIN_PEPPER;
    delete process.env.PIN_PEPPER;
    try {
      await expect(hashPin("482915")).rejects.toThrow(/PIN_PEPPER/);
    } finally {
      process.env.PIN_PEPPER = saved;
    }
  });

  it("still accepts a pre-pepper hash, and upgrades it on a correct PIN", async () => {
    const legacy = await bcrypt.hash("482915", 4);
    expect(pinHashNeedsUpgrade(legacy)).toBe(true);
    const db = fakeFirestore({ "users/u1": {}, "users/u1/private/auth": { pinHash: legacy } });
    restore = useFakeFirestore(db);

    await expect(verifyUserPin("u1", "111111")).resolves.toBe(false);
    expect(db.get("users/u1/private/auth")!.pinHash).toBe(legacy);

    await expect(verifyUserPin("u1", "482915")).resolves.toBe(true);
    const upgraded = db.get("users/u1/private/auth")!.pinHash as string;
    expect(upgraded.startsWith("p1$")).toBe(true);
    await expect(verifyUserPin("u1", "482915")).resolves.toBe(true);
  }, 20_000);
});
