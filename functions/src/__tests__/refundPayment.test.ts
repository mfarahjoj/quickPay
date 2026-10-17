import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const MERCHANT = "merch-1";
const CUSTOMER = "cust-1";
const { Timestamp } = admin.firestore;
const DAY_MS = 24 * 60 * 60 * 1000;

const GROSS = 1_000; // $10.00 paid
const FEE = 10; // 1%
const NET = 990; // what the merchant received

/** Runs the real ledger against the in-memory Firestore; only PIN and pushes are stubbed. */
describe("refundPayment", () => {
  let refund: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    refund = test.wrap((await import("../qr-payments/refundPayment")).refundPayment);
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

  /** A completed payment `ageDays` old, backed by a journal entry of `entryType`. */
  const seed = (entryType = "qr_payment", ageDays = 1, extra: Record<string, any> = {}): FakeDb => {
    const paidAt = Timestamp.fromMillis(Date.now() - ageDays * DAY_MS);
    const db = fakeFirestore({
      [`users/${MERCHANT}`]: { accountType: "merchant", fullName: "Hooyo Shop" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina" },
      [`wallets/${MERCHANT}`]: wallet(5_000),
      [`wallets/${CUSTOMER}`]: wallet(0),
      "journal_entries/entry-1": { type: entryType },
      "transactions/tx-1": {
        type: "payment",
        fromUserId: CUSTOMER,
        toUserId: MERCHANT,
        participants: [CUSTOMER, MERCHANT],
        amount: GROSS,
        feeCents: FEE,
        netCents: NET,
        currency: "USD",
        status: "completed",
        journalEntryId: "entry-1",
        createdAt: paidAt,
        completedAt: paidAt,
        ...extra,
      },
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const call = (uid = MERCHANT) =>
    refund({ data: { transactionId: "tx-1", pin: "123456" }, auth: { uid } });

  const refundEntries = (db: FakeDb) =>
    [...db.store.keys()].filter((p) => p.startsWith("journal_entries/refund_"));

  describe("what can be refunded", () => {
    it.each(["qr_payment", "customer_qr_payment"])("refunds a %s", async (entryType) => {
      const db = seed(entryType);
      await call();
      expect(refundEntries(db)).toHaveLength(1);
    });

    it.each(["p2p", "payroll"])("refuses a %s row typed payment", async (entryType) => {
      const db = seed(entryType);
      const err = await call().catch((e: any) => e);
      expect(err.details).toEqual({ reason: "not_refundable" });
      expect(refundEntries(db)).toHaveLength(0);
      expect(db.get(`wallets/${MERCHANT}`)!.balance).toBe(5_000);
      expect(mockedPin).not.toHaveBeenCalled();
    });

    it("refuses a row with no journal entry behind it", async () => {
      seed("qr_payment", 1, { journalEntryId: undefined });
      const err = await call().catch((e: any) => e);
      expect(err.details).toEqual({ reason: "not_refundable" });
    });

    it("refuses a payment older than the refund window", async () => {
      const db = seed("qr_payment", 31);
      const err = await call().catch((e: any) => e);
      expect(err.details).toEqual({ reason: "refund_window_closed", refundWindowDays: 30 });
      expect(refundEntries(db)).toHaveLength(0);
    });

    it("refunds on the last day of the window", async () => {
      const db = seed("qr_payment", 29);
      await call();
      expect(refundEntries(db)).toHaveLength(1);
    });

    it("refuses anyone but the merchant who was paid", async () => {
      const db = seed();
      await expect(call(CUSTOMER)).rejects.toThrow(/Only the merchant/);
      expect(refundEntries(db)).toHaveLength(0);
    });
  });

  // BACKLOG #4: a successful refund was never tested, only the refusals.
  describe("a successful refund", () => {
    it("reverses the payment exactly: merchant net, platform fee, customer gross", async () => {
      const db = seed();
      const res = await call();

      expect(res.data.amount).toBe(GROSS / 100);
      expect(db.get(`wallets/${MERCHANT}`)!.balance).toBe(5_000 - NET);
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(GROSS);
      expect(db.get("ledger_balances/platform:fees")!.balance).toBe(-FEE);

      const entry = db.get("journal_entries/refund_tx-1")!;
      expect(entry.type).toBe("refund");
      expect(entry.refs.refundOfEntryId).toBe("entry-1");
      const sum = (side: "debit" | "credit") =>
        entry.lines.reduce((n: number, l: any) => n + l[side], 0);
      expect(sum("debit")).toBe(sum("credit"));
    });

    it("marks the payment refunded and writes the refund row for both sides", async () => {
      const db = seed();
      const res = await call();
      const original = db.get("transactions/tx-1")!;
      expect(original.refundedAt).toBeDefined();
      expect(original.refundTransactionId).toBe(res.data.refundTransactionId);

      const row = db.get(`transactions/${res.data.refundTransactionId}`)!;
      expect(row).toMatchObject({
        type: "refund",
        fromUserId: MERCHANT,
        toUserId: CUSTOMER,
        participants: [MERCHANT, CUSTOMER],
        amount: GROSS,
        refundOfTransactionId: "tx-1",
        journalEntryId: "refund_tx-1",
        status: "completed",
      });
    });

    it("refunds only once", async () => {
      const db = seed();
      await call();
      await expect(call()).rejects.toThrow(/already been refunded/);
      expect(refundEntries(db)).toHaveLength(1);
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(GROSS);
    });

    it("refunds only once when two refunds race", async () => {
      const db = seed();
      const results = await Promise.allSettled([call(), call()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(refundEntries(db)).toHaveLength(1);
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(GROSS);
    });

    it("moves nothing when the merchant can't cover it", async () => {
      const db = seed();
      db.store.set(`wallets/${MERCHANT}`, wallet(NET - 1));
      await expect(call()).rejects.toThrow(/Insufficient balance/);
      expect(refundEntries(db)).toHaveLength(0);
      expect(db.get("transactions/tx-1")!.refundedAt).toBeUndefined();
    });
  });
});
