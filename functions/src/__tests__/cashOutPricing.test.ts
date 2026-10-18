import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/limits", () => ({ enforceTransactionLimits: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/velocity", () => ({ enforceVelocity: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/otpGuard", () => ({
  reserveOtpAttempt: jest.fn().mockResolvedValue(undefined),
  clearOtpFailures: jest.fn().mockResolvedValue(undefined),
  assertNotOtpLocked: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { clearRatesCache } from "../config/rates";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const { Timestamp } = admin.firestore;
const CUSTOMER = "cust-1";
const AGENT = "agent-1";
const OTHER_AGENT = "agent-2";

/**
 * D1: cash-out is free by default, but Zapp may price it; agents earn
 * commission both ways except on round trips (finding F1).
 */
describe("cash-out pricing and the round-trip guard", () => {
  let request: any;
  let confirm: any;
  let cancel: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    request = test.wrap((await import("../topup/customerCashOut")).customerCashOut);
    confirm = test.wrap((await import("../topup/agentConfirmCashOut")).agentConfirmCashOut);
    cancel = test.wrap((await import("../topup/cancelCashOut")).cancelCashOut);
  });

  beforeEach(() => {
    mockedPin.mockReset().mockResolvedValue(true);
    clearRatesCache();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (rates: Record<string, unknown> = {}, extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina", phoneNumber: "+252630000001" },
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Agent Ali" },
      [`users/${OTHER_AGENT}`]: { accountType: "topup_agent", fullName: "Agent Two" },
      [`wallets/${CUSTOMER}`]: wallet(10_000),
      [`wallets/${AGENT}`]: wallet(0),
      [`wallets/${OTHER_AGENT}`]: wallet(0),
      "config/rates": rates,
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const ask = (amount: number) => request({ data: { amount, pin: "123456" }, auth: { uid: CUSTOMER } });
  const confirmAs = async (db: FakeDb, cashOutId: string, agentId = AGENT) => {
    const code = db.get(`cashOutRequests/${cashOutId}`)!.otpCode;
    return confirm({ data: { otpCode: code, agentPin: "123456", cashOutId }, auth: { uid: agentId } });
  };
  const cashedIn = (agentId: string, hoursAgo: number) => ({
    type: "topup",
    kind: "cash_in",
    status: "completed",
    fromUserId: agentId,
    toUserId: CUSTOMER,
    amount: 5_000,
    createdAt: Timestamp.fromMillis(Date.now() - hoursAgo * 3_600_000),
  });

  it("is free by default: only the cash is held, and the agent earns 2%", async () => {
    const db = seed();
    const res = await ask(5_000);
    expect(res.data.feeCents).toBe(0);
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5_000);

    const done = await confirmAs(db, res.data.cashOutId);
    expect(done.data.commission).toBe(100);
    expect(db.get(`wallets/${AGENT}`)!.balance).toBe(5_100);
    expect(db.get("ledger_balances/platform:cashout_hold")!.balance).toBe(0);
  });

  it("holds the fee with the cash when Zapp prices cash-out, and keeps it on confirm", async () => {
    const db = seed({ cashOutFeeRate: 0.01 });
    const res = await ask(5_000);
    expect(res.data.feeCents).toBe(50);
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(10_000 - 5_050);

    await confirmAs(db, res.data.cashOutId);
    expect(db.get(`wallets/${AGENT}`)!.balance).toBe(5_000 + 100);
    // +50 fee in, -100 commission out.
    expect(db.get("ledger_balances/platform:fees")!.balance).toBe(50 - 100);
    expect(db.get("ledger_balances/platform:cashout_hold")!.balance).toBe(0);
  });

  it("returns the fee with the cash when the customer cancels", async () => {
    const db = seed({ cashOutFeeRate: 0.01 });
    const res = await ask(5_000);
    await cancel({ data: { cashOutId: res.data.cashOutId }, auth: { uid: CUSTOMER } });
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(10_000);
    expect(db.get("ledger_balances/platform:cashout_hold")!.balance).toBe(0);
  });

  it("refuses when the balance can't cover cash plus fee", async () => {
    seed({ cashOutFeeRate: 0.01 }, { [`wallets/${CUSTOMER}`]: wallet(5_000) });
    await expect(ask(5_000)).rejects.toThrow(/Insufficient balance/);
  });

  it("withholds commission on a round trip with the same agent", async () => {
    const db = seed({}, { "transactions/in-1": cashedIn(AGENT, 3) });
    const res = await ask(5_000);
    const done = await confirmAs(db, res.data.cashOutId);
    expect(done.data).toMatchObject({ commission: 0, commissionWithheld: "round_trip" });
    expect(db.get(`wallets/${AGENT}`)!.balance).toBe(5_000);
    expect(db.get(`transactions/${db.get(`cashOutRequests/${res.data.cashOutId}`)!.transactionId}`)!.commissionWithheld).toBe(
      "round_trip"
    );
  });

  it("still pays commission when the cash-in was with another agent, or long ago", async () => {
    const db = seed({}, { "transactions/in-1": cashedIn(OTHER_AGENT, 3), "transactions/in-2": cashedIn(AGENT, 30) });
    const res = await ask(5_000);
    const done = await confirmAs(db, res.data.cashOutId);
    expect(done.data.commission).toBe(100);
  });

  it("pays commission on round trips when the check is switched off", async () => {
    const db = seed({ roundTripWindowHours: 0 }, { "transactions/in-1": cashedIn(AGENT, 3) });
    const res = await ask(5_000);
    expect((await confirmAs(db, res.data.cashOutId)).data.commission).toBe(100);
  });

  it("uses separate cash-in and cash-out commission rates", async () => {
    const db = seed({ cashOutCommissionRate: 0.005 });
    const res = await ask(5_000);
    expect((await confirmAs(db, res.data.cashOutId)).data.commission).toBe(25);
  });
});
