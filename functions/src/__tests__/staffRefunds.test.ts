import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { localParts } from "../merchantStats/time";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const { Timestamp } = admin.firestore;
const DAY_MS = 24 * 60 * 60 * 1000;

const SHOP = "shop-1";
const OTHER_SHOP = "shop-2";
const HODAN = "staff-hodan";
const ABDI = "staff-abdi";
const CUSTOMER = "cust-1";
const pocket = (balance: number) => ({ balance, totalSent: 0, totalReceived: 0 });

const grant = (staffUid: string, role: string, extra: Record<string, unknown> = {}) => ({
  merchantUid: SHOP,
  staffUid,
  role,
  status: "active",
  showCustomers: false,
  shopName: "Café Hargeisa",
  staffName: staffUid === HODAN ? "Hodan Ali" : "Abdi Warsame",
  staffPhone: "+252630000000",
  invitedAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...extra,
});

/** A completed counter payment to the shop, an hour old. */
const payment = (amount: number, currency = "USD", extra: Record<string, unknown> = {}) => {
  const paidAt = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
  return {
    type: "payment",
    fromUserId: CUSTOMER,
    toUserId: SHOP,
    participants: [CUSTOMER, SHOP],
    amount,
    feeCents: Math.round(amount / 100),
    netCents: amount - Math.round(amount / 100),
    currency,
    status: "completed",
    journalEntryId: "entry-1",
    receiptNumber: "ZP-1",
    createdAt: paidAt,
    completedAt: paidAt,
    ...extra,
  };
};

