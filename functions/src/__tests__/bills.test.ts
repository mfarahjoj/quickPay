import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/limits", () => ({
  enforceTransactionLimits: jest.fn().mockResolvedValue(undefined),
  enforcePerTransactionLimit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/velocity", () => ({ enforceVelocity: jest.fn().mockResolvedValue(undefined) }));

import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { enforceTransactionLimits } from "../utils/limits";
import { clearRatesCache } from "../config/rates";
import { addDays, hargeisaToday, nextDue, parseDay, startOfDayMs } from "../bills/dates";
import { validateEntry } from "../ledger/validate";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const mockedNotify = notifyUser as jest.MockedFunction<typeof notifyUser>;
const mockedLimits = enforceTransactionLimits as jest.MockedFunction<typeof enforceTransactionLimits>;
const { Timestamp } = admin.firestore;

const SHOP = "water-co";
const GYM = "gym-1";
const CUSTOMER = "cust-1";
const OTHER = "cust-2";
const PHONE = "+252634000001";
const KEY = "bill-key-0001";

const notifiedKeys = () => mockedNotify.mock.calls.map((c) => (c[2] as { key: string }).key);

describe("dates", () => {
  it("keeps a monthly bill on its day, or the month's last", () => {
    expect(nextDue("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    expect(nextDue("2026-02-28", "monthly", 31)).toBe("2026-03-31");
    expect(nextDue("2026-12-15", "monthly", 15)).toBe("2027-01-15");
    expect(nextDue("2026-12-29", "weekly", 29)).toBe("2027-01-05");
  });

  it("reads a due date as midnight in Hargeisa", () => {
    expect(new Date(startOfDayMs("2026-12-01")).toISOString()).toBe("2026-11-30T21:00:00.000Z");
    expect(hargeisaToday(Date.parse("2026-11-30T21:00:00Z"))).toBe("2026-12-01");
    expect(hargeisaToday(Date.parse("2026-11-30T20:59:00Z"))).toBe("2026-11-30");
    expect(addDays("2026-03-01", -3)).toBe("2026-02-26");
  });

  it("refuses days that don't exist", () => {
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-2-3")).toBeNull();
    expect(parseDay("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
  });
});

describe("bills", () => {
  let create: any;
  let cancel: any;
  let merchantList: any;
  let stopSeries: any;
  let list: any;
  let pay: any;
  let decline: any;
  let setAutopay: any;
  let disableAutopay: any;
  let refund: any;
  let runBillsNow: (now?: FirebaseFirestore.Timestamp) => Promise<{ issued: number; paid: number; failed: number }>;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const m = await import("../bills/merchant");
    const c = await import("../bills/customer");
    create = test.wrap(m.createBill);
    cancel = test.wrap(m.cancelBill);
    merchantList = test.wrap(m.merchantListBills);
    stopSeries = test.wrap(m.stopBillSeries);
    list = test.wrap(c.listMyBills);
    pay = test.wrap(c.payBill);
    decline = test.wrap(c.declineBill);
    setAutopay = test.wrap(c.setBillAutopay);
    disableAutopay = test.wrap(c.disableBillAutopay);
    refund = test.wrap((await import("../qr-payments/refundPayment")).refundPayment);
    runBillsNow = (await import("../bills/schedule")).runBillsNow;
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

  const seed = (customerBalance = 10_000, extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali", kycStatus: "verified" },
      [`merchantProfiles/${SHOP}`]: { businessName: "Hargeisa Water" },
      [`users/${GYM}`]: { accountType: "agent_merchant", fullName: "Gym Owner", kycStatus: "verified" },
      [`users/${CUSTOMER}`]: {
        accountType: "customer",
        fullName: "Amina Yusuf Ali",
        phoneNumber: PHONE,
        kycStatus: "verified",
      },
      [`users/${OTHER}`]: { accountType: "customer", fullName: "Ali Warsame", phoneNumber: "+252634000002" },
      [`wallets/${SHOP}`]: wallet(0),
      [`wallets/${GYM}`]: wallet(0),
      [`wallets/${CUSTOMER}`]: wallet(customerBalance),
      [`wallets/${OTHER}`]: wallet(0),
      "config/rates": { paymentFeeRate: 0.01 },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const today = hargeisaToday();
  const sendBill = (data: Record<string, unknown> = {}, uid = SHOP) =>
    create({
      data: {
        customerPhone: PHONE,
        amount: 2_500,
        currency: "USD",
        description: "Water, November",
        reference: "Meter 4471",
        dueDate: today,
        idempotencyKey: KEY,
        ...data,
      },
      auth: { uid },
    });
  const payIt = (billId: string, extra: Record<string, unknown> = {}, uid = CUSTOMER) =>
    pay({ data: { billId, pin: "123456", ...extra }, auth: { uid } });
  const balance = (db: FakeDb, uid: string) => db.get(`wallets/${uid}`)!.balance;
  /** A moment safely after today's bills fell due. */
  const later = (hours = 1) => Timestamp.fromMillis(Date.now() + hours * 3_600_000);

  describe("sending a bill", () => {
    it("bills a customer by phone number and tells them", async () => {
      const db = seed();
      const res = await sendBill();
      const id = `${SHOP}_${KEY}`;
      expect(res.data.bill).toMatchObject({
        id,
        merchantName: "Hargeisa Water",
        customerName: "Amina A.",
        amount: 2_500,
        currency: "USD",
        status: "open",
        reference: "Meter 4471",
        dueDate: today,
      });
      expect(db.get(`bills/${id}`)).toMatchObject({ customerId: CUSTOMER, merchantId: SHOP });
      expect(mockedNotify).toHaveBeenCalledWith(
        CUSTOMER,
        "bill",
        expect.objectContaining({ key: "bill.received" }),
        { type: "bill", billId: id }
      );
    });

    it("sends a retried bill once", async () => {
      const db = seed();
      await sendBill();
      const again = await sendBill();
      expect(again.data.bill.id).toBe(`${SHOP}_${KEY}`);
      expect([...db.store.keys()].filter((k) => k.startsWith("bills/"))).toHaveLength(1);
      expect(mockedNotify).toHaveBeenCalledTimes(1);
    });

    it("only lets shops send bills", async () => {
      seed();
      await expect(sendBill({}, OTHER)).rejects.toThrow(/Only shops/);
    });

    it("says so when no account uses the number", async () => {
      seed();
      await expect(sendBill({ customerPhone: "+252639999999" })).rejects.toThrow(/No Zapp Pay account/);
    });

    it("refuses a due date in the past or too far ahead", async () => {
      seed();
      await expect(sendBill({ dueDate: addDays(today, -1) })).rejects.toThrow(/due date/);
      await expect(sendBill({ dueDate: addDays(today, 91) })).rejects.toThrow(/due date/);
      await expect(sendBill({ dueDate: "2026-02-30" })).rejects.toThrow(/YYYY-MM-DD/);
    });

    it("needs a description and a whole positive amount", async () => {
      seed();
      await expect(sendBill({ description: "  " })).rejects.toThrow(/what the bill is for/);
      await expect(sendBill({ amount: 12.5 })).rejects.toThrow(/Amount/);
      await expect(sendBill({ amount: 0 })).rejects.toThrow(/Amount/);
    });

    it("sets up a repeating bill with the next due date", async () => {
      const db = seed();
      const due = addDays(today, 2);
      const res = await sendBill({ repeat: "monthly", dueDate: due });
      const seriesId = `s_${SHOP}_${KEY}`;
      expect(res.data.series).toMatchObject({ id: seriesId, interval: "monthly", active: true });
      const day = parseDay(due)!.d;
      expect(db.get(`billSeries/${seriesId}`)).toMatchObject({
        nextDueDate: nextDue(due, "monthly", day),
        anchorDay: day,
      });
      expect(db.get(`bills/${SHOP}_${KEY}`)!.seriesId).toBe(seriesId);
    });

    it("lets the shop withdraw an open bill, and list its bills", async () => {
      seed();
      const { data } = await sendBill();
      const res = await cancel({ data: { billId: data.bill.id }, auth: { uid: SHOP } });
      expect(res.data.bill.status).toBe("cancelled");
      await expect(cancel({ data: { billId: data.bill.id }, auth: { uid: GYM } })).rejects.toThrow(/not found/);
      const listed = await merchantList({ data: {}, auth: { uid: SHOP } });
      expect(listed.data.bills.map((b: any) => b.status)).toEqual(["cancelled"]);
    });
  });

  describe("paying a bill", () => {
    it("moves the money like a shop payment and closes the bill", async () => {
      const db = seed();
      const { data } = await sendBill();
      const res = await payIt(data.bill.id, { expectedAmount: 2_500 });

      expect(res.data).toMatchObject({ billId: data.bill.id, amount: 2_500, currency: "USD" });
      expect(balance(db, CUSTOMER)).toBe(7_500);
      expect(balance(db, SHOP)).toBe(2_475);
      expect(db.get("ledger_balances/platform:fees")!.balance).toBe(25);

      const entry = db.get(`journal_entries/bill_${data.bill.id}`)!;
      expect(entry.type).toBe("bill_payment");
      expect(entry.refs).toMatchObject({ billId: data.bill.id, transactionId: res.data.transactionId });

      const row = db.get(`transactions/${res.data.transactionId}`)!;
      expect(row).toMatchObject({
        type: "payment",
        kind: "merchant_payment",
        participants: [CUSTOMER, SHOP],
        journalEntryId: `bill_${data.bill.id}`,
        billId: data.bill.id,
        reference: "Meter 4471",
        netCents: 2_475,
        feeCents: 25,
      });
      expect(row.autopay).toBeUndefined();
      expect(db.get(`bills/${data.bill.id}`)).toMatchObject({
        status: "paid",
        paidBy: "customer",
        transactionId: res.data.transactionId,
        receiptNumber: res.data.receiptNumber,
      });
      expect(mockedLimits).toHaveBeenCalledWith(CUSTOMER, 2_500, expect.anything(), undefined, "USD");
      expect(notifiedKeys()).toContain("bill.paid");
    });

    it("answers a retry with the same payment and charges once", async () => {
      const db = seed();
      const { data } = await sendBill();
      const first = await payIt(data.bill.id);
      const second = await payIt(data.bill.id);
      expect(second.data.transactionId).toBe(first.data.transactionId);
      expect(balance(db, CUSTOMER)).toBe(7_500);
    });

    it("needs the right PIN", async () => {
      const db = seed();
      const { data } = await sendBill();
      mockedPin.mockResolvedValue(false);
      await expect(payIt(data.bill.id)).rejects.toThrow(/Invalid PIN/);
      expect(balance(db, CUSTOMER)).toBe(10_000);
    });

    it("can't be paid by someone else", async () => {
      seed();
      const { data } = await sendBill();
      await expect(payIt(data.bill.id, {}, OTHER)).rejects.toThrow(/not found/);
    });

    it("pays what was shown or nothing", async () => {
      const db = seed();
      const { data } = await sendBill();
      await expect(payIt(data.bill.id, { expectedAmount: 2_000 })).rejects.toThrow(/does not match/);
      expect(balance(db, CUSTOMER)).toBe(10_000);
      expect(db.get(`bills/${data.bill.id}`)!.status).toBe("open");
    });

    it("leaves the bill open when the wallet is short", async () => {
      const db = seed(1_000);
      const { data } = await sendBill();
      await expect(payIt(data.bill.id)).rejects.toThrow(/Insufficient balance/);
      expect(db.get(`bills/${data.bill.id}`)!.status).toBe("open");
      expect(balance(db, CUSTOMER)).toBe(1_000);
    });

    it("can't pay a declined bill, and tells the shop it was declined", async () => {
      seed();
      const { data } = await sendBill();
      const res = await decline({ data: { billId: data.bill.id }, auth: { uid: CUSTOMER } });
      expect(res.data.bill.status).toBe("declined");
      expect(notifiedKeys()).toContain("bill.declined");
      await expect(payIt(data.bill.id)).rejects.toThrow(/declined/);
    });

    it("can be refunded by the shop like any counter payment", async () => {
      const db = seed();
      const { data } = await sendBill();
      const paid = await payIt(data.bill.id);
      await refund({ data: { transactionId: paid.data.transactionId, pin: "123456" }, auth: { uid: SHOP } });
      expect(balance(db, CUSTOMER)).toBe(10_000);
      expect(balance(db, SHOP)).toBe(0);
    });

    it("posts a valid, zero-sum entry", async () => {
      const db = seed();
      const { data } = await sendBill();
      await payIt(data.bill.id);
      const entry = db.get(`journal_entries/bill_${data.bill.id}`)!;
      expect(() =>
        validateEntry({
          entryId: `bill_${data.bill.id}`,
          type: entry.type,
          currency: entry.currency,
          lines: entry.lines,
          description: entry.description,
          postedBy: entry.postedBy,
        })
      ).not.toThrow();
    });
  });

  describe("auto-pay", () => {
    const turnOn = (maxAmount = 5_000, merchantId = SHOP) =>
      setAutopay({ data: { merchantId, maxAmount, currency: "USD", pin: "123456" }, auth: { uid: CUSTOMER } });

    it("needs the PIN and a shop that has billed the customer", async () => {
      seed();
      await expect(turnOn(5_000, GYM)).rejects.toThrow(/shops that bill you/);
      await sendBill({ dueDate: addDays(today, 5) });
      mockedPin.mockResolvedValue(false);
      await expect(turnOn()).rejects.toThrow(/Invalid PIN/);
      mockedPin.mockResolvedValue(true);
      const res = await turnOn();
      expect(res.data.autopay).toMatchObject({ merchantId: SHOP, merchantName: "Hargeisa Water", maxAmount: 5_000 });
      const listed = await list({ data: {}, auth: { uid: CUSTOMER } });
      expect(listed.data.autopay).toHaveLength(1);
      expect(listed.data.bills).toHaveLength(1);
    });

    it("pays a covered bill once it falls due, and not before", async () => {
      const db = seed();
      const { data } = await sendBill({ dueDate: addDays(today, 1) });
      await turnOn();

      expect((await runBillsNow()).paid).toBe(0);
      expect(db.get(`bills/${data.bill.id}`)!.status).toBe("open");

      const res = await runBillsNow(later(25));
      expect(res.paid).toBe(1);
      expect(balance(db, CUSTOMER)).toBe(7_500);
      const bill = db.get(`bills/${data.bill.id}`)!;
      expect(bill).toMatchObject({ status: "paid", paidBy: "autopay" });
      expect(db.get(`transactions/${bill.transactionId}`)!.autopay).toBe(true);
      expect(db.get(`journal_entries/bill_${data.bill.id}`)!.postedBy).toBe("system");
      expect(notifiedKeys()).toEqual(expect.arrayContaining(["bill.autopaid", "bill.paid"]));

      // The next run finds nothing more to do.
      expect((await runBillsNow(later(26))).paid).toBe(0);
      expect(balance(db, CUSTOMER)).toBe(7_500);
    });

    it("tells the customer when a new bill will be auto-paid, or is over the limit", async () => {
      seed();
      await sendBill({ dueDate: addDays(today, 3) });
      await turnOn(3_000);
      mockedNotify.mockClear();
      await sendBill({ idempotencyKey: "bill-key-0002", amount: 2_000 });
      await sendBill({ idempotencyKey: "bill-key-0003", amount: 4_000 });
      expect(notifiedKeys()).toEqual(["bill.received_autopay", "bill.over_autopay_limit"]);
    });

    it("leaves bills over the limit, from other shops, or after it is turned off", async () => {
      const db = seed();
      const big = await sendBill({ amount: 6_000 });
      const small = await sendBill({ idempotencyKey: "bill-key-0002", amount: 1_000 });
      const gym = await sendBill({ idempotencyKey: "bill-key-0003", amount: 1_000 }, GYM);
      await turnOn();
      await disableAutopay({ data: { merchantId: SHOP }, auth: { uid: CUSTOMER } });

      expect((await runBillsNow(later())).paid).toBe(0);
      for (const b of [big, small, gym]) expect(db.get(`bills/${b.data.bill.id}`)!.status).toBe("open");

      await turnOn();
      expect((await runBillsNow(later())).paid).toBe(1);
      expect(db.get(`bills/${small.data.bill.id}`)!.status).toBe("paid");
      expect(db.get(`bills/${big.data.bill.id}`)!.status).toBe("open");
      expect(db.get(`bills/${gym.data.bill.id}`)!.status).toBe("open");
    });

    it("tries a short wallet once a day, three times, telling the customer each time", async () => {
      const db = seed(1_000);
      const { data } = await sendBill();
      await turnOn();

      expect((await runBillsNow(later(1))).failed).toBe(1);
      expect((await runBillsNow(later(2))).failed).toBe(0); // not again the same day
      expect(db.get(`bills/${data.bill.id}`)).toMatchObject({
        status: "open",
        autopayTries: 1,
        autopayLastError: "Insufficient balance",
      });
      await runBillsNow(later(25));
      await runBillsNow(later(49));
      expect((await runBillsNow(later(73))).failed).toBe(0);
      expect(db.get(`bills/${data.bill.id}`)!.autopayTries).toBe(3);
      expect(notifiedKeys().filter((k) => k === "bill.autopay_failed")).toHaveLength(3);
      expect(balance(db, CUSTOMER)).toBe(1_000);

      // The customer can still pay it themselves once they top up.
      db.store.set(`wallets/${CUSTOMER}`, wallet(5_000));
      await payIt(data.bill.id);
      expect(db.get(`bills/${data.bill.id}`)!.status).toBe("paid");
    });

    it("respects the customer's limits", async () => {
      const db = seed();
      const { data } = await sendBill();
      await turnOn();
      mockedLimits.mockRejectedValueOnce(new (require("firebase-functions/v2").https.HttpsError)(
        "permission-denied",
        "Daily limit reached"
      ));
      expect((await runBillsNow(later())).failed).toBe(1);
      expect(db.get(`bills/${data.bill.id}`)).toMatchObject({ status: "open", autopayLastError: "Daily limit reached" });
    });

    it("doesn't pay a frozen shop", async () => {
      const db = seed();
      const { data } = await sendBill();
      await turnOn();
      db.store.set(`users/${SHOP}`, { ...db.get(`users/${SHOP}`), accountStatus: "frozen" });
      expect((await runBillsNow(later())).paid).toBe(0);
      expect(db.get(`bills/${data.bill.id}`)!.status).toBe("open");
      expect(balance(db, CUSTOMER)).toBe(10_000);
    });
  });

  describe("repeating bills", () => {
    it("sends the next bill a few days before it is due, once", async () => {
      const db = seed();
      await sendBill({ repeat: "weekly", amount: 1_500, description: "Gym membership" });
      const seriesId = `s_${SHOP}_${KEY}`;
      const next = db.get(`billSeries/${seriesId}`)!.nextDueDate;
      expect(next).toBe(addDays(today, 7));

      expect((await runBillsNow(later(1))).issued).toBe(0);
      const issueAt = Timestamp.fromMillis(startOfDayMs(addDays(next, -3)) + 60_000);
      expect((await runBillsNow(issueAt)).issued).toBe(1);
      expect((await runBillsNow(issueAt)).issued).toBe(0);

      expect(db.get(`bills/${seriesId}_${next}`)).toMatchObject({
        status: "open",
        amount: 1_500,
        description: "Gym membership",
        dueDate: next,
        seriesId,
      });
      expect(db.get(`billSeries/${seriesId}`)!.nextDueDate).toBe(addDays(next, 7));
    });

    it("stops when the customer stops it, and tells the shop", async () => {
      const db = seed();
      await sendBill({ repeat: "monthly" });
      const seriesId = `s_${SHOP}_${KEY}`;
      await expect(stopSeries({ data: { seriesId }, auth: { uid: OTHER } })).rejects.toThrow(/not found/);
      await stopSeries({ data: { seriesId }, auth: { uid: CUSTOMER } });
      expect(db.get(`billSeries/${seriesId}`)).toMatchObject({ active: false, stoppedBy: "customer" });
      expect(notifiedKeys()).toContain("bill.series_stopped");
      expect((await runBillsNow(later(24 * 40))).issued).toBe(0);
    });
  });

  describe("direct payment requests", () => {
    let requestIt: any;
    let cancelReq: any;
    let answer: any;
    beforeAll(async () => {
      const r = await import("../bills/requests");
      requestIt = test.wrap(r.requestDirectPayment);
      cancelReq = test.wrap(r.cancelDirectPaymentRequest);
      answer = test.wrap(r.answerDirectPaymentRequest);
    });

    const SHOP_PHONE = "+252634000099";
    const seedShop = (balance = 10_000) => {
      const db = seed(balance);
      db.store.set(`users/${GYM}`, { ...db.get(`users/${GYM}`), phoneNumber: SHOP_PHONE });
      return db;
    };
    const REQ_KEY = "req-key-0001";
    const reqId = `${CUSTOMER}_${REQ_KEY}`;
    const ask = (data: Record<string, unknown> = {}) =>
      requestIt({
        data: {
          merchantPhone: SHOP_PHONE,
          amount: 2_500,
          currency: "USD",
          description: "Gym membership",
          reference: "Member 88",
          interval: "monthly",
          firstDueDate: addDays(today, 2),
          autopay: true,
          pin: "123456",
          idempotencyKey: REQ_KEY,
          ...data,
        },
        auth: { uid: CUSTOMER },
      });
    const reply = (approve: boolean, uid = GYM, requestId = reqId) =>
      answer({ data: { requestId, approve }, auth: { uid } });

    it("lets a customer ask a shop, and tells the shop", async () => {
      const db = seedShop();
      const res = await ask();
      expect(res.data.request).toMatchObject({
        id: reqId,
        merchantName: "Gym Owner",
        customerName: "Amina A.",
        status: "pending",
        interval: "monthly",
        autopay: true,
      });
      expect(db.get(`billRequests/${reqId}`)!.merchantId).toBe(GYM);
      expect(notifiedKeys()).toEqual(["bill.request_received"]);
      // A retry is the same request.
      await ask();
      expect([...db.store.keys()].filter((k) => k.startsWith("billRequests/"))).toHaveLength(1);
      const listed = await merchantList({ data: {}, auth: { uid: GYM } });
      expect(listed.data.requests.map((r: any) => r.id)).toEqual([reqId]);
      const mine = await list({ data: {}, auth: { uid: CUSTOMER } });
      expect(mine.data.requests.map((r: any) => r.id)).toEqual([reqId]);
    });

    it("needs the PIN for auto-pay, and not without it", async () => {
      seedShop();
      mockedPin.mockResolvedValue(false);
      await expect(ask()).rejects.toThrow(/Invalid PIN/);
      await expect(ask({ pin: undefined })).rejects.toThrow(/PIN is required/);
      const res = await ask({ autopay: false, pin: undefined });
      expect(res.data.request.autopay).toBe(false);
      expect(mockedPin).toHaveBeenCalledTimes(1);
    });

    it("only goes to shops", async () => {
      seedShop();
      await expect(ask({ merchantPhone: "+252639999999" })).rejects.toThrow(/Shop not found/);
      await expect(ask({ merchantPhone: "+252634000002" })).rejects.toThrow(/isn't a shop/);
      await expect(ask({ merchantPhone: PHONE })).rejects.toThrow(/yourself/);
    });

    it("checks the schedule and the first date", async () => {
      seedShop();
      await expect(ask({ interval: "daily" })).rejects.toThrow(/weekly or monthly/);
      await expect(ask({ firstDueDate: addDays(today, -1) })).rejects.toThrow(/first payment/);
      await expect(ask({ firstDueDate: addDays(today, 61) })).rejects.toThrow(/first payment/);
    });

    it("limits how many can wait at once", async () => {
      seedShop();
      for (let i = 0; i < 5; i++) await ask({ idempotencyKey: `req-key-100${i}` });
      await expect(ask({ idempotencyKey: "req-key-1009" })).rejects.toThrow(/too many requests/);
    });

    it("on approval starts the repeating bill and auto-pay, which then pays it", async () => {
      const db = seedShop();
      await ask();
      mockedNotify.mockClear();
      const res = await reply(true);
      const seriesId = `s_req_${reqId}`;
      const first = addDays(today, 2);
      expect(res.data.request).toMatchObject({ status: "approved", firstBillId: `${seriesId}_${first}` });

      expect(db.get(`billSeries/${seriesId}`)).toMatchObject({
        customerId: CUSTOMER,
        merchantId: GYM,
        interval: "monthly",
        active: true,
        nextDueDate: nextDue(first, "monthly", parseDay(first)!.d),
      });
      expect(db.get(`bills/${seriesId}_${first}`)).toMatchObject({
        status: "open",
        amount: 2_500,
        reference: "Member 88",
        dueDate: first,
      });
      expect(db.get(`billAutopay/${CUSTOMER}_${GYM}`)).toMatchObject({ active: true, maxAmount: 2_500, currency: "USD" });
      expect(notifiedKeys()).toEqual(["bill.request_approved"]);
      // The push opens the set-up receipt in new builds, the first bill in old ones.
      expect(mockedNotify.mock.calls[0][3]).toEqual({
        type: "bill",
        billId: `${seriesId}_${first}`,
        requestId: reqId,
        seriesId,
      });

      expect((await runBillsNow(later(1))).paid).toBe(0);
      expect((await runBillsNow(later(49))).paid).toBe(1);
      expect(balance(db, CUSTOMER)).toBe(7_500);
      expect(db.get(`bills/${seriesId}_${first}`)!.paidBy).toBe("autopay");

      // Answering again changes nothing.
      await reply(true);
      expect([...db.store.keys()].filter((k) => k.startsWith("billSeries/"))).toHaveLength(1);
    });

    it("without auto-pay, the customer pays each bill", async () => {
      const db = seedShop();
      await ask({ autopay: false, pin: undefined });
      await reply(true);
      expect(db.get(`billAutopay/${CUSTOMER}_${GYM}`)).toBeUndefined();
      expect((await runBillsNow(later(49))).paid).toBe(0);
      const listed = await list({ data: {}, auth: { uid: CUSTOMER } });
      expect(listed.data.bills).toHaveLength(1);
      expect(listed.data.series).toHaveLength(1);
      expect(listed.data.requests).toHaveLength(0);
    });

    it("starts today when the shop answers after the requested date", async () => {
      const db = seedShop();
      await ask({ firstDueDate: today });
      db.store.set(`billRequests/${reqId}`, { ...db.get(`billRequests/${reqId}`), firstDueDate: addDays(today, -3) });
      const res = await reply(true);
      expect(res.data.request.firstBillId).toBe(`s_req_${reqId}_${today}`);
    });

    it("keeps a higher auto-pay limit the customer already set", async () => {
      const db = seedShop();
      db.store.set(`billAutopay/${CUSTOMER}_${GYM}`, {
        customerId: CUSTOMER,
        merchantId: GYM,
        merchantName: "Gym Owner",
        maxAmount: 9_000,
        currency: "USD",
        active: true,
      });
      await ask();
      await reply(true);
      expect(db.get(`billAutopay/${CUSTOMER}_${GYM}`)!.maxAmount).toBe(9_000);
    });

    it("can be declined by the shop, or taken back by the customer", async () => {
      const db = seedShop();
      await ask();
      await expect(reply(true, SHOP)).rejects.toThrow(/not found/);
      mockedNotify.mockClear();
      await reply(false);
      expect(db.get(`billRequests/${reqId}`)!.status).toBe("declined");
      expect(notifiedKeys()).toEqual(["bill.request_declined"]);
      expect([...db.store.keys()].some((k) => k.startsWith("billSeries/"))).toBe(false);

      await ask({ idempotencyKey: "req-key-0002" });
      await cancelReq({ data: { requestId: `${CUSTOMER}_req-key-0002` }, auth: { uid: CUSTOMER } });
      await expect(reply(true, GYM, `${CUSTOMER}_req-key-0002`)).rejects.toThrow(/cancelled/);
      await expect(cancelReq({ data: { requestId: reqId }, auth: { uid: CUSTOMER } })).rejects.toThrow(/already declined/);
    });
  });
});
