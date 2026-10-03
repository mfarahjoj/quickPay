import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const AGENT = "agent-1";
const AGENT_2 = "agent-2";
const MERCHANT = "merch-1";
const CUSTOMER = "cust-1";
const FROZEN = "cust-frozen";
const { Timestamp } = admin.firestore;

const FLOAT = 50_000; // $500

/**
 * Cash-in pays the agent commission, so a top-up whose value can return to
 * the agent without cash changing hands mints money. These run the real
 * ledger, limits and velocity — only the PIN check and pushes are stubbed.
 */
describe("cash-in recipient rules", () => {
  let manualTopup: any;
  let agentConfirmTopup: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    manualTopup = test.wrap((await import("../topup/manualTopup")).manualTopup);
    agentConfirmTopup = test.wrap(
      (await import("../topup/agentConfirmTopup")).agentConfirmTopup
    );
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

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Agent", kycStatus: "verified" },
      [`users/${AGENT_2}`]: {
        accountType: "agent_merchant",
        fullName: "Agent 2",
        kycStatus: "verified",
      },
      [`users/${MERCHANT}`]: { accountType: "merchant", fullName: "Shop", kycStatus: "verified" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina", kycStatus: "pending" },
      [`users/${FROZEN}`]: { accountType: "customer", fullName: "Frozen", accountStatus: "frozen" },
      [`wallets/${AGENT}`]: wallet(FLOAT),
      [`wallets/${AGENT_2}`]: wallet(FLOAT),
      [`wallets/${MERCHANT}`]: wallet(FLOAT),
      [`wallets/${CUSTOMER}`]: wallet(0),
      [`wallets/${FROZEN}`]: wallet(0),
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const journalEntries = (db: FakeDb) =>
    [...db.store.keys()].filter((p) => p.startsWith("journal_entries/"));

  const topup = (userId: string, amount = 50, uid = AGENT) =>
    manualTopup({
      data: { userId, amount, agentPin: "123456", paymentMethod: "cash" },
      auth: { uid },
    });

  describe("manualTopup", () => {
    it("refuses an agent topping up their own wallet, and posts nothing", async () => {
      const db = seed();
      await expect(topup(AGENT)).rejects.toThrow(/own top-up/);
      expect(journalEntries(db)).toHaveLength(0);
      expect(db.get(`wallets/${AGENT}`)!.balance).toBe(FLOAT);
    });

    it("refuses a plain merchant", async () => {
      const db = seed();
      await expect(topup(CUSTOMER, 50, MERCHANT)).rejects.toThrow(/authorized agents/);
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("refuses topping up another agent", async () => {
      const db = seed();
      await expect(topup(AGENT_2)).rejects.toThrow(/customer accounts/);
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("refuses topping up a merchant", async () => {
      const db = seed();
      await expect(topup(MERCHANT)).rejects.toThrow(/customer accounts/);
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("refuses a frozen customer", async () => {
      const db = seed();
      await expect(topup(FROZEN)).rejects.toThrow();
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("holds an unverified customer to their per-transaction cap", async () => {
      const db = seed();
      // Unverified cap is $100 (config/limits defaults).
      await expect(topup(CUSTOMER, 150)).rejects.toThrow(/limit for a single transaction/);
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("stops an agent past the daily transaction count", async () => {
      const recent: Record<string, any> = {};
      for (let i = 0; i < 50; i++) {
        recent[`transactions/old${i}`] = {
          fromUserId: AGENT,
          createdAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000),
        };
      }
      const db = seed(recent);
      await expect(topup(CUSTOMER)).rejects.toThrow(/Too many transactions/);
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("still cashes in a customer: float out, value in, commission to the agent", async () => {
      const db = seed();
      const res = await topup(CUSTOMER, 50);
      expect(res.success).toBe(true);

      // 2% default commission on $50 = 100 cents, paid by the platform.
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5_000);
      expect(db.get(`wallets/${AGENT}`)!.balance).toBe(FLOAT - 5_000 + 100);
      expect(db.get("ledger_balances/platform:fees")!.balance).toBe(-100);

      const [entry] = journalEntries(db);
      const tx = db.get(`transactions/${res.data.transactionId}`)!;
      expect(tx.participants).toEqual([AGENT, CUSTOMER]);
      expect(`journal_entries/${tx.journalEntryId}`).toBe(entry);
    });
  });

  describe("agentConfirmTopup", () => {
    const request = (customerId: string) => ({
      [`agentTopupRequests/req-1`]: {
        customerId,
        amount: 5_000,
        currency: "USD",
        otpCode: "123456",
        status: "pending",
        expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
        createdAt: Timestamp.now(),
      },
    });

    const confirm = () =>
      agentConfirmTopup({ data: { otpCode: "123456", agentPin: "123456" }, auth: { uid: AGENT } });

    it("refuses confirming a request raised by another agent", async () => {
      const db = seed(request(AGENT_2));
      await expect(confirm()).rejects.toThrow(/customer accounts/);
      expect(journalEntries(db)).toHaveLength(0);
      expect(db.get("agentTopupRequests/req-1")!.status).toBe("pending");
    });

    it("refuses crediting a frozen customer", async () => {
      const db = seed(request(FROZEN));
      await expect(confirm()).rejects.toThrow();
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("still confirms a customer's request", async () => {
      const db = seed(request(CUSTOMER));
      await confirm();
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5_000);
      expect(db.get("agentTopupRequests/req-1")!.status).toBe("completed");
    });
  });
});
