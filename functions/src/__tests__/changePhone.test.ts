import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  verifyPin: jest.fn(async (pin: string) => pin === "246810"),
}));
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

import { notifyUser } from "../utils/notifications";
import { assertResetCooldownAllows } from "../utils/resetCooldown";

const HASH = "p1$$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
const OLD = "+252634000001";
const NEW = "+252634000002";

/** ONBOARDING_SECURITY_REVIEW.md E13: changing the account's number. */
describe("phone number change", () => {
  let restore: (() => void) | undefined;
  let authPhone = OLD;
  let otherOwner: string | null = null;
  let authSpy: jest.SpyInstance;
  let mod: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    authSpy = jest.spyOn(admin, "auth").mockReturnValue({
      getUser: jest.fn(async () => ({ uid: "u1", phoneNumber: authPhone })),
      getUserByPhoneNumber: jest.fn(async () => {
        if (!otherOwner) throw new Error("not found");
        return { uid: otherOwner };
      }),
      revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
      createCustomToken: jest.fn().mockResolvedValue("token"),
    } as any);
    mod = await import("../auth/changePhone");
  });
  beforeEach(() => {
    authPhone = OLD;
    otherOwner = null;
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => {
    authSpy.mockRestore();
    test.cleanup();
  });

  const seed = (user: Record<string, any> = {}, extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      "users/u1": { phoneNumber: OLD, hasPin: true, kycStatus: "pending", ...user },
      "users/u1/private/auth": { pinHash: HASH },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };
  const freshSms = { firebase: { sign_in_provider: "phone" }, phone_number: OLD, auth_time: Math.floor(Date.now() / 1000) };
  const start = (data: any, token: any = freshSms) => test.wrap(mod.startPhoneChange)({ data, auth: { uid: "u1", token } });
  const complete = () => test.wrap(mod.completePhoneChange)({ data: {}, auth: { uid: "u1", token: {} } });

  it("moves the account to the new number after PIN, old-number SMS and new-number SMS", async () => {
    const db = seed();
    await start({ newPhone: NEW, pin: "246810" });
    // The app verifies NEW by SMS and attaches it in Auth.
    authPhone = NEW;
    const res = await complete();
    expect(res.data).toMatchObject({ phoneNumber: NEW, sessionToken: "token" });
    expect(db.get("users/u1")).toMatchObject({ phoneNumber: NEW, previousPhoneNumber: OLD });
    expect(notifyUser).toHaveBeenCalledWith("u1", "phone_changed", expect.any(String), expect.any(String), expect.anything());
    // Then a seven-day pause on sending.
    await expect(assertResetCooldownAllows("u1", "other", 100)).rejects.toMatchObject({
      details: { reason: "phone_change_cooldown" },
    });
  });

  it("needs the PIN", async () => {
    seed();
    await expect(start({ newPhone: NEW, pin: "000000" })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("without a fresh old-number SMS, asks for the ID and checks it", async () => {
    seed(
      { kycStatus: "verified" },
      { "users/u1/kyc/latest": { idNumber: "SL99AB1234", status: "verified" } }
    );
    const stale = { firebase: { sign_in_provider: "custom" } };
    await expect(start({ newPhone: NEW, pin: "246810" }, stale)).rejects.toMatchObject({
      details: { reason: "phone_change_needs_proof" },
    });
    await expect(start({ newPhone: NEW, pin: "246810", idLast4: "0000" }, stale)).rejects.toMatchObject({
      details: { reason: "reset_id_wrong" },
    });
    await expect(start({ newPhone: NEW, pin: "246810", idLast4: "1234" }, stale)).resolves.toMatchObject({ success: true });
  });

  it("refuses a number that belongs to another account", async () => {
    seed({}, { "users/u2": { phoneNumber: NEW } });
    await expect(start({ newPhone: NEW, pin: "246810" })).rejects.toMatchObject({ details: { reason: "phone_taken" } });
  });

  it("won't complete until Auth holds the approved number", async () => {
    const db = seed();
    await expect(complete()).rejects.toMatchObject({ details: { reason: "phone_change_expired" } });
    await start({ newPhone: NEW, pin: "246810" });
    await expect(complete()).rejects.toMatchObject({ details: { reason: "phone_change_unverified" } });
    expect(db.get("users/u1")!.phoneNumber).toBe(OLD);
  });
});
