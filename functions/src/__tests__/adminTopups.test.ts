import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
}));

import { notifyTopupCompleted } from "../utils/notifications";

const KEY = "7b1d2e4f-3c5a-4e6b-9f80-1a2b3c4d5e6f";
const { Timestamp } = admin.firestore;

/** Console top-ups run the real ledger; only pushes are stubbed. */
describe("adminTopupWallet", () => {
  let topup: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    topup = test.wrap((await import("../admin/topups")).adminTopupWallet);
  });

  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      "config/rates": { slsPerUsd: 8_000, floatApprovalThresholdCents: 50_000 },
      "wallets/cust-1": wallet(1_000),
      "wallets/frozen-1": wallet(1_000, { frozen: true }),
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const adminAuth = (roles = ["ops"], uid = "admin-1") => ({
    uid,
    token: {
      admin: true,
      adminRoles: roles,
      email: `${uid}@zapp.example`,
      auth_time: Math.floor(Date.now() / 1000),
    },
  });

  const call = (data: Record<string, unknown> = {}, auth: any = adminAuth()) =>
    topup({
      data: {
        uid: "cust-1",
        amountCents: 2_500,
        currency: "USD",
        source: "bank",
        reference: "DAH-2026-11-15-001",
        reason: "Business transfer received, slip checked",
        idempotencyKey: KEY,
        ...data,
      },
      auth,
    });

  it("tops up dollars from the bank float with an entry, a top-up row and an audit", async () => {
    const db = seed();
    const res = await call();
    const id = res.data.topupId;

    expect(db.get("wallets/cust-1")!.balance).toBe(3_500);
    expect(db.get("ledger_balances/float:bank")!.balance).toBe(-2_500);

    const entry = db.get(`journal_entries/admin_topup_${id}`)!;
    expect(entry.type).toBe("admin_topup");
    expect(entry.currency).toBe("USD");

    expect(db.get(`transactions/admin_topup_${id}`)).toMatchObject({
      type: "topup",
      kind: "bank_topup",
      toUserId: "cust-1",
      participants: ["cust-1"],
      amount: 2_500,
      currency: "USD",
      reference: "DAH-2026-11-15-001",
    });
    expect(db.get(`admin_topups/${id}`)).toMatchObject({ uid: "cust-1", source: "bank", postedBy: "admin-1" });
    expect(notifyTopupCompleted).toHaveBeenCalledWith("cust-1", 2_500, "USD", "bank");
  });

  it("tops up shillings from the Zaad shilling float, leaving dollars alone", async () => {
    const db = seed();
    const res = await call({ amountCents: 300_000, currency: "SLS", source: "zaad" });

    expect(db.get("wallets/cust-1")!.sls.balance).toBe(300_000);
    expect(db.get("wallets/cust-1")!.balance).toBe(1_000);
    expect(db.get("ledger_balances/float:zaad@SLS")!.balance).toBe(-300_000);
    expect(db.get("ledger_balances/float:zaad")).toBeUndefined();
    expect(db.get(`transactions/admin_topup_${res.data.topupId}`)).toMatchObject({
      kind: "mobile_money_topup",
      currency: "SLS",
      amount: 300_000,
    });
    expect(notifyTopupCompleted).toHaveBeenCalledWith("cust-1", 300_000, "SLS", "zaad");
  });

  it("posts once when the console retries the same key", async () => {
    const db = seed();
    await call();
    const again = await call();
    expect(again.data.alreadyPosted).toBe(true);
    expect(db.get("wallets/cust-1")!.balance).toBe(3_500);
    expect(notifyTopupCompleted).toHaveBeenCalledTimes(1);
  });

  it("refuses a frozen wallet and an account with no wallet", async () => {
    const db = seed();
    await expect(call({ uid: "frozen-1" })).rejects.toThrow(/frozen/);
    expect(db.get("wallets/frozen-1")!.balance).toBe(1_000);
    await expect(call({ uid: "nobody" })).rejects.toThrow(/no wallet/);
  });

  it.each([
    ["an unknown source", { source: "fees" }],
    ["an unknown currency", { currency: "EUR" }],
    ["a zero amount", { amountCents: 0 }],
    ["a fractional amount", { amountCents: 10.5 }],
    ["a missing reference", { reference: " " }],
    ["a missing uid", { uid: "" }],
    ["a path in the uid", { uid: "cust-1/x" }],
    ["more than the cap", { amountCents: 100_000_01 }],
  ])("refuses %s", async (_label, data) => {
    const db = seed();
    await expect(call(data, adminAuth(["super"]))).rejects.toThrow();
    expect(db.get("wallets/cust-1")!.balance).toBe(1_000);
  });

  it("needs a reason and an idempotency key", async () => {
    seed();
    await expect(call({ reason: "" })).rejects.toThrow();
    await expect(call({ idempotencyKey: "x" })).rejects.toThrow(/idempotencyKey/);
  });

  it("refuses non-admins and compliance-only admins", async () => {
    seed();
    await expect(call({}, { uid: "cust-1", token: {} })).rejects.toThrow(/not authorized/i);
    await expect(call({}, adminAuth(["compliance"]))).rejects.toThrow(/not authorized/i);
  });

  it("counts shillings at the rate towards the senior threshold", async () => {
    seed();
    // 4,000,000 shillings is $500.
    const err = await call({ amountCents: 4_000_000, currency: "SLS", source: "zaad" }).catch((e: any) => e);
    expect(err.details).toMatchObject({ reason: "needs_super" });
  });

  it("needs a super admin once the day's top-ups for the wallet cross the threshold", async () => {
    const recent = {
      uid: "cust-1",
      amountCents: 40_000,
      currency: "USD",
      source: "bank",
      createdAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000),
    };
    const db = seed({ "admin_topups/old-1": recent });
    const err = await call({ amountCents: 15_000 }).catch((e: any) => e); // $400 + $150 ≥ $500
    expect(err.details).toMatchObject({ reason: "needs_super" });
    expect(db.get("wallets/cust-1")!.balance).toBe(1_000);

    await call({ amountCents: 15_000 }, adminAuth(["super"], "admin-2"));
    expect(db.get("wallets/cust-1")!.balance).toBe(16_000);
  });
});
