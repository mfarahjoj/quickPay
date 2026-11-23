/**
 * Receipt numbers and the paid-invoice check, end to end through the real
 * callables against the Firestore emulator.
 *
 * Skipped by a plain `npm test`. Run with:
 *   firebase emulators:exec --only firestore --project demo-zapp \
 *     "npx jest receiptFlow.emulator"
 */
import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({
  verifyUserPin: jest.fn().mockResolvedValue(true),
}));
jest.mock("../utils/velocity", () => ({
  enforceVelocity: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/notifications", () => ({
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const run = emulator ? describe : describe.skip;

const RECEIPT = /^ZP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const CUSTOMER = { uid: "customer-1" };
const MERCHANT = { uid: "merchant-1" };

run("receipt numbers and paid invoices (emulator)", () => {
  let db: FirebaseFirestore.Firestore;
  let generateQRCode: any;
  let processPayment: any;
  let payMerchant: any;
  let refundPayment: any;
  let createPaymentRequest: any;
  let approvePaymentRequest: any;
  let adminSearchUsers: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-zapp" });
    db = admin.firestore();
    generateQRCode = test.wrap((await import("../qr-payments/generateQR")).generateQRCode);
    processPayment = test.wrap((await import("../qr-payments/processPayment")).processPayment);
    payMerchant = test.wrap((await import("../qr-payments/payMerchant")).payMerchant);
    refundPayment = test.wrap((await import("../qr-payments/refundPayment")).refundPayment);
    createPaymentRequest = test.wrap(
      (await import("../customer-qr/createPaymentRequest")).createPaymentRequest
    );
    approvePaymentRequest = test.wrap(
      (await import("../customer-qr/approvePayment")).approvePaymentRequest
    );
    adminSearchUsers = test.wrap((await import("../admin/lookupUser")).adminSearchUsers);
  });

  beforeEach(async () => {
    const project = admin.app().options.projectId;
    await fetch(`http://${emulator}/emulator/v1/projects/${project}/databases/(default)/documents`, {
      method: "DELETE",
    });
    const now = admin.firestore.Timestamp.now();
    await Promise.all([
      db.doc("users/customer-1").set({ accountType: "customer", fullName: "Ahmed Ali", kycLevel: 1 }),
      db.doc("users/merchant-1").set({ accountType: "merchant", fullName: "Kofia Owner" }),
      db.doc("merchantProfiles/merchant-1").set({ businessName: "Kofia Cafe" }),
      db.doc("wallets/customer-1").set({ userId: "customer-1", balance: 10_000, currency: "USD", updatedAt: now }),
      db.doc("wallets/merchant-1").set({ userId: "merchant-1", balance: 0, currency: "USD", updatedAt: now }),
    ]);
  });

  afterAll(() => test.cleanup());

  const showCode = (data: Record<string, unknown>) =>
    generateQRCode({ data: { amount: 256, currency: "USD", ...data }, auth: MERCHANT });

  const pay = async (reference?: string) => {
    const qr = await showCode(reference ? { reference, checkPaidReference: true } : {});
    return processPayment({ data: { qrCodeId: qr.data.qrCodeId, pin: "123456" }, auth: CUSTOMER });
  };

  it("gives a QR payment one receipt number, everywhere it's recorded", async () => {
    const qr = await showCode({ reference: "Invoice No 37841" });
    const result = await processPayment({
      data: { qrCodeId: qr.data.qrCodeId, pin: "123456" },
      auth: CUSTOMER,
    });
    const n = result.data.receiptNumber;
    expect(n).toMatch(RECEIPT);

    const tx = (await db.doc(`transactions/${result.data.transactionId}`).get()).data()!;
    expect(tx.receiptNumber).toBe(n);
    // The merchant's Receive screen reads it from here.
    expect((await db.doc(`qrCodes/${qr.data.qrCodeId}`).get()).data()!.receiptNumber).toBe(n);
    // The ledger entry carries it.
    expect((await db.doc(`journal_entries/${tx.journalEntryId}`).get()).data()!.refs.receiptNumber).toBe(n);
    // And it looks the transaction up.
    expect((await db.doc(`receiptNumbers/${n}`).get()).data()).toMatchObject({
      transactionId: result.data.transactionId,
      type: "payment",
      participants: ["customer-1", "merchant-1"],
      amount: 256,
    });
  });

  it("warns before charging an invoice that's already been paid, however it's typed", async () => {
    const first = await pay("Invoice No 37841");

    const err = await showCode({ reference: "INVOICE NO.: 37841", checkPaidReference: true }).catch(
      (e: any) => e
    );
    expect(err.code).toBe("already-exists");
    expect(err.details.priorPayment).toMatchObject({
      reference: "Invoice No 37841",
      receiptNumber: first.data.receiptNumber,
      amount: 256,
      paidByName: "Ahmed Ali",
      count: 1,
    });
    // No code was issued for the refused attempt.
    expect((await db.collection("qrCodes").where("status", "==", "active").get()).size).toBe(0);
  });

  it("charges again once the merchant confirms, and counts the repeat", async () => {
    await pay("Invoice No 37841");
    const qr = await showCode({
      reference: "Invoice No 37841",
      checkPaidReference: true,
      confirmPaidReference: true,
    });
    await processPayment({ data: { qrCodeId: qr.data.qrCodeId, pin: "123456" }, auth: CUSTOMER });

    const err = await showCode({ reference: "37841", checkPaidReference: true }).catch((e: any) => e);
    expect(err.details.priorPayment.count).toBe(2);
  });

  it("doesn't check unless the app asks — older apps and table numbers carry on as before", async () => {
    await pay("Table 4");
    await expect(showCode({ reference: "Table 4" })).resolves.toMatchObject({ success: true });
  });

  it("lets a refunded invoice be charged again, and numbers the refund", async () => {
    const first = await pay("Invoice No 37841");
    const refund = await refundPayment({
      data: { transactionId: first.data.transactionId, pin: "123456" },
      auth: MERCHANT,
    });
    expect(refund.data.receiptNumber).toMatch(RECEIPT);
    expect(refund.data.receiptNumber).not.toBe(first.data.receiptNumber);
    const refundTx = (await db.doc(`transactions/${refund.data.refundTransactionId}`).get()).data()!;
    expect(refundTx.receiptNumber).toBe(refund.data.receiptNumber);

    await expect(
      showCode({ reference: "Invoice No 37841", checkPaidReference: true })
    ).resolves.toMatchObject({ success: true });
  });

  it("numbers a counter-code (sticker) payment", async () => {
    const result = await payMerchant({
      data: { merchantId: "merchant-1", amount: 500, currency: "USD", pin: "123456" },
      auth: CUSTOMER,
    });
    expect(result.data.receiptNumber).toMatch(RECEIPT);
    const tx = (await db.doc(`transactions/${result.data.transactionId}`).get()).data()!;
    expect(tx.receiptNumber).toBe(result.data.receiptNumber);
  });

  it("numbers a charge the customer approves, and checks its invoice too", async () => {
    await db.doc("customerTokens/token-1").set({
      customerId: "customer-1",
      status: "scanned",
      scannedBy: "merchant-1",
      scannedAt: admin.firestore.Timestamp.now(),
    });
    const req = await createPaymentRequest({
      data: {
        tokenId: "token-1",
        amount: 256,
        currency: "USD",
        reference: "Invoice No 555",
        checkPaidReference: true,
      },
      auth: MERCHANT,
    });
    const approved = await approvePaymentRequest({
      data: { requestId: req.data.requestId, pin: "123456" },
      auth: CUSTOMER,
    });
    expect(approved.data.receiptNumber).toMatch(RECEIPT);
    // The merchant's Charge screen reads it from the request doc.
    expect((await db.doc(`paymentRequests/${req.data.requestId}`).get()).data()).toMatchObject({
      status: "approved",
      receiptNumber: approved.data.receiptNumber,
    });

    await db.doc("customerTokens/token-2").set({
      customerId: "customer-1",
      status: "scanned",
      scannedBy: "merchant-1",
      scannedAt: admin.firestore.Timestamp.now(),
    });
    const err = await createPaymentRequest({
      data: {
        tokenId: "token-2",
        amount: 256,
        currency: "USD",
        reference: "555",
        checkPaidReference: true,
      },
      auth: MERCHANT,
    }).catch((e: any) => e);
    expect(err.code).toBe("already-exists");
    // The token is left as it was, so the merchant can confirm and carry on.
    expect((await db.doc("customerTokens/token-2").get()).data()!.status).toBe("scanned");
  });

  it("numbers every partial refund, and a retried one gets the number it already had", async () => {
    const first = await pay("Invoice No 37841");
    const txId = first.data.transactionId;
    const refund = (amountCents: number, idempotencyKey: string) =>
      refundPayment({ data: { transactionId: txId, pin: "123456", amountCents, idempotencyKey }, auth: MERCHANT });

    const a = await refund(100, "partial-refund-key-1");
    const b = await refund(50, "partial-refund-key-2");
    const aAgain = await refund(100, "partial-refund-key-1");

    expect(a.data.receiptNumber).toMatch(RECEIPT);
    expect(b.data.receiptNumber).toMatch(RECEIPT);
    expect(new Set([first.data.receiptNumber, a.data.receiptNumber, b.data.receiptNumber]).size).toBe(3);
    // The retry is the same refund: same row, same number, nothing new reserved.
    expect(aAgain.data.refundTransactionId).toBe(a.data.refundTransactionId);
    expect(aAgain.data.receiptNumber).toBe(a.data.receiptNumber);
    expect((await db.collection("receiptNumbers").get()).size).toBe(3);

    // Part-refunded, the invoice is still mostly paid: still warned about.
    const err = await showCode({ reference: "Invoice No 37841", checkPaidReference: true }).catch((e: any) => e);
    expect(err.code).toBe("already-exists");
  });

  it("returns the same receipt number when an approval is retried after a lost reply", async () => {
    await db.doc("customerTokens/token-1").set({
      customerId: "customer-1",
      status: "scanned",
      scannedBy: "merchant-1",
      scannedAt: admin.firestore.Timestamp.now(),
    });
    const req = await createPaymentRequest({
      data: { tokenId: "token-1", amount: 256, currency: "USD", reference: "Invoice No 777", checkPaidReference: true },
      auth: MERCHANT,
    });
    const approve = () =>
      approvePaymentRequest({ data: { requestId: req.data.requestId, pin: "123456" }, auth: CUSTOMER });
    const first = await approve();
    const retry = await approve();
    expect(retry.data.transactionId).toBe(first.data.transactionId);
    expect(retry.data.receiptNumber).toBe(first.data.receiptNumber);
    expect((await db.collection("receiptNumbers").get()).size).toBe(1);

    // The merchant retrying the same scan finds the charge it raised — it is
    // not warned about the payment its own first attempt produced.
    const again = await createPaymentRequest({
      data: { tokenId: "token-1", amount: 256, currency: "USD", reference: "Invoice No 777", checkPaidReference: true },
      auth: MERCHANT,
    });
    expect(again.data.requestId).toBe(req.data.requestId);
  });

  it("numbers an agent cash-out but never records it as a paid invoice", async () => {
    const now = admin.firestore.Timestamp.now();
    await Promise.all([
      db.doc("users/agent-1").set({ accountType: "topup_agent", fullName: "Agent One" }),
      db.doc("wallets/agent-1").set({ userId: "agent-1", balance: 0, currency: "USD", updatedAt: now }),
      db.doc("customerTokens/token-co").set({
        customerId: "customer-1",
        status: "scanned",
        scannedBy: "agent-1",
        scannedAt: now,
      }),
    ]);
    const req = await createPaymentRequest({
      data: { tokenId: "token-co", amount: 1000, currency: "USD", purpose: "cash_out", reference: "Invoice No 999" },
      auth: { uid: "agent-1" },
    });
    const approved = await approvePaymentRequest({
      data: { requestId: req.data.requestId, pin: "123456" },
      auth: CUSTOMER,
    });
    expect(approved.data.receiptNumber).toMatch(RECEIPT);

    const tx = (await db.doc(`transactions/${approved.data.transactionId}`).get()).data()!;
    expect(tx).toMatchObject({ type: "withdrawal", kind: "cash_out", receiptNumber: approved.data.receiptNumber });
    expect((await db.doc(`receiptNumbers/${approved.data.receiptNumber}`).get()).data()).toMatchObject({
      type: "withdrawal",
    });
    // A cash-out has no invoice to be paid twice.
    expect((await db.collection("paidReferences").get()).size).toBe(0);
  });

  it("lets support find both sides of a payment from its receipt number", async () => {
    const paid = await pay("Invoice No 37841");
    const spoken = paid.data.receiptNumber.toLowerCase().replace(/-/g, " ");
    const found = await adminSearchUsers({
      data: { query: spoken },
      auth: { uid: "ops-1", token: { admin: true, adminRoles: ["ops"] } },
    });
    expect(found.data.map((u: any) => u.userId).sort()).toEqual(["customer-1", "merchant-1"]);
  });

  it("never hands out the same number twice", async () => {
    const numbers = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const r = await payMerchant({
        data: { merchantId: "merchant-1", amount: 10, currency: "USD", pin: "123456" },
        auth: CUSTOMER,
      });
      numbers.add(r.data.receiptNumber);
    }
    expect(numbers.size).toBe(25);
    expect((await db.collection("receiptNumbers").get()).size).toBe(25);
  });
});
