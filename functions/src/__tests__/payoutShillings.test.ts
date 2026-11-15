import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { clearRatesCache } from "../config/rates";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const SHOP = "shop-1";
const ZAAD = { msisdn: "+252634123456", name: "Hodan Ali", updatedAt: admin.firestore.Timestamp.now() };
const OPS = {
  uid: "ops-1",
  token: { admin: true, adminRoles: ["ops"], email: "ops@zapp.example", auth_time: Math.floor(Date.now() / 1000) - 30 },
};

const pocket = (balance: number) => ({ balance, totalSent: 0, totalReceived: 0 });

/**
 * A shop withdrawing its shillings to its Zaad account (SHILLINGS.md). The
 * shillings are held, sent and, if ops declines, returned as shillings; the
 * dollar balance never moves. The limits are dollars, counted at the rate.
 */
describe("payouts in shillings", () => {
  let request: any;
  let settle: any;
  let reject: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    request = test.wrap((await import("../payouts/requestPayout")).requestPayout);
    const desk = await import("../admin/payoutDesk");
    settle = test.wrap(desk.adminSettlePayout);
    reject = test.wrap(desk.adminRejectPayout);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
    clearRatesCache();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali", zaad: ZAAD },
      [`merchantProfiles/${SHOP}`]: { businessName: "Hodan's Shop" },
      [`wallets/${SHOP}`]: wallet(10_000, { sls: pocket(400_000) }),
      "config/rates": { slsPerUsd: 8_000 },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const ask = (amountCents: number, currency?: string) =>
    request({ data: { amountCents, ...(currency ? { currency } : {}), pin: "123456" }, auth: { uid: SHOP } });
  const payoutOf = (db: FakeDb, id: string) => db.get(`payoutRequests/${id}`)!;
  const sls = (db: FakeDb) => db.get(`wallets/${SHOP}`)!.sls.balance;
  const usd = (db: FakeDb) => db.get(`wallets/${SHOP}`)!.balance;

  it("holds shillings, not dollars, and says so", async () => {
    const db = seed();
    const res = await ask(240_000, "SLS");
    expect(res.data).toMatchObject({ amountCents: 240_000, currency: "SLS" });
    expect(res.message).toMatch(/240,000 SLSH/);
    expect(payoutOf(db, res.data.payoutId)).toMatchObject({ amountCents: 240_000, currency: "SLS", status: "requested" });
    expect(sls(db)).toBe(160_000);
    expect(usd(db)).toBe(10_000);
    expect(db.get("ledger_balances/platform:settlement_hold@SLS")!.balance).toBe(240_000);
    expect(db.get(`transactions/payout_hold_${res.data.payoutId}`)).toMatchObject({ currency: "SLS", amount: 240_000 });
  });

  it("sends it as shillings when ops settles it", async () => {
    const db = seed();
    const { data } = await ask(240_000, "SLS");
    await settle({ data: { payoutId: data.payoutId, externalReference: "ZT12345", reason: "Sent from the Zaad SIM" }, auth: OPS });
    expect(payoutOf(db, data.payoutId).status).toBe("paid");
    expect(db.get("ledger_balances/platform:settlement_hold@SLS")!.balance).toBe(0);
    expect(db.get("ledger_balances/float:zaad@SLS")!.balance).toBe(240_000);
    expect(db.get("ledger_balances/float:zaad")).toBeUndefined();
    expect((notifyUser as jest.Mock).mock.calls[0][2].params.amount).toBe("SLSH 240,000");
  });

  it("returns shillings to the shilling balance when ops declines it", async () => {
    const db = seed();
    const { data } = await ask(240_000, "SLS");
    await reject({ data: { payoutId: data.payoutId, reason: "Zaad number didn't answer" }, auth: OPS });
    expect(sls(db)).toBe(400_000);
    expect(usd(db)).toBe(10_000);
    expect((notifyUser as jest.Mock).mock.calls[0][2].params.amount).toBe("SLSH 240,000");
  });

  it("never pays shillings out of dollars", async () => {
    const db = seed({ [`wallets/${SHOP}`]: wallet(10_000_000) });
    await expect(ask(240_000, "SLS")).rejects.toThrow(/that many shillings/);
    expect(usd(db)).toBe(10_000_000);
  });

  it("counts the $5 floor at the rate", async () => {
    seed();
    // $5 at 8,000 a dollar is 40,000 shillings.
    await expect(ask(39_000, "SLS")).rejects.toThrow(/Payouts start at \$5/);
    await expect(ask(40_000, "SLS")).resolves.toBeTruthy();
  });

  it("counts shillings towards the senior-approval threshold", async () => {
    const db = seed({
      "config/rates": { slsPerUsd: 8_000, floatApprovalThresholdCents: 50_000 },
      [`wallets/${SHOP}`]: wallet(100_000, { sls: pocket(8_000_000) }),
    });
    // 4,000,000 shillings is $500: at the threshold on its own.
    const { data } = await ask(4_000_000, "SLS");
    expect(payoutOf(db, data.payoutId).requiresSeniorApproval).toBe(true);
  });

  it("is dollars when the app sends no currency, as older apps don't", async () => {
    const db = seed();
    const { data } = await ask(5_000);
    expect(payoutOf(db, data.payoutId).currency).toBeUndefined();
    expect(usd(db)).toBe(5_000);
    expect(sls(db)).toBe(400_000);
  });
});
