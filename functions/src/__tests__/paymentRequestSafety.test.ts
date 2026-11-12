import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({
  verifyUserPin: jest.fn(),
}));
jest.mock("../utils/notifications", () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/velocity", () => ({
  enforceVelocity: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/limits", () => ({
  enforcePerTransactionLimit: jest.fn().mockResolvedValue(undefined),
  enforceTransactionLimits: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../ledger", () => ({
  ...jest.requireActual("../ledger"),
  prepareJournalEntry: jest.fn(),
}));

import { verifyUserPin } from "../auth/validatePin";
import { sendPushNotification } from "../utils/notifications";
import { enforceVelocity } from "../utils/velocity";
import { prepareJournalEntry } from "../ledger";

const mockedVerifyPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const mockedPush = sendPushNotification as jest.MockedFunction<typeof sendPushNotification>;
const mockedVelocity = enforceVelocity as jest.MockedFunction<typeof enforceVelocity>;
const mockedPrepare = prepareJournalEntry as jest.MockedFunction<typeof prepareJournalEntry>;

const MERCHANT = "merch-1";
const OTHER_MERCHANT = "merch-2";
const CUSTOMER = "cust-1";
const TOKEN = "tok123";

const { Timestamp } = admin.firestore;
const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
const inFuture = (ms: number) => Timestamp.fromMillis(Date.now() + ms);

/**
 * Firestore stand-in with transaction semantics that matter here: writes are
 * staged and only applied if the callback resolves, as in real Firestore, so
 * a test can tell a write that commits from one a throw rolls back.
 */
function fakeDb(seed: Record<string, any>) {
  const store = new Map<string, any>(Object.entries(seed));
  let auto = 0;
  const snap = (path: string) => ({
    exists: store.has(path),
    id: path.split("/")[1],
    data: () => store.get(path),
  });
  const ref = (col: string, id?: string) => {
    const docId = id ?? `auto-${++auto}`;
    const path = `${col}/${docId}`;
    return {
      id: docId,
      path,
      get: async () => snap(path),
      update: async (d: any) => store.set(path, { ...store.get(path), ...d }),
      set: async (d: any) => store.set(path, d),
    };
  };
  const query = (col: string, filters: Array<[string, any]>, max = Infinity) => ({
    where: (field: string, _op: string, value: any) =>
      query(col, [...filters, [field, value]], max),
    limit: (n: number) => query(col, filters, n),
    get: async () => {
      const docs = [...store.entries()]
        .filter(([p, d]) => p.startsWith(`${col}/`) && filters.every(([f, v]) => d?.[f] === v))
        .slice(0, max)
        .map(([p]) => snap(p));
      return { empty: docs.length === 0, docs };
    },
  });
  const db: any = {
    store,
    collection: (col: string) => ({
      doc: (id?: string) => ref(col, id),
      where: (field: string, op: string, value: any) => query(col, []).where(field, op, value),
    }),
    runTransaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
      const staged: Array<() => void> = [];
      const tx = {
        get: async (r: any) => snap(r.path),
        set: (r: any, d: any) => staged.push(() => store.set(r.path, d)),
        create: (r: any, d: any) =>
          staged.push(() => {
            if (store.has(r.path)) throw new Error(`ALREADY_EXISTS ${r.path}`);
            store.set(r.path, d);
          }),
        update: (r: any, d: any) =>
          staged.push(() => {
            if (!store.has(r.path)) throw new Error(`NOT_FOUND ${r.path}`);
            store.set(r.path, { ...store.get(r.path), ...d });
          }),
      };
      const result = await fn(tx);
      staged.forEach((write) => write());
      return result;
    }),
  };
  return db;
}

