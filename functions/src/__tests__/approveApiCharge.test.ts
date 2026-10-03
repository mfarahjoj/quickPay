import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/velocity", () => ({ enforceVelocity: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/limits", () => ({
  enforceTransactionLimits: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import { enforceTransactionLimits } from "../utils/limits";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const mockedVelocity = enforceVelocity as jest.MockedFunction<typeof enforceVelocity>;
const mockedLimits = enforceTransactionLimits as jest.MockedFunction<typeof enforceTransactionLimits>;

const CUSTOMER = "cust-1";
const OTHER = "cust-2";
const MERCHANT = "merch-1";
const CHARGE = "ch_abcdefghijklmnopqrstuvwx";
const ENTRY = `apicharge_${CHARGE}`;
const { Timestamp } = admin.firestore;

const pendingCharge = (overrides: Record<string, unknown> = {}) => ({
  merchantId: MERCHANT,
  merchantName: "Hooyo Cafe",
  keyId: "k".repeat(64),
  amount: 5000,
  currency: "USD",
  status: "pending",
  reference: "Order 1001",
  createdAt: Timestamp.fromMillis(Date.now() - 30_000),
  expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
  amountRefunded: 0,
  feeRefunded: 0,
  refundCount: 0,
  ...overrides,
});

describe("approveApiCharge", () => {
  let approve: any;
  let getCharge: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../api/approveApiCharge");
    approve = test.wrap(mod.approveApiCharge);
    getCharge = test.wrap(mod.getApiCharge);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
    mockedVelocity.mockReset().mockResolvedValue(undefined);
    mockedLimits.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (charge: Record<string, unknown> | null, customerBalance = 10_000): FakeDb => {
    const db = fakeFirestore({
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina", accountStatus: "active" },
      [`users/${OTHER}`]: { accountType: "customer", fullName: "Other", accountStatus: "active" },
      [`users/${MERCHANT}`]: { accountType: "merchant", fullName: "Hooyo", accountStatus: "active" },
      [`wallets/${CUSTOMER}`]: wallet(customerBalance),
      [`wallets/${OTHER}`]: wallet(10_000),
      [`wallets/${MERCHANT}`]: wallet(0),
      ...(charge ? { [`api_charges/${CHARGE}`]: charge } : {}),
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const call = (data: Record<string, unknown> = {}, uid = CUSTOMER) =>
    approve({ data: { chargeId: CHARGE, pin: "123456", expectedAmount: 5000, ...data }, auth: { uid } });

  it("posts one zero-sum online_payment entry and settles the charge", async () => {
    const db = seed(pendingCharge());

    const result = await call();

    expect(result.success).toBe(true);
    const entry = db.get(`journal_entries/${ENTRY}`)!;
    expect(entry.type).toBe("online_payment");
    // Default onlinePaymentFeeRate is 1%: $50.00 → $0.50 fee, $49.50 to the merchant.
    expect(entry.lines).toEqual(
      expect.arrayContaining([
        { account: `user:${CUSTOMER}`, debit: 5000, credit: 0 },
        { account: `user:${MERCHANT}`, debit: 0, credit: 4950 },
        { account: "platform:fees", debit: 0, credit: 50 },
      ])
    );
    const net = entry.lines.reduce((s: number, l: any) => s + l.credit - l.debit, 0);
    expect(net).toBe(0);

    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5000);
    expect(db.get(`wallets/${MERCHANT}`)!.balance).toBe(4950);
    expect(db.get("ledger_balances/platform:fees")!.balance).toBe(50);

    const txRow = db.get(`transactions/${result.data.transactionId}`)!;
    expect(txRow).toMatchObject({
      type: "payment",
      fromUserId: CUSTOMER,
      toUserId: MERCHANT,
      participants: [CUSTOMER, MERCHANT],
      amount: 5000,
      feeCents: 50,
      netCents: 4950,
      journalEntryId: ENTRY,
      apiChargeId: CHARGE,
      reference: "Order 1001",
    });

    expect(db.get(`api_charges/${CHARGE}`)).toMatchObject({
      status: "succeeded",
      paidBy: CUSTOMER,
      transactionId: result.data.transactionId,
      journalEntryId: ENTRY,
      feeCents: 50,
      netCents: 4950,
    });
  });

  it("runs the PIN, velocity and limit guards before posting", async () => {
    seed(pendingCharge());
    await call();
    expect(mockedPin).toHaveBeenCalledWith(CUSTOMER, "123456");
    expect(mockedVelocity).toHaveBeenCalledWith(CUSTOMER);
    expect(mockedLimits).toHaveBeenCalledWith(CUSTOMER, 5000, expect.anything());
  });

  it("answers a retry with the original payment and posts nothing new", async () => {
    const db = seed(pendingCharge());
    const first = await call();
    const entriesBefore = [...db.store.keys()].filter((k) => k.startsWith("journal_entries/")).length;
    // A retry at the daily cap must still get its receipt.
    mockedLimits.mockRejectedValueOnce(new https.HttpsError("resource-exhausted", "Daily limit reached"));

    const second = await call();

    expect(second.data.transactionId).toBe(first.data.transactionId);
    expect([...db.store.keys()].filter((k) => k.startsWith("journal_entries/")).length).toBe(entriesBefore);
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5000);
  });

  it("refuses a charge someone else already paid, before any limit check", async () => {
    seed(pendingCharge({ status: "succeeded", paidBy: OTHER, transactionId: "tx-other" }));
    await expect(call()).rejects.toThrow(/already paid/);
    expect(mockedLimits).not.toHaveBeenCalled();
  });

  it("refuses with insufficient balance and moves nothing", async () => {
    const db = seed(pendingCharge(), 1000);
    await expect(call()).rejects.toThrow(/Insufficient balance/);
    expect(db.get(`journal_entries/${ENTRY}`)).toBeUndefined();
    expect(db.get(`api_charges/${CHARGE}`)!.status).toBe("pending");
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(1000);
  });

  it("refuses when velocity is exceeded", async () => {
    const db = seed(pendingCharge());
    mockedVelocity.mockRejectedValueOnce(new https.HttpsError("resource-exhausted", "Too many transactions"));
    await expect(call()).rejects.toThrow(/Too many transactions/);
    expect(db.get(`journal_entries/${ENTRY}`)).toBeUndefined();
  });

  it("refuses a wrong PIN before reading the charge", async () => {
    const db = seed(pendingCharge());
    mockedPin.mockResolvedValueOnce(false);
    await expect(call()).rejects.toThrow(/Invalid PIN/);
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it("refuses when the amount differs from what the customer saw", async () => {
    const db = seed(pendingCharge());
    await expect(call({ expectedAmount: 500 })).rejects.toThrow(/does not match/);
    expect(db.get(`journal_entries/${ENTRY}`)).toBeUndefined();
  });

  it("records the expiry and refuses a lapsed charge", async () => {
    const db = seed(pendingCharge({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) }));
    await expect(call()).rejects.toThrow(/expired/);
    expect(db.get(`api_charges/${CHARGE}`)!.status).toBe("expired");
    expect(db.get(`journal_entries/${ENTRY}`)).toBeUndefined();
  });

  it("refuses a cancelled charge", async () => {
    seed(pendingCharge({ status: "canceled" }));
    // The app matches "already cancelled" to show the shop-cancelled screen.
    await expect(call()).rejects.toThrow(/already cancelled/);
  });

  it("only lets the addressed customer pay a targeted charge", async () => {
    seed(pendingCharge({ customerId: OTHER }));
    await expect(call()).rejects.toThrow(/different customer/);
  });

  it("does not let a merchant pay their own charge", async () => {
    seed(pendingCharge());
    await expect(call({}, MERCHANT)).rejects.toThrow(/Cannot pay yourself/);
  });

  it("refuses when the merchant has lost the merchant role", async () => {
    const db = seed(pendingCharge());
    db.store.set(`users/${MERCHANT}`, { accountType: "customer", accountStatus: "active" });
    await expect(call()).rejects.toThrow(/no longer take payments/);
  });

  it("requires expectedAmount", async () => {
    seed(pendingCharge());
    await expect(call({ expectedAmount: undefined })).rejects.toThrow(/expectedAmount/);
  });

  it("rejects a malformed charge ID without touching Firestore", async () => {
    await expect(call({ chargeId: "../users/x" })).rejects.toThrow(/valid charge ID/);
  });

  describe("getApiCharge", () => {
    it("shows what the customer is being asked to pay", async () => {
      seed(pendingCharge());
      const res = await getCharge({ data: { chargeId: CHARGE }, auth: { uid: CUSTOMER } });
      expect(res.data).toMatchObject({
        chargeId: CHARGE,
        merchantName: "Hooyo Cafe",
        amount: 5000,
        currency: "USD",
        reference: "Order 1001",
        status: "pending",
        paidByYou: false,
      });
      expect(res.data.expiresInSeconds).toBeGreaterThan(500);
    });

    it("reports a lapsed charge as expired before the sweep has run", async () => {
      seed(pendingCharge({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) }));
      const res = await getCharge({ data: { chargeId: CHARGE }, auth: { uid: CUSTOMER } });
      expect(res.data.status).toBe("expired");
    });

    it("hides a targeted charge from other customers", async () => {
      seed(pendingCharge({ customerId: OTHER }));
      await expect(
        getCharge({ data: { chargeId: CHARGE }, auth: { uid: CUSTOMER } })
      ).rejects.toThrow(/different customer/);
    });
  });
});
