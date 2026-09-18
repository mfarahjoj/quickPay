import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({
  verifyUserPin: jest.fn(),
}));
jest.mock("../utils/notifications", () => ({
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/velocity", () => ({
  enforceVelocity: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";

const mockedVerifyPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const mockedVelocity = enforceVelocity as jest.MockedFunction<typeof enforceVelocity>;

const CUSTOMER = "cust-1";
const MERCHANT = "merch-1";
const KEY = "3f2a6c1e-9b4d-4a77-8e21-0c5d7a9f1b33";
const ENTRY_ID = `paymerchant_${CUSTOMER}_${KEY}`;
const POSTED_TX_ID = "tx-posted-1";

/**
 * Minimal Firestore stand-in covering the documents the replay path reads.
 * Anything it is not given comes back missing, so a test that strays off the
 * replay path fails loudly instead of quietly passing.
 */
function fakeDb(docs: Record<string, any>) {
  const runTransaction = jest.fn();
  const db: any = {
    runTransaction,
    collection(name: string) {
      return {
        doc(id?: string) {
          const path = `${name}/${id}`;
          return {
            id: id ?? "generated-id",
            get: async () => ({
              exists: path in docs,
              data: () => docs[path],
            }),
          };
        },
      };
    },
  };
  return db;
}

describe("payMerchant idempotency", () => {
  let wrapped: any;
  let firestoreSpy: jest.SpyInstance;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../qr-payments/payMerchant");
    wrapped = test.wrap(mod.payMerchant);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedVerifyPin.mockResolvedValue(true);
  });

  afterEach(() => {
    firestoreSpy?.mockRestore();
  });

  afterAll(() => {
    test.cleanup();
  });

  const call = (data: Record<string, unknown> = {}) =>
    wrapped({
      data: {
        merchantId: MERCHANT,
        amount: 5000,
        currency: "USD",
        pin: "123456",
        idempotencyKey: KEY,
        ...data,
      },
      auth: { uid: CUSTOMER },
    });

  it("returns the original payment instead of charging again", async () => {
    const db = fakeDb({
      [`journal_entries/${ENTRY_ID}`]: {
        type: "qr_payment",
        refs: { transactionId: POSTED_TX_ID },
      },
      [`transactions/${POSTED_TX_ID}`]: {
        type: "payment",
        fromUserId: CUSTOMER,
        toUserId: MERCHANT,
        amount: 5000,
        status: "completed",
      },
    });
    firestoreSpy = jest.spyOn(admin, "firestore").mockReturnValue(db);

    const result = await call();

    expect(result.success).toBe(true);
    expect(result.data.transactionId).toBe(POSTED_TX_ID);
    expect(result.data.amount).toBe(5000);
    // The whole point: no second posting.
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it("answers the retry before limits or velocity can reject it", async () => {
    // A customer who has just spent up to their daily cap and retries must get
    // their receipt, not "daily limit exceeded" for money already spent.
    const db = fakeDb({
      [`journal_entries/${ENTRY_ID}`]: {
        refs: { transactionId: POSTED_TX_ID },
      },
      [`transactions/${POSTED_TX_ID}`]: {
        toUserId: MERCHANT,
        amount: 5000,
      },
    });
    firestoreSpy = jest.spyOn(admin, "firestore").mockReturnValue(db);

    await call();

    expect(mockedVelocity).not.toHaveBeenCalled();
  });

  it("treats a key from another customer as unposted", async () => {
    // The stored entry belongs to cust-2, so cust-1 sending the same key must
    // not be handed cust-2's transaction. No entry exists under cust-1's
    // scoped ID, so the call proceeds to post (and fails on this bare stub).
    const db = fakeDb({
      [`journal_entries/paymerchant_cust-2_${KEY}`]: {
        refs: { transactionId: POSTED_TX_ID },
      },
      [`transactions/${POSTED_TX_ID}`]: { toUserId: MERCHANT, amount: 5000 },
    });
    firestoreSpy = jest.spyOn(admin, "firestore").mockReturnValue(db);

    await expect(call()).rejects.toThrow();
    expect(mockedVelocity).toHaveBeenCalled();
  });

  it("still works for clients that send no key", async () => {
    // Older builds: no replay lookup, straight through to the normal path.
    const db = fakeDb({});
    firestoreSpy = jest.spyOn(admin, "firestore").mockReturnValue(db);

    await expect(call({ idempotencyKey: undefined })).rejects.toThrow();
    expect(mockedVelocity).toHaveBeenCalled();
  });
});
