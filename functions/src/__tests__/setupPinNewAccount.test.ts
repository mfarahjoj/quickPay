import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  hashPin: jest.fn(async () => "p1$$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234"),
}));

/**
 * 2026-10-19 prod incident: the sign-in device check wrote users/{uid}
 * before setupPin ran, setupPin took the doc's existence to mean "already
 * set up", and the new account got no accountType and no wallet, so every
 * top-up and cash-out failed with "Wallet not found".
 */
describe("setupPin on a doc written before setup", () => {
  let restore: () => void;
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  afterEach(() => restore?.());
  afterAll(() => test.cleanup());

  const auth = { uid: "new1", token: { phone_number: "+252639053864" } };
  const call = async (data: any) => test.wrap((await import("../auth/setupPin")).setupPin)({ data, auth });

  it("still creates the account and its wallet", async () => {
    const db = fakeFirestore({ "users/new1": { deviceRisk: { flagged: false } } });
    restore = useFakeFirestore(db);
    await call({ pin: "482915", fullName: "Mahamed Farah" });
    expect(db.get("users/new1")).toMatchObject({ accountType: "customer", kycStatus: "pending", hasPin: true });
    expect(db.get("wallets/new1")).toMatchObject({ balance: 0, currency: "USD" });
  });

  it("finishes an account left with a PIN but no wallet", async () => {
    const db = fakeFirestore({
      "users/new1": { fullName: "Mahamed Farah", hasPin: true, phoneNumber: "+252639053864" },
      "users/new1/private/auth": { pinHash: "p1$$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234" },
    });
    restore = useFakeFirestore(db);
    const res = await call({ fullName: "Mahamed Farah" });
    expect(res.data.alreadyHasPin).toBe(true);
    expect(db.get("users/new1")!.accountType).toBe("customer");
    expect(db.get("wallets/new1")).toBeDefined();
  });

  it("leaves a finished account's type and wallet alone", async () => {
    const db = fakeFirestore({
      "users/m1": { accountType: "merchant", fullName: "Shop", hasPin: true },
      "users/m1/private/auth": { pinHash: "p1$$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234" },
      "wallets/m1": { balance: 5000, currency: "USD" },
    });
    restore = useFakeFirestore(db);
    await test.wrap((await import("../auth/setupPin")).setupPin)({ data: { fullName: "Shop" }, auth: { uid: "m1", token: {} } });
    expect(db.get("users/m1")!.accountType).toBe("merchant");
    expect(db.get("wallets/m1")!.balance).toBe(5000);
  });
});
