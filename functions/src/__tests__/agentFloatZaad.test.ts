import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { processReceipt } from "../mobileMoney/receipts";
import { ReceivedPayment, floatEntry } from "../mobileMoney/core";
import { validateEntry } from "../ledger/validate";
import { DEFAULT_RATES } from "../config/rates";

const { Timestamp } = admin.firestore;
const AGENT = "agent-1";
const CUSTOMER = "cust-1";
const AGENT_NUMBER = "+252634000001";
const CUSTOMER_NUMBER = "+252634000002";

/**
 * Agents used to get float only from ops, by hand, at the float desk. Now an
 * agent sends Zaad from their verified number to Zapp's collection number and
 * it lands in their float (agent:{uid}) within seconds: the listener phone
 * reads the SMS, and the receipt is matched to the agent. A customer's
 * payment still tops up their wallet.
 */
describe("agents buy float with Zaad", () => {
  let restore: (() => void) | undefined;
  let startLink: any;
  let instructions: any;
  let assign: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const linking = await import("../mobileMoney/linking");
    startLink = test.wrap(linking.startNumberLink);
    instructions = test.wrap(linking.getTopupInstructions);
    assign = test.wrap((await import("../mobileMoney/adminDesk")).adminAssignMobileMoney);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Hodan's Shop", kycStatus: "verified" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina", kycStatus: "verified" },
      [`wallets/${AGENT}`]: wallet(0),
      [`wallets/${CUSTOMER}`]: wallet(0),
      [`linked_numbers/zaad_${AGENT_NUMBER.slice(1)}`]: {
        uid: AGENT, provider: "zaad", msisdn: AGENT_NUMBER, status: "verified",
      },
      [`linked_numbers/zaad_${CUSTOMER_NUMBER.slice(1)}`]: {
        uid: CUSTOMER, provider: "zaad", msisdn: CUSTOMER_NUMBER, status: "verified",
      },
      "config/collection": { zaad: { number: "+252634999999", active: true, senderIds: ["Zaad"] } },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  let n = 0;
  const pay = (from: string, amountCents: number): ReceivedPayment => ({
    provider: "zaad",
    operatorTxnId: `ZT${++n}${Date.now()}`,
    amountCents,
    currency: "USD",
    senderMsisdn: from,
    senderName: null,
    receivedAtMs: Date.now(),
  });

  const float = (db: FakeDb) => db.get(`ledger_balances/agent:${AGENT}`)?.balance ?? 0;

  it("credits the agent's float, not their wallet", async () => {
    const db = seed();
    const p = pay(AGENT_NUMBER, 50_000);
    const outcome = await processReceipt(p);
    expect(outcome).toMatchObject({ status: "credited", uid: AGENT, duplicate: false });
    expect(float(db)).toBe(50_000);
    expect(db.get(`wallets/${AGENT}`)!.balance).toBe(0);
    expect(db.get("ledger_balances/float:zaad")!.balance).toBe(-50_000);

    const entry = db.get(`journal_entries/${floatEntry(p, AGENT, "x").entryId}`)!;
    expect(entry.type).toBe("float_issue");
    const tx = db.get(`transactions/${entry.refs.transactionId}`)!;
    expect(tx).toMatchObject({
      kind: "float", toUserId: AGENT, participants: [AGENT], amount: 50_000,
      description: "Float bought with Zaad", reference: p.operatorTxnId,
    });
    expect(db.get(`mobile_money_receipts/${outcome.receiptId}`)).toMatchObject({ creditedTo: "float" });
  });

  it("never credits the same SMS twice", async () => {
    const db = seed();
    const p = pay(AGENT_NUMBER, 20_000);
    await processReceipt(p);
    const again = await processReceipt(p);
    expect(again.duplicate).toBe(true);
    expect(float(db)).toBe(20_000);
  });

  it("uses the agents' limit: above the customer cap, below the float cap", async () => {
    const db = seed();
    expect(DEFAULT_RATES.agentFloatTopupMaxCents).toBeGreaterThan(DEFAULT_RATES.topupMaxCents);
    await processReceipt(pay(AGENT_NUMBER, DEFAULT_RATES.topupMaxCents + 1));
    expect(float(db)).toBe(DEFAULT_RATES.topupMaxCents + 1);

    const big = await processReceipt(pay(AGENT_NUMBER, DEFAULT_RATES.agentFloatTopupMaxCents + 1));
    expect(big).toMatchObject({ status: "held", reason: "above_max" });
    expect(float(db)).toBe(DEFAULT_RATES.topupMaxCents + 1);
  });

  it("still tops up a customer's wallet under the customer limit", async () => {
    const db = seed();
    await processReceipt(pay(CUSTOMER_NUMBER, 5_000));
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5_000);
    const big = await processReceipt(pay(CUSTOMER_NUMBER, DEFAULT_RATES.topupMaxCents + 1));
    expect(big).toMatchObject({ status: "held", reason: "above_max" });
  });

  it("puts an agent's activation payment into float too", async () => {
    const db = seed({
      [`linked_numbers/zaad_${AGENT_NUMBER.slice(1)}`]: {
        uid: AGENT, provider: "zaad", msisdn: AGENT_NUMBER, status: "pending", createdAt: Timestamp.now(),
      },
    });
    await processReceipt(pay(AGENT_NUMBER, 10));
    expect(float(db)).toBe(10);
    expect(db.get(`linked_numbers/zaad_${AGENT_NUMBER.slice(1)}`)!.status).toBe("verified");
  });

  it("goes by the role now, not when the number was linked", async () => {
    // Linked as a customer, later approved as an agent.
    const db = seed({
      [`users/${CUSTOMER}`]: { accountType: "agent_merchant", fullName: "Amina's Shop", kycStatus: "verified" },
    });
    await processReceipt(pay(CUSTOMER_NUMBER, 30_000));
    expect(db.get(`ledger_balances/agent:${CUSTOMER}`)!.balance).toBe(30_000);
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(0);
  });

  it("makes a balanced, valid entry", () => {
    const e = floatEntry(pay(AGENT_NUMBER, 12_345), AGENT, "tx1");
    expect(() => validateEntry(e)).not.toThrow();
    expect(e.lines).toEqual([
      { account: "float:zaad", debit: 12_345, credit: 0 },
      { account: `agent:${AGENT}`, debit: 0, credit: 12_345 },
    ]);
  });

  describe("in the apps", () => {
    it("tells an agent their Zaad buys float, with the float limit", async () => {
      seed();
      const res = await instructions({ data: { provider: "zaad", amountCents: 50_000 }, auth: { uid: AGENT } });
      expect(res.data).toMatchObject({ creditsFloat: true, fromMsisdn: AGENT_NUMBER, dialCode: "*880*0634999999*500.00#" });
      await expect(
        instructions({ data: { provider: "zaad", amountCents: 50_000 }, auth: { uid: CUSTOMER } })
      ).rejects.toMatchObject({ details: { reason: "amount_out_of_range", maxCents: DEFAULT_RATES.topupMaxCents } });
    });

    it("gives an agent linking a number the float limit", async () => {
      const db = seed();
      db.store.delete(`linked_numbers/zaad_${AGENT_NUMBER.slice(1)}`);
      const res = await startLink({ data: { provider: "zaad", msisdn: "0634000001" }, auth: { uid: AGENT } });
      expect(res.data).toMatchObject({
        status: "pending", creditsFloat: true, topupMaxCents: DEFAULT_RATES.agentFloatTopupMaxCents,
      });
    });
  });

  describe("admin assigns a held payment", () => {
    const admin_ = { uid: "ops-1", token: { admin: true, adminRoles: ["ops"], email: "ops@zapp.example", auth_time: Math.floor(Date.now() / 1000) - 30 } };

    it("to an agent, as float", async () => {
      const db = seed();
      const held = await processReceipt(pay("+252634777777", 40_000)); // unknown sender
      expect(held.status).toBe("held");
      await assign({ data: { receiptId: held.receiptId, uid: AGENT, reason: "Agent paid from a second SIM" }, auth: admin_ });
      expect(float(db)).toBe(40_000);
      expect(db.get(`wallets/${AGENT}`)!.balance).toBe(0);
      expect(db.get(`journal_entries/mmassignfloat_${held.receiptId}`)!.type).toBe("float_issue");
    });

    it("to a customer, as before", async () => {
      const db = seed();
      const held = await processReceipt(pay("+252634777778", 4_000));
      await assign({ data: { receiptId: held.receiptId, uid: CUSTOMER, reason: "Customer paid from a friend's SIM" }, auth: admin_ });
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(4_000);
    });
  });
});
