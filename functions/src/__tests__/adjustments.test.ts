import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { notifyUser } from "../utils/notifications";

const KEY = "3f2a6c1e-9b4d-4a77-8e21-0c5d7a9f1b33";
const { Timestamp } = admin.firestore;

/** Ops corrections run the real ledger; only pushes are stubbed. */
describe("adminPostAdjustment", () => {
  let post: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    post = test.wrap((await import("../admin/adjustments")).adminPostAdjustment);
  });

  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      "wallets/cust-1": wallet(1_000),
      "wallets/agent-1": wallet(20_000),
      "wallets/frozen-1": wallet(5_000, { frozen: true }),
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
    post({
      data: {
        debitAccount: "platform:fees",
        creditAccount: "user:cust-1",
        amountCents: 2_500,
        reason: "Agent never credited cash-in, receipt seen",
        idempotencyKey: KEY,
        ...data,
      },
      auth,
    });

  it("credits a wallet from platform fees with a balanced entry, row and audit", async () => {
    const db = seed();
    const res = await call();
    const id = res.data.adjustmentId;

    expect(db.get("wallets/cust-1")!.balance).toBe(3_500);
    expect(db.get("ledger_balances/platform:fees")!.balance).toBe(-2_500);

    const entry = db.get(`journal_entries/adjustment_${id}`)!;
    expect(entry.type).toBe("adjustment");
    expect(entry.refs.adjustmentId).toBe(id);

    expect(db.get(`transactions/adjustment_${id}`)).toMatchObject({
      type: "adjustment",
      fromUserId: "system",
      toUserId: "cust-1",
      participants: ["cust-1"],
      amount: 2_500,
    });
    expect(db.get(`adjustments/${id}`)!.postedBy).toBe("admin-1");
    expect(db.get(`admin_audit/${res.data.auditId}`)!.action).toBe("ledger.adjust");
    expect(notifyUser).toHaveBeenCalledWith("cust-1", "adjustment_posted", expect.any(String), expect.any(String), expect.any(Object));
  });

  it("moves value between two wallets", async () => {
    const db = seed();
    await call({ debitAccount: "user:agent-1", creditAccount: "user:cust-1" });
    expect(db.get("wallets/agent-1")!.balance).toBe(17_500);
    expect(db.get("wallets/cust-1")!.balance).toBe(3_500);
  });

  it("posts once when the console retries the same key", async () => {
    const db = seed();
    await call();
    const again = await call();
    expect(again.data.alreadyPosted).toBe(true);
    expect(db.get("wallets/cust-1")!.balance).toBe(3_500);
  });

  it("may take value back from a frozen wallet", async () => {
    const db = seed();
    await call({ debitAccount: "user:frozen-1", creditAccount: "platform:fees" });
    expect(db.get("wallets/frozen-1")!.balance).toBe(2_500);
  });

  it("never takes a wallet below zero", async () => {
    const db = seed();
    await expect(call({ debitAccount: "user:cust-1", creditAccount: "platform:fees", amountCents: 1_001 }))
      .rejects.toThrow(/below zero/);
    expect(db.get("wallets/cust-1")!.balance).toBe(1_000);
  });

  it.each([
    ["a hold", { creditAccount: "platform:cashout_hold" }],
    ["the same account twice", { debitAccount: "user:cust-1" }],
    ["a malformed account", { creditAccount: "users/cust-1" }],
    ["a zero amount", { amountCents: 0 }],
  ])("refuses %s", async (_label, data) => {
    seed();
    await expect(call(data)).rejects.toThrow();
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

  it("needs a super admin once the day's corrections for the account cross the threshold", async () => {
    const recent = {
      debitAccount: "platform:fees",
      creditAccount: "user:cust-1",
      amountCents: 40_000,
      createdAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000),
    };
    const db = seed({ "adjustments/old-1": recent });
    const err = await call({ amountCents: 15_000 }).catch((e: any) => e); // $400 + $150 ≥ $500
    expect(err.details).toMatchObject({ reason: "needs_super" });
    expect(db.get("wallets/cust-1")!.balance).toBe(1_000);

    await call({ amountCents: 15_000 }, adminAuth(["super"], "admin-2"));
    expect(db.get("wallets/cust-1")!.balance).toBe(16_000);
  });
});
