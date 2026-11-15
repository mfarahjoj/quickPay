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
jest.mock("../counterDisplay/state", () => ({
  ...jest.requireActual("../counterDisplay/state"),
  syncCounterStateQuietly: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { enforcePerTransactionLimit, enforceTransactionLimits } from "../utils/limits";
import { sendPushNotification } from "../utils/notifications";
import { clearRatesCache } from "../config/rates";
import { parseEmvQRPayload } from "../utils/emvqr";
import { appReads } from "../utils/money";
import { makeFlash } from "../counterDisplay/state";
import { flashForQr } from "../counterDisplay/triggers";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const { Timestamp } = admin.firestore;

const SHOP = "shop-1";
const CUSTOMER = "cust-1";
const TOKEN = "tok123";
const READS_BOTH = ["USD", "SLS"];

const pocket = (balance: number) => ({ balance, totalSent: 0, totalReceived: 0 });

/**
 * A shop takes payment in shillings (SHILLINGS.md): its till QR and its
 * charges to a scanned customer code. A shilling sale moves the customer's and
 * the shop's shilling balances and the platform's shilling fees, and nothing in
 * dollars. A customer app that would show 30,000 shillings as "$300.00" is
 * told to update instead of being handed the code.
 *
 * The ledger is real; PIN, limits, velocity and pushes are stubbed.
 */
describe("a shop receiving shillings", () => {
  let generate: any;
  let validate: any;
  let pay: any;
  let charge: any;
  let approve: any;
  let refund: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    generate = test.wrap((await import("../qr-payments/generateQR")).generateQRCode);
    validate = test.wrap((await import("../qr-payments/validateQR")).validateQRCode);
    pay = test.wrap((await import("../qr-payments/processPayment")).processPayment);
    charge = test.wrap((await import("../customer-qr/createPaymentRequest")).createPaymentRequest);
    approve = test.wrap((await import("../customer-qr/approvePayment")).approvePaymentRequest);
    refund = test.wrap((await import("../qr-payments/refundPayment")).refundPayment);
    payMerchant = test.wrap((await import("../qr-payments/payMerchant")).payMerchant);
  });
  let payMerchant: any;

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
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali", kycStatus: "verified" },
      [`merchantProfiles/${SHOP}`]: { businessName: "Hodan's Shop" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina Yusuf", kycStatus: "verified" },
      [`wallets/${SHOP}`]: wallet(0),
      [`wallets/${CUSTOMER}`]: wallet(5_000, { sls: pocket(100_000) }),
      "config/rates": { slsPerUsd: 8_000, paymentFeeRate: 0.01 },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const sls = (db: FakeDb, uid: string) => db.get(`wallets/${uid}`)!.sls?.balance ?? 0;
  const usd = (db: FakeDb, uid: string) => db.get(`wallets/${uid}`)!.balance;

  const newQr = async (amount = 30_000, currency = "SLS") =>
    (await generate({ data: { amount, currency }, auth: { uid: SHOP } })).data;

  describe("the till QR", () => {
    it("is stored in shillings, with the fee in whole shillings", async () => {
      const db = seed();
      const qr = await newQr();
      expect(qr).toMatchObject({ feeCents: 300, netCents: 29_700 });
      expect(db.get(`qrCodes/${qr.qrCodeId}`)).toMatchObject({ amount: 30_000, currency: "SLS", status: "active" });
    });

    it("carries no amount for other wallets to misread", async () => {
      seed();
      const qr = await newQr();
      const parsed = parseEmvQRPayload(qr.emvQrData)!;
      expect(parsed.qrCodeId).toBe(qr.qrCodeId);
      expect(parsed.amount).toBeUndefined();
      expect(parsed.currencyCode).toBe("706");
    });

    it("still makes dollar codes as before", async () => {
      seed();
      const qr = await newQr(1_250, "USD");
      const parsed = parseEmvQRPayload(qr.emvQrData)!;
      expect(parsed).toMatchObject({ currencyCode: "840", amount: 12.5 });
    });

    it("refuses a currency Zapp doesn't hold", async () => {
      seed();
      await expect(newQr(1_000, "GBP")).rejects.toThrow(/USD, SLS/);
    });
  });

  describe("scanning it", () => {
    it("tells an app that can't show shillings to update, and leaves the code active", async () => {
      const db = seed();
      const qr = await newQr();
      const res = await validate({ data: { qrData: qr.emvQrData }, auth: { uid: CUSTOMER } });
      expect(res.data).toMatchObject({ valid: false, updateFor: "shillings" });
      expect(res.data.reason).toMatch(/Update Zapp Pay/);
      expect(db.get(`qrCodes/${qr.qrCodeId}`)!.status).toBe("active");
    });

    it("gives an app that reads shillings the amount in shillings", async () => {
      seed();
      const qr = await newQr();
      const res = await validate({ data: { qrData: qr.emvQrData, currencies: READS_BOTH }, auth: { uid: CUSTOMER } });
      expect(res.data).toMatchObject({ valid: true, amount: 30_000, currency: "SLS" });
    });
  });

  describe("paying it", () => {
    const payQr = (qrCodeId: string, currencies?: string[]) =>
      pay({ data: { qrCodeId, pin: "123456", ...(currencies ? { currencies } : {}) }, auth: { uid: CUSTOMER } });

    it("moves shillings only: customer to shop, fee to the platform", async () => {
      const db = seed();
      const qr = await newQr();
      const res = await payQr(qr.qrCodeId, READS_BOTH);
      expect(res.data).toMatchObject({ status: "completed", amount: 30_000 });

      expect(sls(db, CUSTOMER)).toBe(70_000);
      expect(sls(db, SHOP)).toBe(29_700);
      expect(db.get("ledger_balances/platform:fees@SLS")!.balance).toBe(300);
      expect(usd(db, CUSTOMER)).toBe(5_000);
      expect(usd(db, SHOP)).toBe(0);
      expect(db.get(`transactions/${res.data.transactionId}`)).toMatchObject({
        currency: "SLS",
        amount: 30_000,
        feeCents: 300,
        netCents: 29_700,
      });
      expect(enforceTransactionLimits).toHaveBeenCalledWith(CUSTOMER, 30_000, expect.anything(), undefined, "SLS");
    });

    it("refuses an app that would have shown the wrong amount, and moves nothing", async () => {
      const db = seed();
      const qr = await newQr();
      const err = await payQr(qr.qrCodeId).catch((e: any) => e);
      expect(err.details).toEqual({ reason: "update_for_shillings" });
      expect(sls(db, CUSTOMER)).toBe(100_000);
      expect(db.get(`qrCodes/${qr.qrCodeId}`)!.status).toBe("active");
    });

    it("never pays shillings out of dollars", async () => {
      const db = seed({ [`wallets/${CUSTOMER}`]: wallet(500_000) });
      const qr = await newQr();
      await expect(payQr(qr.qrCodeId, READS_BOTH)).rejects.toThrow(/Insufficient/i);
      expect(usd(db, CUSTOMER)).toBe(500_000);
    });

    it("lets any app pay a dollar code, as before", async () => {
      const db = seed();
      const qr = await newQr(1_000, "USD");
      await payQr(qr.qrCodeId);
      expect(usd(db, CUSTOMER)).toBe(4_000);
      expect(sls(db, CUSTOMER)).toBe(100_000);
    });

    it("refunds in shillings, and says so", async () => {
      const db = seed();
      const qr = await newQr();
      const paid = await payQr(qr.qrCodeId, READS_BOTH);
      const res = await refund({ data: { transactionId: paid.data.transactionId, pin: "123456" }, auth: { uid: SHOP } });
      expect(res.data).toMatchObject({ amount: 30_000, currency: "SLS" });
      expect(sls(db, CUSTOMER)).toBe(100_000);
      expect(sls(db, SHOP)).toBe(0);
      expect(db.get("ledger_balances/platform:fees@SLS")!.balance).toBe(0);
    });
  });

  describe("charging a scanned customer code", () => {
    const scanned = {
      [`customerTokens/${TOKEN}`]: {
        customerId: CUSTOMER,
        status: "scanned",
        scannedBy: SHOP,
        scannedAt: Timestamp.fromMillis(Date.now() - 20_000),
        createdAt: Timestamp.fromMillis(Date.now() - 40_000),
        expiresAt: Timestamp.fromMillis(Date.now() + 80_000),
      },
    };
    const raise = (data: Record<string, unknown>) =>
      charge({ data: { tokenId: TOKEN, ...data }, auth: { uid: SHOP } });

    it("raises the charge in shillings, approved and paid in shillings", async () => {
      const db = seed(scanned);
      await raise({ amount: 20_000, currency: "SLS" });
      expect(db.get(`paymentRequests/${TOKEN}`)).toMatchObject({ amount: 20_000, currency: "SLS" });
      expect(enforcePerTransactionLimit).toHaveBeenCalledWith(20_000, expect.anything(), "SLS");
      const push = (sendPushNotification as jest.Mock).mock.calls[0];
      expect(push[1].params.amount).toBe("SLSH 20,000");

      await approve({ data: { requestId: TOKEN, pin: "123456", expectedAmount: 20_000 }, auth: { uid: CUSTOMER } });
      expect(sls(db, CUSTOMER)).toBe(80_000);
      expect(sls(db, SHOP)).toBe(19_800);
      expect(usd(db, CUSTOMER)).toBe(5_000);
      expect(enforceTransactionLimits).toHaveBeenCalledWith(CUSTOMER, 20_000, expect.anything(), undefined, "SLS");
    });

    it("pays out cash at the counter in shillings: shilling float in, shillings out", async () => {
      const db = seed({
        ...scanned,
        [`users/${SHOP}`]: { accountType: "agent_merchant", fullName: "Hodan Ali" },
        "config/rates": { slsPerUsd: 8_000, cashOutFeeRate: 0.01, cashOutCommissionRate: 0.01, roundTripWindowHours: 0 },
      });
      await raise({ amount: 20_000, currency: "SLS", purpose: "cash_out" });
      expect(db.get(`paymentRequests/${TOKEN}`)).toMatchObject({ amount: 20_000, currency: "SLS", feeCents: 200 });
      await approve({ data: { requestId: TOKEN, pin: "123456", expectedAmount: 20_000 }, auth: { uid: CUSTOMER } });
      // 20,000 handed over plus the 200 fee; the agent's float takes the 20,000.
      expect(sls(db, CUSTOMER)).toBe(79_800);
      expect(db.get(`ledger_balances/agent:${SHOP}@SLS`)!.balance).toBe(20_000);
      // The 200 commission to the agent's own wallet, in shillings.
      expect(sls(db, SHOP)).toBe(200);
      expect(usd(db, CUSTOMER)).toBe(5_000);
    });
  });

  describe("paying the shop's printed sticker", () => {
    const paySticker = (amount: number, currency: string) =>
      payMerchant({
        data: { merchantId: SHOP, amount, currency, pin: "123456", idempotencyKey: "6b2a6c1e-9b4d-4a77-8e21-0c5d7a9f1b33" },
        auth: { uid: CUSTOMER },
      });

    it("pays in shillings the customer chose, fee in shillings", async () => {
      const db = seed();
      const res = await paySticker(20_000, "SLSH");
      expect(sls(db, CUSTOMER)).toBe(80_000);
      expect(sls(db, SHOP)).toBe(19_800);
      expect(db.get("ledger_balances/platform:fees@SLS")!.balance).toBe(200);
      expect(usd(db, CUSTOMER)).toBe(5_000);
      expect(db.get(`transactions/${res.data.transactionId}`)).toMatchObject({ currency: "SLS", amount: 20_000 });
      expect(enforceTransactionLimits).toHaveBeenCalledWith(CUSTOMER, 20_000, expect.anything(), undefined, "SLS");
    });

    it("still pays dollars when the app says dollars", async () => {
      const db = seed();
      await paySticker(1_000, "USD");
      expect(usd(db, CUSTOMER)).toBe(4_000);
      expect(sls(db, CUSTOMER)).toBe(100_000);
    });
  });

  describe("the counter display", () => {
    it("shows a shilling sale as shillings", () => {
      const flash = flashForQr(
        { status: "active" } as any,
        { status: "used", amount: 30_000, paidAmount: 30_000, currency: "SLS", usedAt: Timestamp.now() } as any
      );
      expect(flash).toMatchObject({ kind: "paid", amountCents: 30_000, currency: "SLS" });
      expect(makeFlash("paid", 1_250, Date.now())).toMatchObject({ currency: "USD" });
    });
  });

  it("only dollars pass for an app that names no currencies", () => {
    expect(appReads("USD", undefined)).toBe(true);
    expect(appReads("SLS", undefined)).toBe(false);
    expect(appReads("SLS", ["USD"])).toBe(false);
    expect(appReads("SLS", READS_BOTH)).toBe(true);
  });
});
