import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";
import { prepareJournalEntry, userAccount, InsufficientBalanceError } from "../ledger";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const { Timestamp } = admin.firestore;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);

const CUSTOMER = "cust-1";
const MERCHANT = "shop-1";
const FRIEND = "friend-1";
const AGENT = "agent-1";

/**
 * Disputes run the real ledger, refund core and adjustment desk against the
 * in-memory Firestore. Only PIN checks and pushes are stubbed.
 */
describe("disputes", () => {
  let open: any;
  let message: any;
  let withdraw: any;
  let resolve: any;
  let refundPayment: any;
  let collect: (limit?: number) => Promise<number>;
  let escalate: (now?: any) => Promise<number>;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const d = await import("../disputes/disputes");
    const r = await import("../disputes/resolve");
    open = test.wrap(d.openDispute);
    message = test.wrap(d.postDisputeMessage);
    withdraw = test.wrap(d.withdrawDispute);
    resolve = test.wrap(r.adminResolveDispute);
    collect = r.collectAwaitingDisputes;
    escalate = r.escalateUnansweredDisputes;
    refundPayment = test.wrap((await import("../qr-payments/refundPayment")).refundPayment);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const payment = (extra: Record<string, any> = {}) => ({
    type: "payment",
    fromUserId: CUSTOMER,
    toUserId: MERCHANT,
    participants: [CUSTOMER, MERCHANT],
    amount: 1_000,
    feeCents: 10,
    netCents: 990,
    currency: "USD",
    status: "completed",
    journalEntryId: "qrpay_q1",
    createdAt: ago(DAY_MS),
    completedAt: ago(DAY_MS),
    ...extra,
  });

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina" },
      [`users/${MERCHANT}`]: { accountType: "merchant", fullName: "Hooyo Shop" },
      [`users/${FRIEND}`]: { accountType: "customer", fullName: "Ali" },
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Agent" },
      [`wallets/${CUSTOMER}`]: wallet(0),
      [`wallets/${MERCHANT}`]: wallet(5_000),
      [`wallets/${FRIEND}`]: wallet(2_000),
      [`wallets/${AGENT}`]: wallet(10_000),
      "journal_entries/qrpay_q1": { type: "qr_payment" },
      "journal_entries/p2p_t1": { type: "p2p" },
      "transactions/pay-1": payment(),
      "transactions/old-1": payment({ createdAt: ago(70 * DAY_MS), completedAt: ago(70 * DAY_MS) }),
      "transactions/p2p-1": {
        ...payment({ toUserId: FRIEND, participants: [CUSTOMER, FRIEND], amount: 2_000 }),
        feeCents: undefined,
        netCents: undefined,
        journalEntryId: "p2p_t1",
      },
      "transactions/co-1": {
        type: "withdrawal",
        fromUserId: CUSTOMER,
        toUserId: AGENT,
        participants: [CUSTOMER, AGENT],
        amount: 3_000,
        currency: "USD",
        status: "completed",
        holdEntryId: "cashout_hold_c1",
        journalEntryId: "cashout_settle_c1",
        createdAt: ago(HOUR_MS),
      },
      "agentTopupRequests/atr-1": {
        customerId: CUSTOMER,
        amount: 4_000,
        status: "expired",
        createdAt: ago(2 * HOUR_MS),
        expiresAt: ago(HOUR_MS),
      },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const raise = (data: Record<string, unknown>, uid = CUSTOMER) =>
    open({ data: { kind: "not_received", note: "Paid but got nothing", ...data }, auth: { uid } });

  const adminAuth = (roles = ["ops"]) => ({
    uid: "admin-1",
    token: { admin: true, adminRoles: roles, email: "ops@zapp.example", auth_time: Math.floor(Date.now() / 1000) },
  });
  const decide = (data: Record<string, unknown>, auth: any = adminAuth()) =>
    resolve({ data: { reason: "Checked receipts with both sides", ...data }, auth });

  const dispute = (db: FakeDb, id: string) => db.get(`disputes/${id}`)!;
  const balance = (db: FakeDb, uid: string) => db.get(`wallets/${uid}`)!.balance;

  describe("openDispute", () => {
    it("opens a claim on a shop payment for the merchant to answer", async () => {
      const db = seed();
      const res = await raise({ transactionId: "pay-1" });
      const d = dispute(db, res.data.disputeId);
      expect(res.data).toEqual({ disputeId: "pay-1_cust-1", status: "open" });
      expect(d).toMatchObject({
        disputedKind: "shop_payment",
        kind: "not_received",
        raisedBy: CUSTOMER,
        against: MERCHANT,
        participants: [CUSTOMER, MERCHANT],
        amountCents: 1_000,
      });
      expect(d.respondBy.toMillis() - d.createdAt.toMillis()).toBe(72 * HOUR_MS);
      expect(d.resolveBy.toMillis() - d.createdAt.toMillis()).toBe(168 * HOUR_MS);
      expect(db.get("transactions/pay-1")!.disputeId).toBe("pay-1_cust-1");
      expect(notifyUser).toHaveBeenCalledWith(MERCHANT, "dispute_opened", expect.any(String), expect.any(String), expect.any(Object));
    });

    it("refuses a claim that doesn't fit the movement", async () => {
      seed();
      const err = await raise({ transactionId: "pay-1", kind: "cash_not_given" }).catch((e: any) => e);
      expect(err.details.reason).toBe("kind_not_allowed");
    });

    it("lets the merchant raise only 'other' on a payment they received", async () => {
      seed();
      await expect(raise({ transactionId: "pay-1" }, MERCHANT)).rejects.toThrow(/doesn't fit/);
      const res = await raise({ transactionId: "pay-1", kind: "other" }, MERCHANT);
      expect(res.data.status).toBe("open");
    });

    it("refuses someone who wasn't part of it", async () => {
      seed();
      await expect(raise({ transactionId: "pay-1" }, FRIEND)).rejects.toThrow(/weren't part/);
    });

    it("refuses after the 60-day window", async () => {
      seed();
      const err = await raise({ transactionId: "old-1" }).catch((e: any) => e);
      expect(err.details).toEqual({ reason: "dispute_window_closed", disputeWindowDays: 60 });
    });

    it("allows one dispute per transaction per person", async () => {
      seed();
      await raise({ transactionId: "pay-1" });
      const err = await raise({ transactionId: "pay-1" }).catch((e: any) => e);
      expect(err.details.reason).toBe("already_disputed");
    });

    it("refuses claiming more than the transaction", async () => {
      seed();
      await expect(raise({ transactionId: "pay-1", amountCents: 1_001 })).rejects.toThrow(/no more than/);
    });

    it("sends an uncredited cash-in straight to ops, with nobody to answer", async () => {
      const db = seed();
      const res = await raise({ agentTopupRequestId: "atr-1", kind: "cash_given_not_credited" });
      expect(res.data.status).toBe("under_review");
      expect(dispute(db, res.data.disputeId)).toMatchObject({
        against: null,
        participants: [CUSTOMER],
        amountCents: 4_000,
        disputedKind: "uncredited_cash_in",
      });
    });

    it("caps how many disputes one person has open", async () => {
      const extra: Record<string, any> = {};
      for (let i = 0; i < 5; i++) {
        extra[`disputes/busy-${i}`] = { raisedBy: CUSTOMER, status: "open" };
      }
      seed(extra);
      const err = await raise({ transactionId: "pay-1" }).catch((e: any) => e);
      expect(err.details.reason).toBe("too_many_disputes");
    });
  });

  describe("thread and withdrawal", () => {
    it("hands the dispute to ops when the merchant replies", async () => {
      const db = seed();
      const { data } = await raise({ transactionId: "pay-1" });
      const res = await message({ data: { disputeId: data.disputeId, text: "Goods were collected" }, auth: { uid: MERCHANT } });
      expect(res.data.status).toBe("under_review");
      expect(dispute(db, data.disputeId).messages).toHaveLength(2);
      await expect(
        message({ data: { disputeId: data.disputeId, text: "Hello there" }, auth: { uid: FRIEND } })
      ).rejects.toThrow(/isn't your dispute/);
    });

    it("lets only the raiser withdraw", async () => {
      const db = seed();
      const { data } = await raise({ transactionId: "pay-1" });
      await expect(withdraw({ data: { disputeId: data.disputeId }, auth: { uid: MERCHANT } })).rejects.toThrow(/Only the person/);
      await withdraw({ data: { disputeId: data.disputeId }, auth: { uid: CUSTOMER } });
      expect(dispute(db, data.disputeId).status).toBe("withdrawn");
    });

    it("escalates an open dispute nobody answered in time", async () => {
      const db = seed();
      const { data } = await raise({ transactionId: "pay-1" });
      expect(await escalate(Timestamp.fromMillis(Date.now() + 73 * HOUR_MS))).toBe(1);
      expect(dispute(db, data.disputeId).status).toBe("under_review");
    });
  });

  describe("adminResolveDispute", () => {
    it("rejects without moving money", async () => {
      const db = seed();
      const { data } = await raise({ transactionId: "pay-1" });
      const res = await decide({ disputeId: data.disputeId, outcome: "rejected" });
      expect(res.data.remedy).toBe("none");
      expect(dispute(db, data.disputeId).status).toBe("resolved");
      expect(balance(db, CUSTOMER)).toBe(0);
    });

    it("upholds a full shop payment as an exact refund", async () => {
      const db = seed();
      const { data } = await raise({ transactionId: "pay-1" });
      const res = await decide({ disputeId: data.disputeId, outcome: "upheld" });
      expect(res.data).toMatchObject({ status: "resolved", remedy: "refund", journalEntryId: "refund_pay-1" });
      expect(balance(db, CUSTOMER)).toBe(1_000);
      expect(balance(db, MERCHANT)).toBe(5_000 - 990);
      expect(db.get("ledger_balances/platform:fees")!.balance).toBe(-10);
      expect(db.get("transactions/pay-1")!.refundedAt).toBeDefined();
      expect(dispute(db, data.disputeId).resolution).toMatchObject({ outcome: "upheld", amountCents: 1_000 });
    });

    it("upholds part of a payment as an adjustment from the merchant", async () => {
      const db = seed();
      const { data } = await raise({ transactionId: "pay-1", kind: "wrong_amount", amountCents: 400 });
      const res = await decide({ disputeId: data.disputeId, outcome: "upheld" });
      expect(res.data.remedy).toBe("adjustment");
      expect(balance(db, CUSTOMER)).toBe(400);
      expect(balance(db, MERCHANT)).toBe(4_600);
      expect(db.get(`transactions/adjustment_dispute_${data.disputeId}`)!.disputeId).toBe(data.disputeId);
    });

    it("upholds a P2P sent to the wrong person from that person's wallet", async () => {
      const db = seed();
      const { data } = await raise({ transactionId: "p2p-1", kind: "wrong_recipient" });
      await decide({ disputeId: data.disputeId, outcome: "upheld" });
      expect(balance(db, CUSTOMER)).toBe(2_000);
      expect(balance(db, FRIEND)).toBe(0);
    });

    it("needs payFrom platform when there is no other party", async () => {
      const db = seed();
      const { data } = await raise({ agentTopupRequestId: "atr-1", kind: "cash_given_not_credited" });
      const err = await decide({ disputeId: data.disputeId, outcome: "upheld" }).catch((e: any) => e);
      expect(err.details.reason).toBe("no_counterparty");
      await decide({ disputeId: data.disputeId, outcome: "upheld", payFrom: "platform" });
      expect(balance(db, CUSTOMER)).toBe(4_000);
      expect(db.get("ledger_balances/platform:fees")!.balance).toBe(-4_000);
    });

    it("needs a super admin to uphold a large amount", async () => {
      seed({ "transactions/big-1": payment({ amount: 60_000, netCents: 59_400, feeCents: 600 }) });
      const { data } = await raise({ transactionId: "big-1" });
      const err = await decide({ disputeId: data.disputeId, outcome: "upheld" }).catch((e: any) => e);
      expect(err.details.reason).toBe("needs_super");
    });

    it("refuses non-admins and closed disputes", async () => {
      seed();
      const { data } = await raise({ transactionId: "pay-1" });
      await expect(decide({ disputeId: data.disputeId, outcome: "upheld" }, { uid: CUSTOMER, token: {} })).rejects.toThrow(/not authorized/i);
      await decide({ disputeId: data.disputeId, outcome: "rejected" });
      const err = await decide({ disputeId: data.disputeId, outcome: "upheld" }).catch((e: any) => e);
      expect(err.details.reason).toBe("dispute_closed");
    });
  });

  // D8: wait for funds.
  describe("when the merchant can't cover an upheld dispute", () => {
    it("reserves what they owe, blocks spending it, and settles once they can", async () => {
      const db = seed({ [`wallets/${MERCHANT}`]: wallet(500) });
      const { data } = await raise({ transactionId: "pay-1" });

      const res = await decide({ disputeId: data.disputeId, outcome: "upheld" });
      expect(res.data).toMatchObject({ status: "awaiting_funds", remedy: "refund", owedCents: 990 });
      expect(dispute(db, data.disputeId).owedCents).toBe(990);
      expect(db.get(`wallets/${MERCHANT}`)!.reservedCents).toBe(990);
      expect(balance(db, CUSTOMER)).toBe(0);

      // The merchant can't spend what is reserved…
      const spend = () =>
        db.runTransaction(async (t: any) => {
          const p = await prepareJournalEntry(t, {
            entryId: `spend_${Math.random().toString(36).slice(2)}`,
            type: "p2p",
            currency: "USD",
            lines: [
              { account: userAccount(MERCHANT), debit: 100, credit: 0 },
              { account: userAccount(FRIEND), debit: 0, credit: 100 },
            ],
            description: "test",
            postedBy: MERCHANT,
          });
          p.write(t);
        });
      await expect(spend()).rejects.toBeInstanceOf(InsufficientBalanceError);

      // …and nothing is collected while the balance is short.
      expect(await collect()).toBe(0);

      // Takings arrive; the next run settles the refund and frees the reserve.
      db.store.set(`wallets/${MERCHANT}`, { ...db.get(`wallets/${MERCHANT}`)!, balance: 1_200 });
      expect(await collect()).toBe(1);
      expect(balance(db, CUSTOMER)).toBe(1_000);
      expect(balance(db, MERCHANT)).toBe(210);
      expect(db.get(`wallets/${MERCHANT}`)!.reservedCents).toBe(0);
      const d = dispute(db, data.disputeId);
      expect(d.status).toBe("resolved");
      expect(d.owedCents).toBeUndefined();
      expect(d.resolution.settledAt).toBeDefined();

      // Reserve released: spending works again.
      await spend();
      expect(balance(db, MERCHANT)).toBe(110);
    });
  });

  describe("a merchant refunding a disputed payment", () => {
    it("closes the dispute as upheld in the same transaction", async () => {
      const db = seed();
      const { data } = await raise({ transactionId: "pay-1" });
      await refundPayment({ data: { transactionId: "pay-1", pin: "123456" }, auth: { uid: MERCHANT } });
      const d = dispute(db, data.disputeId);
      expect(d.status).toBe("resolved");
      expect(d.resolution).toMatchObject({ outcome: "upheld", remedy: "refund", decidedBy: MERCHANT, amountCents: 1_000 });
      expect(balance(db, CUSTOMER)).toBe(1_000);
    });
  });
});

describe("getDisputeOptions", () => {
  let options: any;
  let openD: any;
  let restore: (() => void) | undefined;
  const { Timestamp } = admin.firestore;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const d = await import("../disputes/disputes");
    options = test.wrap(d.getDisputeOptions);
    openD = test.wrap(d.openDispute);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  const seedSmall = () => {
    const db = fakeFirestore({
      "journal_entries/qrpay_q1": { type: "qr_payment" },
      "transactions/pay-1": {
        type: "payment",
        fromUserId: "cust-1",
        toUserId: "shop-1",
        participants: ["cust-1", "shop-1"],
        amount: 1_000,
        currency: "USD",
        status: "completed",
        journalEntryId: "qrpay_q1",
        createdAt: Timestamp.fromMillis(Date.now() - 1000),
      },
    });
    restore = useFakeFirestore(db);
    return db;
  };

  it("offers the claims that fit, per side", async () => {
    seedSmall();
    const payer = await options({ data: { transactionId: "pay-1" }, auth: { uid: "cust-1" } });
    expect(payer.data).toMatchObject({
      allowedKinds: ["not_received", "wrong_amount", "unauthorised", "refund_not_given", "other"],
      existingDisputeId: null,
      windowOpen: true,
      hasCounterparty: true,
      transactionAmountCents: 1_000,
    });
    const payee = await options({ data: { transactionId: "pay-1" }, auth: { uid: "shop-1" } });
    expect(payee.data.allowedKinds).toEqual(["other"]);
  });

  it("points at an existing dispute", async () => {
    seedSmall();
    await openD({ data: { transactionId: "pay-1", kind: "other", note: "Something is off" }, auth: { uid: "cust-1" } });
    const res = await options({ data: { transactionId: "pay-1" }, auth: { uid: "cust-1" } });
    expect(res.data.existingDisputeId).toBe("pay-1_cust-1");
  });

  it("refuses outsiders", async () => {
    seedSmall();
    await expect(options({ data: { transactionId: "pay-1" }, auth: { uid: "x" } })).rejects.toThrow(/weren't part/);
  });
});
