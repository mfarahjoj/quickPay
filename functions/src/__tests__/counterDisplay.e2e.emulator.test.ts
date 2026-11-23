/**
 * The phone side of a counter display check (COUNTER_DISPLAY_PLAN.md 13):
 * a merchant and a customer acting through the real callables, against the
 * emulators, while the display site runs in a browser.
 *
 * One step per run, chosen by E2E_STEP, so a person (or Claude) can look at
 * the tablet between steps. Ids carry over in `_e2e/state`.
 *
 *   firebase emulators:start --only firestore,functions --project demo-zapp
 *   cd display && npm run dev -- --mode emulator
 *   export $(cat functions/.secret.local) FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-zapp
 *   E2E_STEP=seed  npx jest counterDisplay.e2e        # fresh shop + customer
 *   E2E_STEP=link  E2E_CODE=12345678 npx jest …       # claim the code on the tablet
 *   E2E_STEP=sale  [E2E_AMOUNT=1250 E2E_REF="Table 4"]
 *   E2E_STEP=pay                                      # customer pays the sale QR
 *   E2E_STEP=token                                    # prints a customer code to scan
 *   E2E_STEP=approve | decline                        # customer answers the request
 *   E2E_STEP=cancel                                   # cashier cancels the sale
 *   E2E_STEP=unlink                                   # merchant unlinks the tablet
 *
 * Skipped by a plain `npm test`.
 */
import * as admin from "firebase-admin";

// Before firebase-functions-test, which otherwise sets its own GCLOUD_PROJECT.
const PROJECT = process.env.GCLOUD_PROJECT || "demo-zapp";
const test = require("firebase-functions-test")({ projectId: PROJECT });

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn().mockResolvedValue(true) }));
jest.mock("../utils/velocity", () => ({ enforceVelocity: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/notifications", () => ({
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

const step = process.env.E2E_STEP;
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const run = emulator && step ? describe : describe.skip;

const CUSTOMER = { uid: "e2e-customer" };
const MERCHANT = { uid: "e2e-merchant" };

run(`counter display e2e: ${step}`, () => {
  let db: FirebaseFirestore.Firestore;
  const stateRef = () => db.doc("_e2e/state");
  const remember = (data: Record<string, unknown>) => stateRef().set(data, { merge: true });
  const recall = async () => (await stateRef().get()).data() ?? {};

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
    db = admin.firestore();
  });
  afterAll(() => test.cleanup());

  it("runs", async () => {
    const wrap = async (path: string, name: string) => test.wrap((await import(path))[name]);
    const out = (o: unknown) => process.stdout.write(`\nE2E ${step}: ${JSON.stringify(o)}\n`);

    switch (step) {
      case "seed": {
        const project = admin.app().options.projectId;
        await fetch(`http://${emulator}/emulator/v1/projects/${project}/databases/(default)/documents`, {
          method: "DELETE",
        });
        const now = admin.firestore.Timestamp.now();
        await Promise.all([
          db.doc(`users/${CUSTOMER.uid}`).set({ accountType: "customer", fullName: "Amina Yusuf", kycLevel: 1 }),
          db.doc(`users/${MERCHANT.uid}`).set({
            accountType: "merchant",
            fullName: "Hodan Ali",
            preferredLanguage: process.env.E2E_LANG || "en",
          }),
          db.doc(`merchantProfiles/${MERCHANT.uid}`).set({ businessName: "Hodan's Shop" }),
          db.doc(`wallets/${CUSTOMER.uid}`).set({ userId: CUSTOMER.uid, balance: 100_000, currency: "USD", updatedAt: now }),
          db.doc(`wallets/${MERCHANT.uid}`).set({ userId: MERCHANT.uid, balance: 0, currency: "USD", updatedAt: now }),
        ]);
        out({ seeded: true });
        break;
      }
      case "link": {
        const link = await wrap("../counterDisplay/pairing", "linkDisplay");
        const res = await link({ data: { code: process.env.E2E_CODE, name: "Counter 1", pin: "123456" }, auth: MERCHANT });
        await remember({ displayId: res.data.displayId });
        out(res.data);
        break;
      }
      case "sale": {
        const gen = await wrap("../qr-payments/generateQR", "generateQRCode");
        const amount = Number(process.env.E2E_AMOUNT || 1250);
        const res = await gen({
          data: { amount, currency: "USD", ...(process.env.E2E_REF ? { reference: process.env.E2E_REF } : {}) },
          auth: MERCHANT,
        });
        await remember({ saleId: res.data.qrCodeId });
        out({ saleId: res.data.qrCodeId, amount });
        break;
      }
      case "pay": {
        const pay = await wrap("../qr-payments/processPayment", "processPayment");
        const { saleId } = await recall();
        const res = await pay({ data: { qrCodeId: saleId, pin: "123456" }, auth: CUSTOMER });
        out({ receiptNumber: res.data.receiptNumber });
        break;
      }
      case "token": {
        const gen = await wrap("../customer-qr/generateToken", "generateCustomerToken");
        const res = await gen({ data: {}, auth: CUSTOMER });
        out({ tokenData: res.data.tokenData });
        break;
      }
      case "approve":
      case "decline": {
        const pending = await db
          .collection("paymentRequests")
          .where("merchantId", "==", MERCHANT.uid)
          .where("status", "==", "pending")
          .get();
        const req = pending.docs.sort((a, b) => b.get("createdAt").toMillis() - a.get("createdAt").toMillis())[0];
        if (!req) throw new Error("No pending request");
        if (step === "approve") {
          const approve = await wrap("../customer-qr/approvePayment", "approvePaymentRequest");
          const res = await approve({ data: { requestId: req.id, pin: "123456" }, auth: CUSTOMER });
          out({ requestId: req.id, receiptNumber: res.data?.receiptNumber });
        } else {
          const reject = await wrap("../customer-qr/rejectPayment", "rejectPaymentRequest");
          await reject({ data: { requestId: req.id }, auth: CUSTOMER });
          out({ requestId: req.id, declined: true });
        }
        break;
      }
      case "cancel": {
        const cancel = await wrap("../qr-payments/cancelQR", "cancelQRCode");
        const { saleId } = await recall();
        await cancel({ data: { qrCodeId: saleId }, auth: MERCHANT });
        out({ cancelled: saleId });
        break;
      }
      case "unlink": {
        const unlink = await wrap("../counterDisplay/manage", "unlinkDisplay");
        const { displayId } = await recall();
        await unlink({ data: { displayId }, auth: MERCHANT });
        out({ unlinked: displayId });
        break;
      }
      default:
        throw new Error(`Unknown E2E_STEP ${step}`);
    }
  });
});
