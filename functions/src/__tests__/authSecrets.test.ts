import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  verifyPin: jest.fn(async (pin: string) => pin === "246810"),
}));

import { verifyUserPin } from "../auth/validatePin";
import { LEGACY_PIN_PLACEHOLDER, isStoredPinHash, readAuth } from "../auth/pinStore";
import { legacySecretsOf } from "../admin/authSecretsMigration";

// A plausible bcrypt string; the compare itself is mocked.
const HASH = "$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";

/**
 * ONBOARDING_SECURITY_REVIEW.md A1: the PIN hash and lockout state must not
 * sit on users/{uid}, which the phone reads.
 */
describe("PIN secrets live server-only", () => {
  let restore: (() => void) | undefined;
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const seed = (docs: Record<string, any>): FakeDb => {
    const db = fakeFirestore(docs);
    restore = useFakeFirestore(db);
    return db;
  };

  it("moves a legacy account's secrets on its first PIN check", async () => {
    const db = seed({ "users/u1": { fullName: "A", pinHash: HASH, pinFailedAttempts: 2 } });
    await expect(verifyUserPin("u1", "000000")).resolves.toBe(false);

    const user = db.get("users/u1")!;
    expect(user.pinHash).toBe(LEGACY_PIN_PLACEHOLDER);
    expect(user.pinFailedAttempts).toBeUndefined();
    expect(user.hasPin).toBe(true);
    expect(db.get("users/u1/private/auth")).toMatchObject({ pinHash: HASH, pinFailedAttempts: 3 });

    // And the moved hash still works.
    await expect(verifyUserPin("u1", "246810")).resolves.toBe(true);
    expect(db.get("users/u1/private/auth")!.pinFailedAttempts).toBe(0);
  });

  it("never treats the placeholder as a PIN", async () => {
    expect(isStoredPinHash(LEGACY_PIN_PLACEHOLDER)).toBe(false);
    expect(isStoredPinHash(HASH)).toBe(true);
    expect(isStoredPinHash(`p1$${HASH}`)).toBe(true);
    seed({ "users/u1": { pinHash: LEGACY_PIN_PLACEHOLDER } });
    expect((await readAuth("u1")).pinHash).toBeUndefined();
    await expect(verifyUserPin("u1", "246810")).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("prefers the private copy over a stale legacy one", async () => {
    seed({
      "users/u1": { pinHash: "$2b$12$stale-stale-stale-stale" },
      "users/u1/private/auth": { pinHash: HASH },
    });
    expect((await readAuth("u1")).pinHash).toBe(HASH);
  });

  describe("adminMigrateAuthSecrets", () => {
    const adminAuth = (roles: string[]) => ({
      uid: "admin-1",
      token: { admin: true, adminRoles: roles, email: "a@zapp.example", auth_time: Math.floor(Date.now() / 1000) },
    });
    const run = async (apply: boolean, roles = ["super"]) => {
      const fn = test.wrap((await import("../admin/authSecretsMigration")).adminMigrateAuthSecrets);
      return fn({ data: { apply, reason: "Move PIN secrets (A1)" }, auth: adminAuth(roles) });
    };
    const accounts = () => ({
      "users/legacy": { fullName: "L", pinHash: HASH, pinResetHistory: [admin.firestore.Timestamp.now()] },
      "users/blank": { fullName: "B", pinHash: "" },
      "users/moved": { fullName: "M", pinHash: LEGACY_PIN_PLACEHOLDER, hasPin: true },
      "users/moved/private/auth": { pinHash: HASH },
    });

    it("previews without touching anything", async () => {
      const db = seed(accounts());
      const res = await run(false, ["ops"]);
      expect(res.data).toMatchObject({ applied: false, scanned: 3, toMove: 2, withPin: 1, moved: 0 });
      expect(db.get("users/legacy")!.pinHash).toBe(HASH);
    });

    it("lets only a super admin apply", async () => {
      seed(accounts());
      await expect(run(true, ["ops"])).rejects.toMatchObject({ code: "permission-denied" });
    });

    it("moves every account, and a rerun finds nothing", async () => {
      const db = seed(accounts());
      const res = await run(true);
      expect(res.data).toMatchObject({ applied: true, toMove: 2, moved: 2 });

      expect(db.get("users/legacy")).toMatchObject({ pinHash: LEGACY_PIN_PLACEHOLDER, hasPin: true });
      expect(db.get("users/legacy")!.pinResetHistory).toBeUndefined();
      expect(db.get("users/legacy/private/auth")!.pinHash).toBe(HASH);
      expect(db.get("users/legacy/private/auth")!.pinResetHistory).toHaveLength(1);

      expect(db.get("users/blank")!.pinHash).toBeUndefined();
      expect(db.get("users/blank")!.hasPin).toBe(false);

      const again = await run(true);
      expect(again.data).toMatchObject({ toMove: 0, moved: 0 });
    });

    it("reads legacy secrets correctly", () => {
      expect(legacySecretsOf({ fullName: "x" })).toBeNull();
      expect(legacySecretsOf({ pinHash: LEGACY_PIN_PLACEHOLDER })).toBeNull();
      expect(legacySecretsOf({ pinHash: "" })).toEqual({});
      expect(legacySecretsOf({ pinHash: HASH, pinFailedAttempts: 1 })).toEqual({ pinHash: HASH, pinFailedAttempts: 1 });
    });
  });
});

describe("hard lock (review A3)", () => {
  let restore: (() => void) | undefined;
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("locks for good at the tenth wrong PIN in a row, even for the right PIN", async () => {
    const db = fakeFirestore({ "users/u1": {}, "users/u1/private/auth": { pinHash: HASH, pinFailedAttempts: 9 } });
    restore = useFakeFirestore(db);

    await expect(verifyUserPin("u1", "000000")).resolves.toBe(false);
    expect(db.get("users/u1/private/auth")).toMatchObject({ pinHardLocked: true, pinFailedAttempts: 10 });

    await expect(verifyUserPin("u1", "246810")).rejects.toMatchObject({
      code: "resource-exhausted",
      details: { hardLocked: true },
    });
  });

  it("keeps timed locks below the threshold", async () => {
    const db = fakeFirestore({ "users/u1": {}, "users/u1/private/auth": { pinHash: HASH, pinFailedAttempts: 4 } });
    restore = useFakeFirestore(db);
    await expect(verifyUserPin("u1", "000000")).resolves.toBe(false);
    const auth = db.get("users/u1/private/auth")!;
    expect(auth.pinHardLocked).toBeUndefined();
    expect(auth.pinLockedUntil.toMillis()).toBeGreaterThan(Date.now());
  });
});
