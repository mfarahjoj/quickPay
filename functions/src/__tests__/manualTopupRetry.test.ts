import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { notifyTopupCompleted } from "../utils/notifications";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const AGENT = "agent-1";
const AGENT_2 = "agent-2";
const CUSTOMER = "cust-1";
const OTHER = "cust-2";
const FLOAT = 50_000; // $500
const KEY = "mh2k9x1-abcdefghijkl";

/**
 * A top-up by phone has nothing of its own to make a retry safe: no code, no
 * request. On a dropped reply the agent taps "Try again", and without a key
 * that was a second top-up from their float for cash they were handed once.
 */
describe("manualTopup is safe to retry", () => {
  let manualTopup: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    manualTopup = test.wrap((await import("../topup/manualTopup")).manualTopup);
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
      [`users/${AGENT_2}`]: { accountType: "topup_agent", fullName: "Agent 2", kycStatus: "verified" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina", kycStatus: "verified" },
      [`users/${OTHER}`]: { accountType: "customer", fullName: "Bashir", kycStatus: "verified" },
      [`wallets/${AGENT}`]: wallet(0),
      [`wallets/${AGENT_2}`]: wallet(0),
      [`ledger_balances/agent:${AGENT}`]: { account: `agent:${AGENT}`, balance: FLOAT, currency: "USD" },
      [`ledger_balances/agent:${AGENT_2}`]: { account: `agent:${AGENT_2}`, balance: FLOAT, currency: "USD" },
      [`wallets/${CUSTOMER}`]: wallet(1_234),
      [`wallets/${OTHER}`]: wallet(0),
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const journalEntries = (db: FakeDb) =>
    [...db.store.keys()].filter((p) => p.startsWith("journal_entries/"));

  const topup = (extra: Record<string, unknown> = {}, uid = AGENT) =>
    manualTopup({
      data: {
        userId: CUSTOMER,
        amount: 50,
        agentPin: "246810",
        paymentMethod: "cash",
        idempotencyKey: KEY,
        ...extra,
      },
      auth: { uid },
    });

  it("posts once for the same key, and answers the retry with the first top-up", async () => {
    const db = seed();
    const first = await topup();
    const retry = await topup();

    expect(retry.data).toEqual(first.data);
    expect(journalEntries(db)).toHaveLength(1);
    expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(FLOAT - 5_000);
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(1_234 + 5_000);
    // One commission, one push to the customer.
    expect(db.get(`wallets/${AGENT}`)!.balance).toBe(100);
    expect(notifyTopupCompleted).toHaveBeenCalledTimes(1);
  });

  it("posts once when the tap and its retry arrive together", async () => {
    const db = seed();
    const [a, b] = await Promise.all([topup(), topup()]);
    expect(a.data.transactionId).toBe(b.data.transactionId);
    expect(journalEntries(db)).toHaveLength(1);
    expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(FLOAT - 5_000);
  });

  it("answers the retry even when the first top-up used the last of the float", async () => {
    const db = seed({
      [`ledger_balances/agent:${AGENT}`]: { account: `agent:${AGENT}`, balance: 5_000, currency: "USD" },
    });
    const first = await topup();
    const retry = await topup();
    expect(retry.data.transactionId).toBe(first.data.transactionId);
    expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(0);
  });

  it("treats a new key as a new top-up", async () => {
    const db = seed();
    await topup();
    await topup({ idempotencyKey: "mh2k9x2-zyxwvutsrqpo" });
    expect(journalEntries(db)).toHaveLength(2);
    expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(FLOAT - 10_000);
  });

  it("refuses a key reused for a different customer or amount, rather than say it's done", async () => {
    const db = seed();
    await topup();
    await expect(topup({ userId: OTHER })).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "idempotency_mismatch" },
    });
    await expect(topup({ amount: 75 })).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "idempotency_mismatch" },
    });
    expect(journalEntries(db)).toHaveLength(1);
    expect(db.get(`wallets/${OTHER}`)!.balance).toBe(0);
  });

  it("keeps each agent's keys apart", async () => {
    const db = seed();
    const mine = await topup();
    const theirs = await topup({}, AGENT_2);
    expect(theirs.data.transactionId).not.toBe(mine.data.transactionId);
    expect(journalEntries(db)).toHaveLength(2);
    expect(db.get(`ledger_balances/agent:${AGENT_2}`)!.balance).toBe(FLOAT - 5_000);
  });

  it("still asks for the PIN on a retry", async () => {
    const db = seed();
    await topup();
    mockedPin.mockResolvedValue(false);
    await expect(topup()).rejects.toThrow(/Invalid agent PIN/);
    expect(journalEntries(db)).toHaveLength(1);
  });

  it("still serves a build that sends no key", async () => {
    const db = seed();
    const res = await topup({ idempotencyKey: undefined });
    expect(res.success).toBe(true);
    expect(journalEntries(db)).toHaveLength(1);
  });

  it("refuses a malformed key", async () => {
    seed();
    for (const idempotencyKey of ["", "short", "has spaces in it", 12345678, null]) {
      await expect(topup({ idempotencyKey })).rejects.toThrow(/idempotencyKey/);
    }
  });

  it("never tells the agent the customer's balance", async () => {
    seed();
    const res = await topup();
    expect(Object.keys(res.data).sort()).toEqual(["amount", "commission", "transactionId", "userId"]);
    // $12.34 before, $62.34 after: neither figure is in the reply.
    expect(JSON.stringify(res)).not.toMatch(/62\.34|6234|newBalance/);
  });

  it("records how the customer paid only from the known list", async () => {
    const db = seed();
    await expect(topup({ paymentMethod: "refund from Zapp support, call 063…" })).rejects.toThrow(
      /payment method/
    );
    const res = await topup({ paymentMethod: "zaad", reference: "ZAAD-778812" });
    expect(db.get(`transactions/${res.data.transactionId}`)).toMatchObject({
      description: "Manual top-up by agent (zaad)",
      reference: "ZAAD-778812",
    });
  });

  it("caps the reference and notes an agent can attach", async () => {
    const db = seed();
    await expect(topup({ reference: "x".repeat(65) })).rejects.toThrow(/reference/);
    await expect(topup({ notes: "x".repeat(281) })).rejects.toThrow(/notes/);
    expect(journalEntries(db)).toHaveLength(0);
  });
});
