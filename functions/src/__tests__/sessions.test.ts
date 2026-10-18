import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  verifyPin: jest.fn(async (pin: string) => pin === "246810"),
  hashPin: jest.fn(async () => "p1$new-hash"),
}));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { notifyUser } from "../utils/notifications";

const HASH = "p1$$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
const revoke = jest.fn().mockResolvedValue(undefined);
const mint = jest.fn().mockResolvedValue("custom-token");

/** ONBOARDING_SECURITY_REVIEW.md A5: these flows end every other session. */
describe("ending sessions", () => {
  let restore: (() => void) | undefined;
  let authSpy: jest.SpyInstance;

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
    authSpy = jest
      .spyOn(admin, "auth")
      .mockReturnValue({ revokeRefreshTokens: revoke, createCustomToken: mint } as any);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    restore = useFakeFirestore(
      fakeFirestore({
        "users/u1": { fullName: "A", hasPin: true },
        "users/u1/private/auth": { pinHash: HASH },
        "wallets/u1": wallet(1_000),
        "trustedDevices/d1": { uid: "u1" },
      })
    );
  });
  afterEach(() => restore?.());
  afterAll(() => {
    authSpy.mockRestore();
    test.cleanup();
  });

  const user = { uid: "u1", token: { auth_time: Math.floor(Date.now() / 1000) } };

  it("on a PIN change, and tells the owner", async () => {
    const fn = test.wrap((await import("../auth/changePin")).changePin);
    const res = await fn({ data: { currentPin: "246810", newPin: "482915" }, auth: user });
    expect(revoke).toHaveBeenCalledWith("u1");
    expect(res.data.sessionToken).toBe("custom-token");
    expect(notifyUser).toHaveBeenCalledWith("u1", "pin_changed", expect.any(String), expect.any(String), expect.anything());
  });

  it("on revoking devices", async () => {
    const fn = test.wrap((await import("../auth/trustedDevice")).revokeTrustedDevices);
    const res = await fn({ data: {}, auth: user });
    expect(revoke).toHaveBeenCalledWith("u1");
    expect(res.data).toMatchObject({ revoked: 1, sessionToken: "custom-token" });
  });

  it("on freezing your own account", async () => {
    const fn = test.wrap((await import("../auth/freezeMyAccount")).freezeMyAccount);
    const res = await fn({ data: { pin: "246810" }, auth: user });
    expect(revoke).toHaveBeenCalledWith("u1");
    expect(res.data.sessionToken).toBe("custom-token");
  });

  it("on an admin freeze, with no token for anyone", async () => {
    const fn = test.wrap((await import("../admin/setAccountStatus")).adminSetAccountStatus);
    await fn({
      data: { userId: "u1", status: "frozen", reason: "Reported stolen phone" },
      auth: { uid: "ops-1", token: { admin: true, adminRoles: ["ops"], email: "o@zapp.example", auth_time: Math.floor(Date.now() / 1000) } },
    });
    expect(revoke).toHaveBeenCalledWith("u1");
    expect(mint).not.toHaveBeenCalled();
  });

  it("still completes the change when revoking fails", async () => {
    revoke.mockRejectedValueOnce(new Error("auth down"));
    const fn = test.wrap((await import("../auth/changePin")).changePin);
    const res = await fn({ data: { currentPin: "246810", newPin: "482915" }, auth: user });
    expect(res.success).toBe(true);
    expect(res.data.sessionToken).toBeUndefined();
  });
});

describe("idle sign-out (review C10)", () => {
  let restore: (() => void) | undefined;
  const revoke = jest.fn().mockResolvedValue(undefined);
  let authSpy: jest.SpyInstance;
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (ms: number) => admin.firestore.Timestamp.fromMillis(Date.now() - ms);

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
    authSpy = jest.spyOn(admin, "auth").mockReturnValue({ revokeRefreshTokens: revoke } as any);
  });
  afterEach(() => restore?.());
  afterAll(() => authSpy.mockRestore());

  it("ends sessions once for accounts unused past 30 days", async () => {
    const db = fakeFirestore({
      "users/idle": { lastActiveAt: ago(31 * DAY) },
      "users/done": { lastActiveAt: ago(40 * DAY), sessionsRevokedAt: ago(35 * DAY) },
      "users/fresh": { lastActiveAt: ago(2 * DAY) },
    });
    restore = useFakeFirestore(db);
    const { expireIdleSessionsNow } = await import("../auth/sessions");
    await expect(expireIdleSessionsNow()).resolves.toBe(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("idle");
    await expect(expireIdleSessionsNow()).resolves.toBe(0);
  });

  it("counts a correct PIN as use", async () => {
    const db = fakeFirestore({ "users/u1": {}, "users/u1/private/auth": { pinHash: HASH } });
    restore = useFakeFirestore(db);
    const { verifyUserPin } = await import("../auth/validatePin");
    await verifyUserPin("u1", "246810");
    expect(db.get("users/u1")!.lastActiveAt.toMillis()).toBeGreaterThan(Date.now() - 60_000);
  });
});
