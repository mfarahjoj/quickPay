import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn().mockResolvedValue(true) }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
}));

import { clearRatesCache } from "../config/rates";
import { bonusMonth } from "../referral/referralBonus";

const NEW = "new-1";
const INVITER = "inviter-1";

/**
 * Plan 1.2 / decision D3: no bonus at sign-up; it unlocks on a real action,
 * under rules set in the admin console.
 */
describe("referral bonuses", () => {
  let unlock: (uid: string, e: any) => Promise<boolean>;
  let setupPin: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    unlock = (await import("../referral/referralBonus")).maybeUnlockReferral;
    setupPin = test.wrap((await import("../auth/setupPin")).setupPin);
  });

  beforeEach(() => clearRatesCache());
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const seed = (rates: Record<string, unknown> = {}, extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${NEW}`]: { accountType: "customer", fullName: "New Person", referredBy: INVITER, referralStatus: "pending" },
      [`users/${INVITER}`]: { accountType: "customer", fullName: "Inviter", referralCode: "ABCD1234" },
      [`wallets/${NEW}`]: wallet(0),
      [`wallets/${INVITER}`]: wallet(0),
      "config/rates": rates,
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  it("records the inviter at sign-up and pays nothing yet", async () => {
    const db = fakeFirestore({ [`users/${INVITER}`]: { referralCode: "ABCD1234" }, [`wallets/${INVITER}`]: wallet(0) });
    restore = useFakeFirestore(db);
    await setupPin({
      data: { pin: "135790", fullName: "Brand New", referralCode: "abcd1234" },
      auth: { uid: "brand-new", token: { phone_number: "+252630000077" } },
    });
    expect(db.get("users/brand-new")).toMatchObject({ referredBy: INVITER, referralStatus: "pending" });
    expect(db.get("wallets/brand-new")!.balance).toBe(0);
    expect(db.get(`wallets/${INVITER}`)!.balance).toBe(0);
  });

  it("pays both sides on a first cash-in of at least the minimum", async () => {
    const db = seed();
    expect(await unlock(NEW, { kind: "cash_in", amountCents: 400 })).toBe(false);
    expect(await unlock(NEW, { kind: "cash_in", amountCents: 500 })).toBe(true);
    expect(db.get(`wallets/${NEW}`)!.balance).toBe(100);
    expect(db.get(`wallets/${INVITER}`)!.balance).toBe(100);
    expect(db.get("ledger_balances/platform:promo")!.balance).toBe(-200);
    expect(db.get(`users/${NEW}`)!.referralStatus).toBe("paid");
  });

  it("pays once only", async () => {
    const db = seed();
    await unlock(NEW, { kind: "cash_in", amountCents: 500 });
    expect(await unlock(NEW, { kind: "cash_in", amountCents: 5_000 })).toBe(false);
    expect(db.get(`wallets/${NEW}`)!.balance).toBe(100);
  });

  it("waits for ID verification when the console says so", async () => {
    const db = seed({ referralUnlock: "kyc_verified", referralBonusCents: 250 });
    expect(await unlock(NEW, { kind: "cash_in", amountCents: 5_000 })).toBe(false);
    expect(await unlock(NEW, { kind: "kyc_verified" })).toBe(true);
    expect(db.get(`wallets/${NEW}`)!.balance).toBe(250);
  });

  it("pays nothing when referrals are off", async () => {
    seed({ referralUnlock: "off" });
    expect(await unlock(NEW, { kind: "cash_in", amountCents: 5_000 })).toBe(false);
  });

  it("skips a frozen inviter but still pays the new user", async () => {
    const db = seed({}, { [`users/${INVITER}`]: { accountType: "customer", accountStatus: "frozen" } });
    await unlock(NEW, { kind: "cash_in", amountCents: 500 });
    expect(db.get(`wallets/${NEW}`)!.balance).toBe(100);
    expect(db.get(`wallets/${INVITER}`)!.balance).toBe(0);
  });

  it("stops paying an inviter at the monthly cap", async () => {
    const db = seed(
      { referralMonthlyCapPerReferrer: 2 },
      { [`users/${INVITER}`]: { accountType: "customer", referralBonusMonth: bonusMonth(), referralBonusMonthCount: 2 } }
    );
    await unlock(NEW, { kind: "cash_in", amountCents: 500 });
    expect(db.get(`wallets/${NEW}`)!.balance).toBe(100);
    expect(db.get(`wallets/${INVITER}`)!.balance).toBe(0);
  });

  it("counts a new month from zero", async () => {
    const db = seed(
      { referralMonthlyCapPerReferrer: 2 },
      { [`users/${INVITER}`]: { accountType: "customer", referralBonusMonth: "2000-01", referralBonusMonthCount: 2 } }
    );
    await unlock(NEW, { kind: "cash_in", amountCents: 500 });
    expect(db.get(`wallets/${INVITER}`)!.balance).toBe(100);
    expect(db.get(`users/${INVITER}`)!.referralBonusMonthCount).toBe(1);
  });

  it("ignores users nobody invited", async () => {
    seed({}, { [`users/${NEW}`]: { accountType: "customer" } });
    expect(await unlock(NEW, { kind: "cash_in", amountCents: 5_000 })).toBe(false);
  });
});
