import * as admin from "firebase-admin";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  verifyPin: jest.fn(async (pin: string) => pin === "246810"),
}));

jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));
import { notifyUser } from "../utils/notifications";

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
      revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
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

  describe("the phone's secret: a plain hash beside bcrypt", () => {
    const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
    const signIn = (deviceSecret: string) => login({ data: { deviceId: "d1", deviceSecret, pin: "246810" } });

    it("keeps both for a new phone", async () => {
      const db = seed();
      const res = await register({ data: { platform: "ios", pin: "246810" }, auth });
      const doc = db.get(`trustedDevices/${res.data.deviceId}`)!;
      expect(doc.secretSha256).toBe(sha(res.data.deviceSecret));
      // resetPin still checks this one.
      expect(await bcrypt.compare(res.data.deviceSecret, doc.secretHash)).toBe(true);
    });

    it("signs in on the plain hash, before bcrypt", async () => {
      // bcrypt here would refuse, so only the plain hash can let this in.
      const secretHash = await bcrypt.hash("something-else", 4);
      seed({ "trustedDevices/d1": { uid: "u1", secretSha256: sha("secret"), secretHash, lastUsedAt: ago(DAY) } });
      expect((await signIn("secret")).data.token).toBe("token");
    });

    it("adds the plain hash to a phone trusted before it", async () => {
      const secretHash = await bcrypt.hash("secret", 4);
      const db = seed({ "trustedDevices/d1": { uid: "u1", secretHash, lastUsedAt: ago(DAY) } });
      expect((await signIn("secret")).data.token).toBe("token");
      expect(db.get("trustedDevices/d1")!.secretSha256).toBe(sha("secret"));
    });

    it("refuses a wrong secret and counts it", async () => {
      const secretHash = await bcrypt.hash("secret", 4);
      const db = seed({ "trustedDevices/d1": { uid: "u1", secretSha256: sha("secret"), secretHash, lastUsedAt: ago(DAY) } });
      await expect(signIn("wrong")).rejects.toMatchObject({ code: "permission-denied" });
      expect(db.get("trustedDevices/d1")!.secretFailedAttempts).toBe(1);
      expect(db.get("trustedDevices/d1")!.secretSha256).toBe(sha("secret"));
    });

    it("falls back to bcrypt when the plain hash disagrees, and corrects it", async () => {
      const secretHash = await bcrypt.hash("secret", 4);
      const db = seed({ "trustedDevices/d1": { uid: "u1", secretSha256: sha("other"), secretHash, lastUsedAt: ago(DAY) } });
      expect((await signIn("secret")).data.token).toBe("token");
      expect(db.get("trustedDevices/d1")!.secretSha256).toBe(sha("secret"));
    });

    it("refuses a phone with neither hash", async () => {
      seed({ "trustedDevices/d1": { uid: "u1", lastUsedAt: ago(DAY) } });
      await expect(signIn("secret")).rejects.toMatchObject({ code: "permission-denied" });
    });
  });

  it("alerts the owner when a phone is trusted", async () => {
    seed();
    await register({ data: { platform: "ios", pin: "246810", name: "iPhone" }, auth });
    expect(notifyUser).toHaveBeenCalledWith(
      "u1",
      "new_device",
      { key: "security.new_device", params: { device: "iPhone" } },
      expect.anything()
    );
  });

  describe("the owner's list (review C9)", () => {
    const call = async (name: string, data: any, uid = "u1") =>
      test.wrap((await import("../auth/trustedDevice") as any)[name])({ data, auth: { uid, token: {} } });

    it("lists live phones, newest use first, without secrets", async () => {
      seed({
        "trustedDevices/a": { uid: "u1", name: "Old", platform: "ios", secretHash: "x", lastUsedAt: ago(9 * DAY) },
        "trustedDevices/b": { uid: "u1", name: "New", platform: "android", secretHash: "x", lastUsedAt: ago(1 * DAY) },
        "trustedDevices/c": { uid: "u1", secretHash: "x", lastUsedAt: ago(200 * DAY) },
        "trustedDevices/z": { uid: "someone-else", secretHash: "x", lastUsedAt: ago(1 * DAY) },
      });
      const res = await call("listMyDevices", {});
      expect(res.data.devices.map((d: any) => d.deviceId)).toEqual(["b", "a"]);
      expect(JSON.stringify(res.data)).not.toContain("secretHash");
    });

    it("renames and removes only your own", async () => {
      const db = seed({
        "trustedDevices/a": { uid: "u1", name: "Old" },
        "trustedDevices/z": { uid: "someone-else" },
      });
      await call("renameMyDevice", { deviceId: "a", name: "Shop phone" });
      expect(db.get("trustedDevices/a")!.name).toBe("Shop phone");
      await expect(call("removeMyDevice", { deviceId: "z" })).rejects.toMatchObject({ code: "not-found" });
      expect(db.store.has("trustedDevices/z")).toBe(true);
      await call("removeMyDevice", { deviceId: "a" });
      expect(db.store.has("trustedDevices/a")).toBe(false);
    });
  });
});
