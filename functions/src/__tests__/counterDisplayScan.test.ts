import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

// So a QR payment gets as far as the QR itself, the one check this race is about.
jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn().mockResolvedValue(true) }));
jest.mock("../utils/velocity", () => ({ enforceVelocity: jest.fn().mockResolvedValue(undefined) }));

import { sendPushNotification } from "../utils/notifications";
import { encrypt } from "../utils/encryption";
import { sha256 } from "../counterDisplay/guard";

const { Timestamp } = admin.firestore;
const SHOP = "merchant-1";
const CUSTOMER = "cust-1";
const DISPLAY_ID = `cd_${"0".repeat(24)}`;
const SECRET = "d".repeat(64);
const STATE_KEY = "a".repeat(64);
const SALE_ID = "1".repeat(32);
const TOKEN_ID = "tok1";

/**
 * A customer holds their Zapp code to the counter tablet's scanner. The
 * tablet names the sale it is showing and nothing else: the amount and note
 * come from the sale the cashier opened, the sale's QR is voided in the same
 * transaction that raises the request, and the customer still approves on
 * their own phone with their PIN.
 */
describe("counter display: scanning a customer", () => {
  let scan: any;
  let restore: (() => void) | undefined;
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    scan = test.wrap((await import("../counterDisplay/scan")).displayScanCustomer);
  });

  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalKey;
    test.cleanup();
  });

  const sale = (over: Record<string, any> = {}) => ({
    merchantId: SHOP,
    amount: 1250,
    currency: "USD",
    status: "active",
    reference: "INV-7",
    emvQrData: "00020101021226…",
    createdAt: Timestamp.fromMillis(Date.now() - 1000),
    expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
    ...over,
  });

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali", kycStatus: "verified" },
      [`merchantProfiles/${SHOP}`]: { businessName: "Hodan's Shop" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina Yusuf", kycStatus: "verified" },
      [`merchantDisplays/${DISPLAY_ID}`]: {
        merchantId: SHOP,
        name: "Front counter",
        status: "active",
        secretSha256: sha256(SECRET),
        stateKey: STATE_KEY,
        pairingId: "dp_x",
      },
      [`qrCodes/${SALE_ID}`]: sale(),
      [`customerTokens/${TOKEN_ID}`]: {
        customerId: CUSTOMER,
        status: "active",
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 120_000),
      },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const code = (id = TOKEN_ID, customerId = CUSTOMER) =>
    encrypt(JSON.stringify({ id, customerId, expiresAt: new Date(Date.now() + 120_000).toISOString(), nonce: "n" }));

  const call = (over: Record<string, any> = {}) =>
    scan({ data: { displayId: DISPLAY_ID, secret: SECRET, saleId: SALE_ID, tokenData: code(), ...over } });

  it("raises a request for the cashier's sale, at the cashier's amount, and voids the QR", async () => {
    const db = seed();
    const res = (await call({ amount: 1, amountCents: 1 })).data;
    expect(res).toMatchObject({ requestId: TOKEN_ID, amountCents: 1250, customerFirstName: "Amina" });

    expect(db.get(`paymentRequests/${TOKEN_ID}`)).toMatchObject({
      merchantId: SHOP,
      customerId: CUSTOMER,
      tokenId: TOKEN_ID,
      amount: 1250,
      currency: "USD",
      reference: "INV-7",
      status: "pending",
      source: "counter_display",
      displayId: DISPLAY_ID,
      saleId: SALE_ID,
    });
    expect(db.get(`qrCodes/${SALE_ID}`)).toMatchObject({ status: "expired", supersededBy: TOKEN_ID });
    expect(db.get(`customerTokens/${TOKEN_ID}`)).toMatchObject({
      status: "used",
      scannedBy: SHOP,
      scannedVia: "counter_display",
    });
    expect(sendPushNotification).toHaveBeenCalledWith(
      CUSTOMER,
      expect.objectContaining({ key: "payment.request_with_reference" }),
      expect.objectContaining({ type: "payment_request", requestId: TOKEN_ID, amount: "1250" })
    );
    // The counter now asks the customer to approve on their phone.
    expect(db.get(`counterDisplayStates/${STATE_KEY}`)).toMatchObject({
      mode: "approving",
      request: { id: TOKEN_ID, amountCents: 1250, customerFirstName: "Amina" },
    });
  });

  it("answers a double read with the same request, and pushes once", async () => {
    const db = seed();
    await call();
    const again = (await call()).data;
    expect(again.requestId).toBe(TOKEN_ID);
    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect([...db.store.keys()].filter((k) => k.startsWith("paymentRequests/"))).toHaveLength(1);
  });

  it("reads codes a scanner mangled through the keyboard layout", async () => {
    seed();
    const mangled = code().toUpperCase().replace(/:/g, ";") + "\r\n";
    const res = (await call({ tokenData: mangled })).data;
    expect(res.requestId).toBe(TOKEN_ID);
  });

  it("can't then be paid by the QR as well: the QR is no longer active", async () => {
    // processPayment pays a QR only while its doc is `active`, read inside its
    // own transaction (qr-payments/processPayment.ts). The full race through
    // both callables needs the Firestore emulator (aggregate queries in the
    // limit check); see COUNTER_DISPLAY_PLAN.md section 11.
    const db = seed();
    await call();
    expect(db.get(`qrCodes/${SALE_ID}`)!.status).toBe("expired");
    expect([...db.store.keys()].filter((k) => k.startsWith("journal_entries/"))).toHaveLength(0);
  });

  it("refuses when no sale is open", async () => {
    seed({ [`qrCodes/${SALE_ID}`]: undefined as any });
    await expect(call({ saleId: "2".repeat(32) })).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "no_active_sale" },
    });
  });

  it("refuses a sale that's already paid, or ran out, and leaves the customer's code usable", async () => {
    const db = seed({ [`qrCodes/${SALE_ID}`]: sale({ status: "used" }) });
    await expect(call()).rejects.toMatchObject({ details: { reason: "already_paid" } });
    expect(db.get(`customerTokens/${TOKEN_ID}`)!.status).toBe("active");

    db.store.set(`qrCodes/${SALE_ID}`, sale({ expiresAt: Timestamp.fromMillis(Date.now() - 1) }));
    await expect(call()).rejects.toMatchObject({ details: { reason: "no_active_sale" } });
    expect(db.get(`customerTokens/${TOKEN_ID}`)!.status).toBe("active");
  });

  it("refuses another shop's sale", async () => {
    seed({ [`qrCodes/${SALE_ID}`]: sale({ merchantId: "someone-else" }) });
    await expect(call()).rejects.toMatchObject({ details: { reason: "no_active_sale" } });
  });

  it("refuses an expired or used customer code", async () => {
    const db = seed({
      [`customerTokens/${TOKEN_ID}`]: {
        customerId: CUSTOMER,
        status: "active",
        expiresAt: Timestamp.fromMillis(Date.now() - 1),
      },
    });
    await expect(call()).rejects.toMatchObject({ details: { reason: "token_expired" } });
    db.store.set(`customerTokens/${TOKEN_ID}`, { customerId: CUSTOMER, status: "used", expiresAt: Timestamp.fromMillis(Date.now() + 60_000) });
    await expect(call()).rejects.toMatchObject({ details: { reason: "token_used" } });
    expect(db.get(`qrCodes/${SALE_ID}`)!.status).toBe("active");
  });

  it("refuses something that isn't a Zapp code", async () => {
    seed();
    await expect(call({ tokenData: '{"type":"quickpay_merchant"}' })).rejects.toMatchObject({
      code: "invalid-argument",
      details: { reason: "not_a_zapp_code" },
    });
    await expect(call({ tokenData: "v2:" + "0".repeat(24) + ":" + "0".repeat(32) + ":00ff" })).rejects.toMatchObject({
      details: { reason: "not_a_zapp_code" },
    });
  });

  it("refuses the shop's own code", async () => {
    seed();
    await expect(call({ tokenData: code(TOKEN_ID, SHOP) })).rejects.toMatchObject({ details: { reason: "own_code" } });
  });

  it("holds to the customer's per-payment limit", async () => {
    seed({ [`qrCodes/${SALE_ID}`]: sale({ amount: 100_000_000 }) });
    await expect(call()).rejects.toBeDefined();
  });

  it("refuses an unlinked display, or a wrong secret", async () => {
    const db = seed();
    await expect(call({ secret: "e".repeat(64) })).rejects.toMatchObject({ details: { reason: "display_revoked" } });
    db.store.set(`merchantDisplays/${DISPLAY_ID}`, { ...db.get(`merchantDisplays/${DISPLAY_ID}`)!, status: "revoked" });
    await expect(call()).rejects.toMatchObject({ details: { reason: "display_revoked" } });
    expect(db.get(`qrCodes/${SALE_ID}`)!.status).toBe("active");
  });
});
