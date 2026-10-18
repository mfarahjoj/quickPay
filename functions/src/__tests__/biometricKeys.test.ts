import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  verifyPin: jest.fn(async (pin: string) => pin === "246810"),
  hashPin: jest.fn(async () => "p1$new"),
}));
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

import { isWeakPin } from "../utils/weakPin";

const HASH = "p1$$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";

/** ONBOARDING_SECURITY_REVIEW.md D11: Face ID signs a server challenge. */
describe("hardware-key biometrics", () => {
  let restore: (() => void) | undefined;
  let mod: any;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const sign = (payload: string, key = privateKey) => crypto.sign("sha256", Buffer.from(payload), key).toString("base64");
  const auth = { uid: "u1", token: {} };
  const call = (name: string, data: any, a: any = auth) => test.wrap(mod[name])({ data, auth: a });

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    mod = await import("../auth/biometricKeys");
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({ "users/u1": { hasPin: true }, "users/u1/private/auth": { pinHash: HASH }, ...extra });
    restore = useFakeFirestore(db);
    return db;
  };

  const tokenFor = async (keyId: string, signer = privateKey) => {
    const { data: ch } = await call("biometricChallenge", {});
    const res = await call("approveBiometric", { challengeId: ch.challengeId, keyId, signature: sign(ch.payload, signer) });
    return res.data.pinToken as string;
  };

  it("registers only with the real PIN, and stores just the public key", async () => {
    const db = seed();
    await expect(call("registerBiometricKey", { publicKey: spki, pin: "000000" })).rejects.toMatchObject({ code: "permission-denied" });
    const { data } = await call("registerBiometricKey", { publicKey: spki, pin: "246810", platform: "ios" });
    expect(db.get(`biometricKeys/${data.keyId}`)).toMatchObject({ uid: "u1", publicKey: spki });
  });

  it("turns a signed challenge into a one-time PIN token", async () => {
    seed();
    const { data } = await call("registerBiometricKey", { publicKey: spki, pin: "246810" });
    const token = await tokenFor(data.keyId);
    expect(token).toMatch(/^bio_[0-9a-f]{32}$/);

    const validate = test.wrap((await import("../auth/validatePin")).validateUserPin);
    await expect(validate({ data: { pin: token }, auth })).resolves.toMatchObject({ data: { valid: true } });
    // Once only.
    await expect(validate({ data: { pin: token }, auth })).resolves.toMatchObject({ data: { valid: false } });
  });

  it("refuses a signature from another key", async () => {
    seed();
    const { data } = await call("registerBiometricKey", { publicKey: spki, pin: "246810" });
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    await expect(tokenFor(data.keyId, other)).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("won't let another account use the token", async () => {
    seed({ "users/u2": { hasPin: true }, "users/u2/private/auth": { pinHash: HASH } });
    const { data } = await call("registerBiometricKey", { publicKey: spki, pin: "246810" });
    const token = await tokenFor(data.keyId);
    const { verifyUserPin } = await import("../auth/validatePin");
    await expect(verifyUserPin("u2", token)).resolves.toBe(false);
  });

  it("says when the key is gone, so the app falls back to the PIN", async () => {
    seed();
    const { data } = await call("registerBiometricKey", { publicKey: spki, pin: "246810" });
    await call("removeBiometricKey", { keyId: data.keyId });
    await expect(tokenFor(data.keyId)).rejects.toMatchObject({ details: { reason: "biometric_key_gone" } });
  });

  it("can never become a new PIN", () => {
    expect(isWeakPin("bio_" + "a".repeat(32))).toBe(true);
  });
});
