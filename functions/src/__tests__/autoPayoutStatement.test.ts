import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

import { verifyUserPin } from "../auth/validatePin";
import { clearRatesCache } from "../config/rates";
import { buildStatementCsv, csvField } from "../payouts/statement";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const { Timestamp } = admin.firestore;

const SHOP = "shop-1";
const settings = (extra: Record<string, unknown> = {}) => ({
  autoPayout: {
    enabled: true,
    keepCents: 2_000,
    route: "zaad",
    destinationName: "Hooyo Shop",
    destinationRef: "0634000000",
    updatedAt: Timestamp.now(),
    ...extra,
  },
});

describe("automatic payouts (3.6, D11)", () => {
  let setAuto: any;
  let runNow: () => Promise<{ queued: number; skipped: number }>;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const m = await import("../payouts/autoPayout");
    setAuto = test.wrap(m.setAutoPayout);
    runNow = m.runAutoPayoutsNow;
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

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hooyo Shop" },
      [`wallets/${SHOP}`]: wallet(12_000),
      [`merchantProfiles/${SHOP}`]: { businessName: "Hooyo Shop", ...settings() },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const payouts = (db: FakeDb) => [...db.store.entries()].filter(([p]) => p.startsWith("payoutRequests/")).map(([, d]) => d);

  it("queues everything above the kept balance, held like a manual payout", async () => {
    const db = seed();
    expect(await runNow()).toEqual({ queued: 1, skipped: 0 });
    const [p] = payouts(db);
    expect(p).toMatchObject({ merchantId: SHOP, amountCents: 10_000, route: "zaad", auto: true, status: "requested" });
    expect(db.get(`wallets/${SHOP}`)!.balance).toBe(2_000);
    expect(db.get("ledger_balances/platform:settlement_hold")!.balance).toBe(10_000);
  });

  it("never counts money reserved for a lost dispute", async () => {
    const db = seed({ [`wallets/${SHOP}`]: wallet(12_000, { reservedCents: 9_500 }) });
    expect((await runNow()).queued).toBe(0);
    expect(payouts(db)).toHaveLength(0);
  });

  it("skips small amounts, waiting payouts, and frozen shops", async () => {
    let db = seed({ [`wallets/${SHOP}`]: wallet(2_900) });
    expect((await runNow()).queued).toBe(0);
    restore?.();
    db = seed({ "payoutRequests/old": { merchantId: SHOP, status: "requested", amountCents: 500 } });
    expect((await runNow()).queued).toBe(0);
    restore?.();
    db = seed({ [`users/${SHOP}`]: { accountType: "merchant", accountStatus: "frozen" } });
    expect((await runNow()).queued).toBe(0);
    expect(payouts(db)).toHaveLength(0);
  });

  it("is switched on with the PIN, and off again", async () => {
    const db = seed({ [`merchantProfiles/${SHOP}`]: { businessName: "Hooyo Shop" } });
    await setAuto({
      data: { enabled: true, keepCents: 1_000, route: "bank", destinationName: "Hooyo Ltd", destinationRef: "0123456789", pin: "123456" },
      auth: { uid: SHOP },
    });
    expect(db.get(`merchantProfiles/${SHOP}`)!.autoPayout).toMatchObject({ enabled: true, keepCents: 1_000, route: "bank" });
    await setAuto({ data: { enabled: false, pin: "123456" }, auth: { uid: SHOP } });
    expect(db.get(`merchantProfiles/${SHOP}`)!.autoPayout.enabled).toBe(false);
    mockedPin.mockResolvedValue(false);
    await expect(setAuto({ data: { enabled: false, pin: "000000" }, auth: { uid: SHOP } })).rejects.toThrow(/Invalid PIN/);
  });

  it("refuses customers", async () => {
    seed({ "users/cust-1": { accountType: "customer" } });
    await expect(setAuto({ data: { enabled: false, pin: "123456" }, auth: { uid: "cust-1" } })).rejects.toThrow(/merchant/);
  });
});

describe("statements (3.6, D11)", () => {
  const at = (iso: string) => Timestamp.fromDate(new Date(iso));
  const rows: any[] = [
    { id: "t1", type: "payment", kind: "merchant_payment", fromUserId: "c1", toUserId: SHOP, amount: 1_000, feeCents: 10, netCents: 990, status: "completed", description: "Payment from Amina", createdAt: at("2026-10-01T09:00:00Z") },
    { id: "t2", type: "refund", kind: "refund", fromUserId: SHOP, toUserId: "c1", amount: 300, status: "completed", description: "Partial refund", createdAt: at("2026-10-02T10:00:00Z") },
    { id: "t3", type: "withdrawal", kind: "payout", fromUserId: SHOP, toUserId: "system", amount: 500, status: "pending", description: "Payout requested (zaad)", createdAt: at("2026-10-03T11:00:00Z") },
  ];

  it("puts net in, money out and fees in their own columns, with totals", () => {
    const { csv, totals } = buildStatementCsv(SHOP, rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Date (UTC),Type,Description,Money in,Money out,Fee,Status,Reference,Transaction ID");
    expect(lines[1]).toBe("2026-10-01 09:00:00,merchant_payment,Payment from Amina,9.90,,0.10,completed,,t1");
    expect(lines[2]).toBe("2026-10-02 10:00:00,refund,Partial refund,,3.00,,completed,,t2");
    expect(totals).toEqual({ inCents: 990, outCents: 300, feeCents: 10, count: 3 });
    expect(lines[lines.length - 1]).toBe("Totals (completed only),,,9.90,3.00,0.10,,,");
  });

  it("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    expect(csvField('Shop "A", Hargeisa')).toBe('"Shop ""A"", Hargeisa"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });
});