describe("manager refunds", () => {
  let refund: any, list: any, update: any;
  let restore: (() => void) | undefined;
  let db: FakeDb;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    refund = test.wrap((await import("../qr-payments/refundPayment")).refundPayment);
    list = test.wrap((await import("../staff/refunds")).staffListPayments);
    update = test.wrap((await import("../staff/manage")).staffUpdate);
  });
  afterAll(() => test.cleanup());

  beforeEach(() => {
    mockedPin.mockReset().mockResolvedValue(true);
    (notifyUser as jest.Mock).mockClear();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
    (console.error as jest.Mock).mockRestore?.();
  });

  const CAPS = { refundCapCents: 2_000, refundDayCapCents: 10_000 }; // $20 each, $100 a day

  const seed = (hodan: Record<string, unknown> = grant(HODAN, "manager", CAPS), extra: Record<string, any> = {}) => {
    db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Café Owner" },
      [`merchantProfiles/${SHOP}`]: { businessName: "Café Hargeisa" },
      [`users/${OTHER_SHOP}`]: { accountType: "merchant", fullName: "Other" },
      [`users/${HODAN}`]: { accountType: "customer", fullName: "Hodan Ali" },
      [`users/${ABDI}`]: { accountType: "customer", fullName: "Abdi Warsame" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina Yusuf" },
      [`wallets/${SHOP}`]: wallet(50_000, { sls: pocket(500_000) }),
      [`wallets/${CUSTOMER}`]: wallet(0, { sls: pocket(0) }),
      [`wallets/${HODAN}`]: wallet(700),
      "config/rates": { slsPerUsd: 8_000 },
      "journal_entries/entry-1": { type: "customer_qr_payment" },
      "transactions/tx-1": payment(1_000),
      [`merchantStaff/${SHOP}_${HODAN}`]: hodan,
      [`merchantStaff/${SHOP}_${ABDI}`]: grant(ABDI, "cashier"),
      ...extra,
    });
    restore = useFakeFirestore(db);
  };

  const call = (uid: string, data: Record<string, unknown> = {}) =>
    refund({ data: { transactionId: "tx-1", pin: "246810", merchantId: SHOP, ...data }, auth: { uid } });
  const refunds = () => [...db.store.keys()].filter((p) => p.startsWith("journal_entries/refund_"));
  const today = () => db.get(`staffRefundDays/${SHOP}_${HODAN}_${localParts(Date.now()).day}`);

  it("refunds from the shop's wallet with the manager's own PIN, and says who did it", async () => {
    seed();
    const res = await call(HODAN);

    expect(mockedPin).toHaveBeenCalledWith(HODAN, "246810");
    expect(mockedPin).not.toHaveBeenCalledWith(SHOP, expect.anything());
    expect(res.data).toMatchObject({ amount: 10, currency: "USD" });
    // The shop gives back its net; the manager's own wallet is untouched.
    expect(db.get(`wallets/${SHOP}`)!.balance).toBe(50_000 - 990);
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(1_000);
    expect(db.get(`wallets/${HODAN}`)!.balance).toBe(700);

    const [entryPath] = refunds();
    expect(db.get(entryPath)).toMatchObject({ postedBy: HODAN, refs: expect.objectContaining({ actorUid: HODAN }) });
    const row = db.get(`transactions/${res.data.refundTransactionId}`)!;
    expect(row).toMatchObject({ type: "refund", fromUserId: SHOP, toUserId: CUSTOMER, raisedBy: HODAN });
    expect(row.participants).toEqual([SHOP, CUSTOMER]);

    expect(today()).toMatchObject({ usedCents: 1_000, count: 1, staffUid: HODAN, merchantUid: SHOP });
    expect(notifyUser).toHaveBeenCalledWith(
      SHOP,
      "staff",
      { key: "staff.refunded", params: { name: "Hodan Ali", amount: expect.any(String) } },
      expect.objectContaining({ type: "staff_refund" })
    );
  });

  it("is off until the owner sets both caps", async () => {
    seed(grant(HODAN, "manager"));
    await expect(call(HODAN)).rejects.toThrow(/hasn't turned on refunds/);
    seed(grant(HODAN, "manager", { refundCapCents: 2_000 }));
    await expect(call(HODAN)).rejects.toThrow(/hasn't turned on refunds/);
    expect(refunds()).toHaveLength(0);
  });

  it("never lets a cashier or waiter refund, whatever is on the grant", async () => {
    seed(grant(HODAN, "cashier", CAPS));
    await expect(call(HODAN)).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
    await expect(call(ABDI)).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
    expect(refunds()).toHaveLength(0);
  });

  it("refuses a removed manager, a wrong PIN, and another shop's payment", async () => {
    seed(grant(HODAN, "manager", { ...CAPS, status: "revoked" }));
    await expect(call(HODAN)).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });

    seed();
    mockedPin.mockResolvedValue(false);
    await expect(call(HODAN)).rejects.toThrow(/Invalid PIN/);

    seed(grant(HODAN, "manager", CAPS), { "transactions/tx-1": payment(1_000, "USD", { toUserId: OTHER_SHOP }) });
    mockedPin.mockResolvedValue(true);
    await expect(call(HODAN)).rejects.toThrow(/Only the merchant/);
    expect(refunds()).toHaveLength(0);
  });

  it("never lets a manager refund their own payment into their own wallet; the owner still can", async () => {
    seed(grant(HODAN, "manager", CAPS), {
      "transactions/tx-1": payment(1_000, "USD", { fromUserId: HODAN, participants: [HODAN, SHOP] }),
    });
    for (const attempt of [{}, { amountCents: 400, idempotencyKey: "part-0001-abcdefgh" }]) {
      await expect(call(HODAN, attempt)).rejects.toMatchObject({
        code: "permission-denied",
        details: { reason: "staff_refund_own_payment" },
      });
    }
    // Refused before the PIN is even asked about, and nothing moved or was counted.
    expect(mockedPin).not.toHaveBeenCalled();
    expect(refunds()).toHaveLength(0);
    expect(db.get(`wallets/${SHOP}`)!.balance).toBe(50_000);
    expect(db.get(`wallets/${HODAN}`)!.balance).toBe(700);
    expect(today()).toBeUndefined();
    expect(notifyUser).not.toHaveBeenCalled();

    await refund({ data: { transactionId: "tx-1", pin: "135790" }, auth: { uid: SHOP } });
    expect(db.get(`wallets/${HODAN}`)!.balance).toBe(1_700);
  });

  it("holds a refund over the per-refund cap, but a part within it goes through", async () => {
    seed(grant(HODAN, "manager", { refundCapCents: 500, refundDayCapCents: 10_000 }));
    await expect(call(HODAN)).rejects.toMatchObject({ details: { reason: "staff_refund_over_cap", capCents: 500 } });
    expect(refunds()).toHaveLength(0);
    expect(db.get(`wallets/${SHOP}`)!.balance).toBe(50_000);

    const res = await call(HODAN, { amountCents: 400, idempotencyKey: "part-0001-abcdefgh" });
    expect(res.data).toMatchObject({ amount: 4, remainingCents: 600 });
    expect(today()).toMatchObject({ usedCents: 400 });
  });

  it("stops at the day cap, and a retried refund doesn't count twice", async () => {
    seed(grant(HODAN, "manager", { refundCapCents: 1_000, refundDayCapCents: 1_500 }), {
      "transactions/tx-2": payment(1_000),
    });
    const part = { amountCents: 400, idempotencyKey: "part-0001-abcdefgh" };
    await call(HODAN, part);
    await call(HODAN, part); // the same part, retried
    expect(today()).toMatchObject({ usedCents: 400, count: 1 });

    await refund({
      data: { transactionId: "tx-2", pin: "246810", merchantId: SHOP, amountCents: 900, idempotencyKey: "part-0002-abcdefgh" },
      auth: { uid: HODAN },
    });
    expect(today()).toMatchObject({ usedCents: 1_300, count: 2 });

    // The $6 left on tx-1 fits the per-refund cap but not the day.
    const err = await call(HODAN, { idempotencyKey: "part-0003-abcdefgh" }).catch((e: any) => e);
    expect(err.details).toMatchObject({ reason: "staff_refund_day_cap", usedCents: 1_300 });
    expect(refunds()).toHaveLength(2);
    expect(today()).toMatchObject({ usedCents: 1_300 });
  });

  it("answers a retried refund that finished the payment, without counting it again", async () => {
    seed();
    const key = { idempotencyKey: "whole-0001-abcdefgh" };
    const first = await call(HODAN, key);
    const again = await call(HODAN, key);
    expect(again.data).toEqual(first.data);
    expect(refunds()).toHaveLength(1);
    expect(today()).toMatchObject({ usedCents: 1_000, count: 1 });
    expect(notifyUser).toHaveBeenCalledTimes(2); // customer and shop, once each
  });

  it("counts shillings at slsPerUsd against the caps", async () => {
    // 200,000 SLS at 8,000 to the dollar is $25: over a $20 cap.
    seed(grant(HODAN, "manager", CAPS), { "transactions/tx-1": payment(200_000, "SLS") });
    await expect(call(HODAN)).rejects.toMatchObject({ details: { reason: "staff_refund_over_cap" } });

    // 120,000 SLS is $15.
    seed(grant(HODAN, "manager", CAPS), { "transactions/tx-1": payment(120_000, "SLS") });
    const res = await call(HODAN);
    expect(res.data).toMatchObject({ amount: 120_000, currency: "SLS" });
    expect(today()).toMatchObject({ usedCents: 1_500 });
  });

  it("leaves the shop's own refunds as they were: its PIN, no caps", async () => {
    seed(grant(HODAN, "manager"), { "transactions/tx-1": payment(30_000) });
    await refund({ data: { transactionId: "tx-1", pin: "135790" }, auth: { uid: SHOP } });
    expect(mockedPin).toHaveBeenCalledWith(SHOP, "135790");
    const [entryPath] = refunds();
    expect(db.get(entryPath)!.postedBy).toBe(SHOP);
    expect(db.get(entryPath)!.refs.actorUid).toBeUndefined();
    expect([...db.store.keys()].some((p) => p.startsWith("staffRefundDays/"))).toBe(false);
  });

  describe("the payments list", () => {
    it("shows a manager the shop's recent counter payments, without names unless allowed", async () => {
      seed(grant(HODAN, "manager", CAPS), {
        "transactions/tx-old": payment(500, "USD", {
          createdAt: Timestamp.fromMillis(Date.now() - 40 * DAY_MS),
          completedAt: Timestamp.fromMillis(Date.now() - 40 * DAY_MS),
        }),
        "transactions/tx-api": payment(700, "USD", { apiChargeId: "ch_x" }),
        "transactions/tx-other": payment(800, "USD", { toUserId: OTHER_SHOP }),
        // The manager's own purchase: the owner's to refund, so not on their list.
        "transactions/tx-mine": payment(900, "USD", { fromUserId: HODAN, participants: [HODAN, SHOP] }),
        [`staffRefundDays/${SHOP}_${HODAN}_${localParts(Date.now()).day}`]: { usedCents: 300, count: 1 },
      });
      const res = await list({ data: { merchantId: SHOP }, auth: { uid: HODAN } });
      expect(res.data.payments.map((p: any) => p.id)).toEqual(["tx-1"]);
      expect(res.data.payments[0]).toMatchObject({ amount: 1_000, remaining: 1_000, customerName: null, receiptNumber: "ZP-1" });
      expect(res.data.refunds).toMatchObject({ enabled: true, capCents: 2_000, dayCapCents: 10_000, usedTodayCents: 300 });

      seed(grant(HODAN, "manager", { ...CAPS, showCustomers: true }));
      const named = await list({ data: { merchantId: SHOP }, auth: { uid: HODAN } });
      expect(named.data.payments[0].customerName).toBe("Amina Yusuf");
    });

    it("is for managers only", async () => {
      seed();
      await expect(list({ data: { merchantId: SHOP }, auth: { uid: ABDI } })).rejects.toMatchObject({
        details: { reason: "staff_access_denied" },
      });
      await expect(list({ data: {}, auth: { uid: SHOP } })).rejects.toMatchObject({
        details: { reason: "staff_access_denied" },
      });
    });
  });

  describe("the owner setting caps", () => {
    const set = (data: Record<string, unknown>) =>
      update({ data: { staffUid: HODAN, role: "manager", pin: "135790", ...data }, auth: { uid: SHOP } });

    it("sets and clears both caps with the owner's PIN, and audits it", async () => {
      seed(grant(HODAN, "manager"));
      const on = await set({ refundCapCents: 2_000, refundDayCapCents: 10_000 });
      expect(mockedPin).toHaveBeenCalledWith(SHOP, "135790");
      expect(on.data).toMatchObject({ refundCapCents: 2_000, refundDayCapCents: 10_000 });
      expect(db.get(`merchantStaff/${SHOP}_${HODAN}`)).toMatchObject({ refundCapCents: 2_000, refundDayCapCents: 10_000 });
      const audits = [...db.store.entries()].filter(([p]) => p.startsWith("merchantStaffAudit/")).map(([, v]) => v);
      expect(audits).toContainEqual(expect.objectContaining({ action: "changed", refundCapCents: 2_000, refundDayCapCents: 10_000 }));

      const off = await set({});
      expect(off.data).toMatchObject({ refundCapCents: 0, refundDayCapCents: 0 });
      expect(db.get(`merchantStaff/${SHOP}_${HODAN}`)!.refundCapCents).toBeUndefined();
    });

    it("drops the caps when a manager becomes a cashier", async () => {
      seed();
      await set({ role: "cashier", refundCapCents: 2_000, refundDayCapCents: 10_000 });
      expect(db.get(`merchantStaff/${SHOP}_${HODAN}`)).toMatchObject({ role: "cashier" });
      expect(db.get(`merchantStaff/${SHOP}_${HODAN}`)!.refundCapCents).toBeUndefined();
    });

    it.each([
      [{ refundCapCents: 2_000 }],
      [{ refundCapCents: 2_000, refundDayCapCents: 1_000 }],
      [{ refundCapCents: 12.5, refundDayCapCents: 10_000 }],
      [{ refundCapCents: -5, refundDayCapCents: 10_000 }],
      [{ refundCapCents: 100_001, refundDayCapCents: 500_000 }],
      [{ refundCapCents: 2_000, refundDayCapCents: 500_001 }],
    ])("refuses caps that don't make sense: %j", async (caps) => {
      seed(grant(HODAN, "manager"));
      await expect(set(caps)).rejects.toMatchObject({ details: expect.objectContaining({ reason: "staff_bad_refund_caps" }) });
    });
  });
});
