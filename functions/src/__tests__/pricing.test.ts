import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import { clearRatesCache, getRates, resolveRates, DEFAULT_RATES } from "../config/rates";

const test = require("firebase-functions-test")();

const auth = (roles: string[]) => ({
  uid: "admin-1",
  token: { admin: true, adminRoles: roles, email: "a@zapp.example", auth_time: Math.floor(Date.now() / 1000) },
});

describe("pricing & rules (D1, D3)", () => {
  let get: any;
  let update: any;
  let pricing: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const m = await import("../admin/pricing");
    get = test.wrap(m.adminGetRates);
    update = test.wrap(m.adminUpdateRates);
    pricing = test.wrap(m.getPricing);
  });

  beforeEach(() => clearRatesCache());
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const seed = (rates?: Record<string, unknown>): FakeDb => {
    const db = fakeFirestore(rates ? { "config/rates": rates } : {});
    restore = useFakeFirestore(db);
    return db;
  };

  it("defaults to free cash-out and referrals paid after a first cash-in", () => {
    expect(DEFAULT_RATES.cashOutFeeRate).toBe(0);
    expect(DEFAULT_RATES.referralUnlock).toBe("first_cash_in");
  });

  it("reads the old single commission rate into both directions", () => {
    const r = resolveRates({ topupCommissionRate: 0.015 });
    expect(r.cashInCommissionRate).toBe(0.015);
    expect(r.cashOutCommissionRate).toBe(0.015);
    expect(resolveRates({ topupCommissionRate: 0.015, cashOutCommissionRate: 0.01 }).cashOutCommissionRate).toBe(0.01);
  });

  it("falls back to the default for an out-of-range stored value", () => {
    expect(resolveRates({ cashOutFeeRate: 0.5, refundWindowDays: 9000, referralUnlock: "never" })).toMatchObject({
      cashOutFeeRate: 0,
      refundWindowDays: 30,
      referralUnlock: "first_cash_in",
    });
  });

  it("lists every setting with its value and whether it's overridden", async () => {
    seed({ cashOutFeeRate: 0.01 });
    const res = await get({ data: undefined, auth: auth(["ops"]) });
    const fee = res.data.rows.find((r: any) => r.key === "cashOutFeeRate");
    expect(fee).toMatchObject({ value: 0.01, overridden: true });
    expect(res.data.rows.find((r: any) => r.key === "paymentFeeRate").overridden).toBe(false);
  });

  it("lets a super admin change prices, audited, and the change is read at once", async () => {
    const db = seed();
    const res = await update({
      data: { changes: { cashOutFeeRate: 0.01, referralUnlock: "kyc_verified" }, reason: "Pilot pricing from November" },
      auth: auth(["super"]),
    });
    expect(res.data.changed.sort()).toEqual(["cashOutFeeRate", "referralUnlock"]);
    expect(db.get("config/rates")).toMatchObject({ cashOutFeeRate: 0.01, referralUnlock: "kyc_verified", updatedBy: "admin-1" });
    const audit = db.get(`admin_audit/${res.data.auditId}`)!;
    expect(audit).toMatchObject({ action: "rates.update", before: { cashOutFeeRate: 0 }, after: { cashOutFeeRate: 0.01 } });
    expect((await getRates()).cashOutFeeRate).toBe(0.01);
  });

  it("puts a setting back to its default with null", async () => {
    const db = seed({ cashOutFeeRate: 0.01 });
    await update({ data: { changes: { cashOutFeeRate: null }, reason: "Back to free cash-out" }, auth: auth(["super"]) });
    expect(db.get("config/rates")!.cashOutFeeRate).toBeUndefined();
  });

  it("refuses out-of-range values, unknown keys, and anyone but super", async () => {
    seed();
    const err = await update({ data: { changes: { cashOutFeeRate: 0.5 }, reason: "Way too much" }, auth: auth(["super"]) }).catch((e: any) => e);
    expect(err.details).toEqual({ reason: "out_of_range", key: "cashOutFeeRate" });
    await expect(update({ data: { changes: { madeUp: 1 }, reason: "Unknown key here" }, auth: auth(["super"]) })).rejects.toThrow(/Unknown/);
    await expect(update({ data: { changes: { cashOutFeeRate: 0.01 }, reason: "Ops can't price" }, auth: auth(["ops"]) })).rejects.toThrow(/not authorized/i);
  });

  it("tells the apps the cash-out fee and payout time", async () => {
    seed({ cashOutFeeRate: 0.01, payoutTargetHours: 48 });
    const res = await pricing({ data: undefined, auth: { uid: "cust-1" } });
    expect(res.data).toMatchObject({ cashOutFeeRate: 0.01, payoutTargetHours: 48 });
  });
});
