import * as admin from "firebase-admin";
import * as bcrypt from "bcrypt";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  verifyPin: jest.fn(async (pin: string) => pin === "246810"),
}));

const HASH = "p1$$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
const DAY = 24 * 60 * 60 * 1000;
const { Timestamp } = admin.firestore;
const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);

/** ONBOARDING_SECURITY_REVIEW.md C8 / O3: PIN to trust, 5 phones, 180 days. */
describe("trusted devices", () => {
  let restore: (() => void) | undefined;
  let register: any;
  let login: any;
  let authSpy: jest.SpyInstance;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    register = test.wrap((await import("../auth/trustedDevice")).registerTrustedDevice);
    login = test.wrap((await import("../auth/trustedDevice")).loginWithPin);
    authSpy = jest.spyOn(admin, "auth").mockReturnValue({
      getUser: jest.fn().mockResolvedValue({ uid: "u1" }),
      createCustomToken: jest.fn().mockResolvedValue("token"),
    } as any);
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => {
    authSpy.mockRestore();
    test.cleanup();
  });

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      "users/u1": { hasPin: true },
      "users/u1/private/auth": { pinHash: HASH },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };
  const auth = { uid: "u1", token: {} };
  const devices = (db: FakeDb) => [...db.store.keys()].filter((k) => k.startsWith("trustedDevices/"));

  it("needs the PIN", async () => {
    seed();
    await expect(register({ data: { platform: "ios" }, auth })).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "pin_required" },
    });
    await expect(register({ data: { platform: "ios", pin: "000000" }, auth })).rejects.toMatchObject({
      code: "permission-denied",
    });
    const res = await register({ data: { platform: "ios", pin: "246810", name: "iPhone" }, auth });
    expect(res.data.deviceId).toBeTruthy();
  });

  it("keeps at most five, dropping the least recently used", async () => {
    const five = Object.fromEntries(
      [1, 2, 3, 4, 5].map((i) => [`trustedDevices/d${i}`, { uid: "u1", lastUsedAt: ago(i * DAY), createdAt: ago(100 * DAY) }])
    );
    const db = seed(five);
    await register({ data: { platform: "ios", pin: "246810" }, auth });
    const left = devices(db);
    expect(left).toHaveLength(5);
    expect(left).not.toContain("trustedDevices/d5");
    expect(left).toContain("trustedDevices/d1");
  });

  it("forgets phones idle past 180 days", async () => {
    const db = seed({ "trustedDevices/old": { uid: "u1", lastUsedAt: ago(181 * DAY) } });
    await register({ data: { platform: "ios", pin: "246810" }, auth });
    expect(devices(db)).not.toContain("trustedDevices/old");
  });

  it("won't sign in with an expired phone, and forgets it", async () => {
    const secretHash = await bcrypt.hash("secret", 4);
    const db = seed({ "trustedDevices/old": { uid: "u1", secretHash, lastUsedAt: ago(181 * DAY) } });
    await expect(
      login({ data: { deviceId: "old", deviceSecret: "secret", pin: "246810" } })
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(db.store.has("trustedDevices/old")).toBe(false);
  });

  it("still signs in with a recently used phone", async () => {
    const secretHash = await bcrypt.hash("secret", 4);
    seed({ "trustedDevices/d1": { uid: "u1", secretHash, lastUsedAt: ago(10 * DAY) } });
    const res = await login({ data: { deviceId: "d1", deviceSecret: "secret", pin: "246810" } });
    expect(res.data.token).toBe("token");
  });
});