const users = {
  [`users/${MERCHANT}`]: { accountType: "merchant", fullName: "Hooyo Cafe" },
  [`users/${OTHER_MERCHANT}`]: { accountType: "merchant", fullName: "Other Shop" },
  [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina" },
};

const pendingRequest = (overrides: Record<string, unknown> = {}) => ({
  merchantId: MERCHANT,
  customerId: CUSTOMER,
  tokenId: TOKEN,
  amount: 5000,
  currency: "USD",
  status: "pending",
  createdAt: ago(10_000),
  expiresAt: inFuture(80_000),
  ...overrides,
});

describe("payment request safety", () => {
  let createCharge: any;
  let cancelCharge: any;
  let approveCharge: any;
  let declineCharge: any;
  let firestoreSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    createCharge = test.wrap(
      (await import("../customer-qr/createPaymentRequest")).createPaymentRequest
    );
    cancelCharge = test.wrap(
      (await import("../customer-qr/cancelPayment")).cancelPaymentRequest
    );
    approveCharge = test.wrap(
      (await import("../customer-qr/approvePayment")).approvePaymentRequest
    );
    declineCharge = test.wrap(
      (await import("../customer-qr/rejectPayment")).rejectPaymentRequest
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedVerifyPin.mockResolvedValue(true);
    mockedPrepare.mockResolvedValue({
      alreadyPosted: false,
      resultingBalances: new Map(),
      write: jest.fn(),
    } as any);
  });

  afterEach(() => {
    firestoreSpy?.mockRestore();
    firestoreSpy = undefined;
  });

  afterAll(() => test.cleanup());

  /** Point admin.firestore() at the fake, keeping the static helpers. */
  const useDb = (seed: Record<string, any>) => {
    const db = fakeDb({ ...users, ...seed });
    const { Timestamp: RealTimestamp, FieldValue } = admin.firestore;
    firestoreSpy = jest.spyOn(admin, "firestore").mockReturnValue(db);
    Object.assign(admin.firestore, { Timestamp: RealTimestamp, FieldValue });
    return db;
  };

  const scannedToken = (overrides: Record<string, unknown> = {}) => ({
    [`customerTokens/${TOKEN}`]: {
      customerId: CUSTOMER,
      status: "scanned",
      scannedBy: MERCHANT,
      scannedAt: ago(20_000),
      createdAt: ago(40_000),
      expiresAt: inFuture(80_000),
      ...overrides,
    },
  });

  const charge = (data: Record<string, unknown> = {}, uid = MERCHANT) =>
    createCharge({
      data: { tokenId: TOKEN, amount: 5000, currency: "USD", ...data },
      auth: { uid },
    });

  describe("raising a charge", () => {
    it("stores a 90-second window and uses up the scan", async () => {
      const db = useDb(scannedToken());

      const result = await charge();

      expect(result.data.requestId).toBe(TOKEN);
      expect(result.data.expiresInSeconds).toBe(90);
      const stored = db.store.get(`paymentRequests/${TOKEN}`);
      const window = stored.expiresAt.toMillis() - stored.createdAt.toMillis();
      expect(window).toBe(90_000);
      expect(db.store.get(`customerTokens/${TOKEN}`).status).toBe("used");
    });

    it("answers a repeat call with the same charge, not a second one", async () => {
      // A double tap, or a retry after the reply was lost. Failing here would
      // leave the first charge payable while the merchant saw an error.
      const db = useDb(scannedToken());

      const first = await charge();
      const second = await charge();

      expect(second.data.requestId).toBe(first.data.requestId);
      expect([...db.store.keys()].filter((k) => k.startsWith("paymentRequests/"))).toHaveLength(1);
      expect(mockedPush).toHaveBeenCalledTimes(1);
    });

    it("refuses a scan that is more than two minutes old", async () => {
      useDb(scannedToken({ scannedAt: ago(3 * 60_000) }));
      await expect(charge()).rejects.toThrow(/Scan the customer's code again/);
    });

    it("refuses a scan made by another merchant", async () => {
      useDb(scannedToken({ scannedBy: OTHER_MERCHANT }));
      await expect(charge()).rejects.toThrow(/different merchant/);
    });

    it("refuses a token ID that is really a path", async () => {
      useDb(scannedToken());
      await expect(charge({ tokenId: "customerTokens/x" })).rejects.toThrow(
        /Token ID is required/
      );
    });

    it("will not hand one merchant's charge to another", async () => {
      useDb({ [`paymentRequests/${TOKEN}`]: pendingRequest() });
      await expect(charge({}, OTHER_MERCHANT)).rejects.toThrow(/different merchant/);
    });
  });

  describe("cancelling", () => {
    const cancel = (uid = MERCHANT, requestId = TOKEN) =>
      cancelCharge({ data: { requestId }, auth: { uid } });

    it("withdraws a pending charge", async () => {
      const db = useDb({ [`paymentRequests/${TOKEN}`]: pendingRequest() });

      const result = await cancel();

      expect(result.data.status).toBe("cancelled");
      expect(db.store.get(`paymentRequests/${TOKEN}`).status).toBe("cancelled");
    });

    it("reports the payment when the customer approved first", async () => {
      // The race that matters: the merchant must see "paid", not a
      // cancellation that did not happen.
      const db = useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({ status: "approved" }),
      });

      const result = await cancel();

      expect(result.data.status).toBe("approved");
      expect(db.store.get(`paymentRequests/${TOKEN}`).status).toBe("approved");
    });

    it("records a lapsed charge as expired, not cancelled", async () => {
      const db = useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({ expiresAt: ago(1_000) }),
      });

      const result = await cancel();

      expect(result.data.status).toBe("expired");
      expect(db.store.get(`paymentRequests/${TOKEN}`).status).toBe("expired");
    });

    it("is harmless to repeat", async () => {
      useDb({ [`paymentRequests/${TOKEN}`]: pendingRequest({ status: "cancelled" }) });
      expect((await cancel()).data.status).toBe("cancelled");
    });

    it("refuses another merchant's charge", async () => {
      useDb({ [`paymentRequests/${TOKEN}`]: pendingRequest() });
      await expect(cancel(OTHER_MERCHANT)).rejects.toThrow(/different merchant/);
    });
  });

  describe("approving", () => {
    const approve = (data: Record<string, unknown> = {}, uid = CUSTOMER) =>
      approveCharge({
        data: { requestId: TOKEN, pin: "123456", ...data },
        auth: { uid },
      });

    it("records which transaction paid the charge", async () => {
      const db = useDb({ [`paymentRequests/${TOKEN}`]: pendingRequest() });

      const result = await approve({ expectedAmount: 5000 });

      const stored = db.store.get(`paymentRequests/${TOKEN}`);
      expect(stored.status).toBe("approved");
      expect(stored.transactionId).toBe(result.data.transactionId);
      expect(db.store.get(`transactions/${result.data.transactionId}`).journalEntryId).toBe(
        `custqr_${TOKEN}`
      );
    });

    it("refuses a charge the merchant cancelled", async () => {
      useDb({ [`paymentRequests/${TOKEN}`]: pendingRequest({ status: "cancelled" }) });
      await expect(approve()).rejects.toThrow(/already cancelled/);
      expect(mockedPrepare).not.toHaveBeenCalled();
    });

    it("refuses once the stored window has passed, and says so for good", async () => {
      // Raised 30s ago: inside the old five minutes, outside its own window.
      const db = useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({
          createdAt: ago(30_000),
          expiresAt: ago(1_000),
        }),
      });

      await expect(approve()).rejects.toThrow(/expired/);
      expect(mockedPrepare).not.toHaveBeenCalled();
      // Committed, not rolled back with the refusal.
      expect(db.store.get(`paymentRequests/${TOKEN}`).status).toBe("expired");
    });

    it("keeps the old five-minute window for requests raised before expiresAt", async () => {
      useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({
          createdAt: ago(2 * 60_000),
          expiresAt: undefined,
        }),
      });
      await expect(approve()).resolves.toMatchObject({ success: true });
    });

    it("refuses when the amount differs from what the customer was shown", async () => {
      useDb({ [`paymentRequests/${TOKEN}`]: pendingRequest() });
      await expect(approve({ expectedAmount: 4000 })).rejects.toThrow(/does not match/);
      expect(mockedPrepare).not.toHaveBeenCalled();
    });

    it("answers a retry with the original payment, before velocity can refuse it", async () => {
      const db = useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({
          status: "approved",
          transactionId: "tx-original",
        }),
      });

      const result = await approve();

      expect(result.success).toBe(true);
      expect(result.data.transactionId).toBe("tx-original");
      expect(mockedVelocity).not.toHaveBeenCalled();
      expect(db.runTransaction).not.toHaveBeenCalled();
    });

    it("finds the payment for approvals made before requests recorded it", async () => {
      useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({ status: "approved" }),
        "transactions/tx-legacy": { journalEntryId: `custqr_${TOKEN}` },
      });
      expect((await approve()).data.transactionId).toBe("tx-legacy");
    });

    it("does not hand someone else's receipt to a different customer", async () => {
      useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({
          status: "approved",
          customerId: "cust-2",
          transactionId: "tx-original",
        }),
      });
      await expect(approve()).rejects.toThrow(/not for you/);
    });

    it("still asks for the PIN before answering a retry", async () => {
      mockedVerifyPin.mockResolvedValue(false);
      useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({
          status: "approved",
          transactionId: "tx-original",
        }),
      });
      await expect(approve()).rejects.toThrow(/Invalid PIN/);
    });
  });

  describe("declining", () => {
    const decline = () =>
      declineCharge({ data: { requestId: TOKEN }, auth: { uid: CUSTOMER } });

    it("cannot overwrite a payment that already went through", async () => {
      const db = useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({ status: "approved" }),
      });

      await expect(decline()).rejects.toThrow(/already approved/);
      expect(db.store.get(`paymentRequests/${TOKEN}`).status).toBe("approved");
    });

    it("records a lapsed charge as expired", async () => {
      const db = useDb({
        [`paymentRequests/${TOKEN}`]: pendingRequest({ expiresAt: ago(1_000) }),
      });

      await expect(decline()).rejects.toThrow(/expired/);
      expect(db.store.get(`paymentRequests/${TOKEN}`).status).toBe("expired");
    });
  });
});
