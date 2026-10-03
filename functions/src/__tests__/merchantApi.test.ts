import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

jest.mock("../utils/notifications", () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { sendPushNotification, notifyUser } from "../utils/notifications";
import { handleApiRequest } from "../api/app";
import { generateApiKey, hashApiKey, apiKeyHint } from "../api/keys";
import { cumulativeFeeReturned } from "../api/refunds";
import { expireLapsedCharges } from "../api/expireCharges";

const mockedPush = sendPushNotification as jest.MockedFunction<typeof sendPushNotification>;
const mockedNotify = notifyUser as jest.MockedFunction<typeof notifyUser>;

const { Timestamp } = admin.firestore;
const MERCHANT = "merch-1";
const OTHER_MERCHANT = "merch-2";
const CUSTOMER = "cust-1";
const KEY = generateApiKey();
const OTHER_KEY = generateApiKey();

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  json: any;
}

async function request(
  method: string,
  path: string,
  opts: { key?: string | null; body?: unknown; idem?: string; query?: Record<string, string> } = {}
): Promise<FakeRes> {
  const headers: Record<string, string> = {};
  const key = opts.key === undefined ? KEY : opts.key;
  if (key) headers.authorization = `Bearer ${key}`;
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  const req: any = { method, path, headers, body: opts.body ?? {}, query: opts.query ?? {} };
  const out: FakeRes = { statusCode: 200, headers: {}, json: undefined };
  const res: any = {
    status(n: number) { out.statusCode = n; return res; },
    set(k: string, v: string) { out.headers[k.toLowerCase()] = v; return res; },
    send(s: string) { out.json = JSON.parse(s); return res; },
  };
  await handleApiRequest(req, res);
  return out;
}

describe("Merchant Payments API", () => {
  let db: FakeDb;
  let restore: () => void;
  let logSpy: jest.SpyInstance;

  const keyDoc = (merchantId: string, key: string, extra: Record<string, unknown> = {}) => ({
    [`merchant_api_keys/${hashApiKey(key)}`]: {
      merchantId,
      label: "Website",
      hint: apiKeyHint(key),
      revoked: false,
      createdAt: Timestamp.now(),
      createdBy: "admin-1",
      lastUsedAt: Timestamp.now(),
      ...extra,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    db = fakeFirestore({
      [`users/${MERCHANT}`]: { accountType: "merchant", fullName: "Hooyo", accountStatus: "active" },
      [`merchantProfiles/${MERCHANT}`]: { businessName: "Hooyo Cafe" },
      [`users/${OTHER_MERCHANT}`]: { accountType: "merchant", fullName: "Other", accountStatus: "active" },
      [`users/${CUSTOMER}`]: {
        accountType: "customer",
        fullName: "Amina",
        phoneNumber: "+252634000001",
        accountStatus: "active",
      },
      ...keyDoc(MERCHANT, KEY),
      ...keyDoc(OTHER_MERCHANT, OTHER_KEY),
    });
    restore = useFakeFirestore(db);
  });

  afterEach(() => {
    restore();
    logSpy.mockRestore();
  });

  const createCharge = (body: Record<string, unknown> = {}, idem = "order-1001-attempt", key?: string) =>
    request("POST", "/v1/charges", { body: { amount: 1250, reference: "Order 1001", ...body }, idem, key });

  describe("authentication", () => {
    it("requires a key", async () => {
      const res = await request("GET", "/v1/charges", { key: null });
      expect(res.statusCode).toBe(401);
      expect(res.json.error.code).toBe("missing_api_key");
    });

    it("answers malformed, unknown and revoked keys identically", async () => {
      const revoked = generateApiKey();
      Object.entries(keyDoc(MERCHANT, revoked, { revoked: true })).forEach(([p, d]) => db.store.set(p, d));
      for (const key of ["zpk_live_short", generateApiKey(), revoked]) {
        const res = await request("GET", "/v1/charges", { key });
        expect(res.statusCode).toBe(401);
        expect(res.json.error.code).toBe("invalid_api_key");
      }
    });

    it("refuses a key whose account lost the merchant role", async () => {
      db.store.set(`users/${MERCHANT}`, { accountType: "customer", accountStatus: "active" });
      const res = await request("GET", "/v1/charges");
      expect(res.statusCode).toBe(403);
      expect(res.json.error.code).toBe("not_a_merchant");
    });

    it("refuses a key whose account is frozen", async () => {
      db.store.set(`users/${MERCHANT}`, { accountType: "merchant", accountStatus: "frozen" });
      const res = await request("GET", "/v1/charges");
      expect(res.statusCode).toBe(403);
      expect(res.json.error.code).toBe("account_inactive");
    });

    it("rate-limits per key", async () => {
      // Well past any configured per-minute allowance.
      const bucket = Math.floor(Date.now() / 60000);
      db.store.set(`api_rate_limits/${hashApiKey(KEY).slice(0, 32)}_${bucket}`, { count: 10_000 });
      const res = await request("GET", "/v1/charges");
      expect(res.statusCode).toBe(429);
      expect(res.json.error.type).toBe("rate_limit_error");
    });
  });

  describe("charges", () => {
    it("creates a pending charge with checkout link, QR payload and deep link", async () => {
      const res = await createCharge({ metadata: { order: "1001" }, success_url: "https://shop.example/ok" });

      expect(res.statusCode).toBe(201);
      const c = res.json;
      expect(c.id).toMatch(/^ch_/);
      expect(c).toMatchObject({
        object: "charge",
        amount: 1250,
        currency: "USD",
        status: "pending",
        reference: "Order 1001",
        metadata: { order: "1001" },
        amount_refunded: 0,
        deep_link: `zapppay://charge/${c.id}`,
        success_url: "https://shop.example/ok",
      });
      expect(c.checkout_url).toMatch(new RegExp(`/checkout/${c.id}$`));
      expect(c.qr_payload).toBe(c.checkout_url);
      // Default TTL is 15 minutes.
      const ttl = Date.parse(c.expires_at) - Date.parse(c.created);
      expect(ttl).toBe(900_000);
      expect(db.get(`api_charges/${c.id}`)).toMatchObject({ merchantId: MERCHANT, merchantName: "Hooyo Cafe" });
      // Nothing moved.
      expect([...db.store.keys()].some((k) => k.startsWith("journal_entries/"))).toBe(false);
    });

    it("requires an Idempotency-Key", async () => {
      const res = await request("POST", "/v1/charges", { body: { amount: 100 } });
      expect(res.statusCode).toBe(400);
      expect(res.json.error.code).toBe("idempotency_key_required");
    });

    it("returns the same charge for a retried request", async () => {
      const first = await createCharge();
      const second = await createCharge();
      expect(second.statusCode).toBe(200);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(second.json.id).toBe(first.json.id);
      expect([...db.store.keys()].filter((k) => k.startsWith("api_charges/"))).toHaveLength(1);
    });

    it("refuses a reused key with different parameters", async () => {
      await createCharge();
      const res = await createCharge({ amount: 9999 });
      expect(res.statusCode).toBe(422);
      expect(res.json.error.code).toBe("idempotency_key_reused");
    });

    it("scopes idempotency keys to the merchant", async () => {
      const mine = await createCharge();
      const theirs = await createCharge({}, "order-1001-attempt", OTHER_KEY);
      expect(theirs.statusCode).toBe(201);
      expect(theirs.json.id).not.toBe(mine.json.id);
    });

    it.each([
      [{ amount: 12.5 }, "amount"],
      [{ amount: -5 }, "amount"],
      [{ amount: "1250" }, "amount"],
      [{ currency: "EUR" }, "currency"],
      [{ customer_phone: "0634000001" }, "customer_phone"],
      [{ success_url: "http://shop.example/ok" }, "success_url"],
      [{ expires_in: 5 }, "expires_in"],
      [{ metadata: { k: 5 } }, "metadata"],
      [{ reference: "x".repeat(129) }, "reference"],
    ])("rejects invalid input %j", async (body, param) => {
      const res = await createCharge(body, `idem-${param}-bad`);
      expect(res.statusCode).toBe(400);
      expect(res.json.error.param).toBe(param);
    });

    it("addresses a charge to a Zapp customer by phone and notifies them", async () => {
      const res = await createCharge({ customer_phone: "+252634000001" });
      expect(res.statusCode).toBe(201);
      expect(db.get(`api_charges/${res.json.id}`)!.customerId).toBe(CUSTOMER);
      expect(mockedPush).toHaveBeenCalledWith(
        CUSTOMER,
        "Payment Request",
        expect.stringContaining("Hooyo Cafe"),
        expect.objectContaining({ type: "api_charge", chargeId: res.json.id })
      );
    });

    it("answers the same for a phone with no Zapp account", async () => {
      const res = await createCharge({ customer_phone: "+252634999999" });
      expect(res.statusCode).toBe(201);
      expect(db.get(`api_charges/${res.json.id}`)!.customerId).toBeUndefined();
      expect(mockedPush).not.toHaveBeenCalled();
    });

    it("retrieves and lists only the caller's charges", async () => {
      const mine = await createCharge();
      await createCharge({}, "other-merchant-order", OTHER_KEY);

      const got = await request("GET", `/v1/charges/${mine.json.id}`);
      expect(got.statusCode).toBe(200);
      expect(got.json.id).toBe(mine.json.id);

      const theirs = await request("GET", `/v1/charges/${mine.json.id}`, { key: OTHER_KEY });
      expect(theirs.statusCode).toBe(404);

      const list = await request("GET", "/v1/charges");
      expect(list.json.data.map((c: any) => c.id)).toEqual([mine.json.id]);
    });

    it("reports a lapsed charge as expired", async () => {
      const { json } = await createCharge();
      db.store.set(`api_charges/${json.id}`, {
        ...db.get(`api_charges/${json.id}`),
        expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      });
      const got = await request("GET", `/v1/charges/${json.id}`);
      expect(got.json.status).toBe("expired");
    });

    it("cancels a pending charge, idempotently", async () => {
      const { json } = await createCharge();
      const first = await request("POST", `/v1/charges/${json.id}/cancel`);
      const second = await request("POST", `/v1/charges/${json.id}/cancel`);
      expect(first.json.status).toBe("canceled");
      expect(second.statusCode).toBe(200);
      expect(second.json.status).toBe("canceled");
      expect(db.get(`api_charges/${json.id}`)!.status).toBe("canceled");
    });

    it("will not cancel a paid charge", async () => {
      const { json } = await createCharge();
      db.store.set(`api_charges/${json.id}`, { ...db.get(`api_charges/${json.id}`), status: "succeeded" });
      const res = await request("POST", `/v1/charges/${json.id}/cancel`);
      expect(res.statusCode).toBe(409);
      expect(res.json.error.code).toBe("charge_already_succeeded");
    });

    it("the sweep marks lapsed charges expired and leaves paid ones alone", async () => {
      const a = (await createCharge({}, "sweep-a-key")).json.id;
      const b = (await createCharge({}, "sweep-b-key")).json.id;
      const past = Timestamp.fromMillis(Date.now() - 1000);
      db.store.set(`api_charges/${a}`, { ...db.get(`api_charges/${a}`), expiresAt: past });
      db.store.set(`api_charges/${b}`, { ...db.get(`api_charges/${b}`), expiresAt: past, status: "succeeded" });

      expect(await expireLapsedCharges()).toBe(1);
      expect(db.get(`api_charges/${a}`)!.status).toBe("expired");
      expect(db.get(`api_charges/${b}`)!.status).toBe("succeeded");
    });
  });

  describe("public charge status", () => {
    it("works without a key and exposes only what the checkout page shows", async () => {
      const { json } = await createCharge({
        metadata: { internal: "secret-order-notes" },
        customer_phone: "+252634000001",
      });
      const res = await request("GET", `/v1/public/charges/${json.id}`, { key: null });
      expect(res.statusCode).toBe(200);
      expect(res.json).toMatchObject({
        id: json.id,
        status: "pending",
        amount: 1250,
        merchant_name: "Hooyo Cafe",
        reference: "Order 1001",
      });
      const text = JSON.stringify(res.json);
      expect(text).not.toContain("secret-order-notes");
      expect(text).not.toContain("+252634000001");
      expect(text).not.toContain(MERCHANT);
    });

    it("404s an unknown charge", async () => {
      const res = await request("GET", "/v1/public/charges/ch_doesnotexistdoesnotexist", { key: null });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("routing", () => {
    it("404s an unknown route and 405s a wrong method", async () => {
      expect((await request("GET", "/v1/nope")).statusCode).toBe(404);
      expect((await request("DELETE", "/v1/charges")).statusCode).toBe(405);
    });
  });

  describe("refunds", () => {
    const CHARGE = "ch_paidpaidpaidpaidpaidpaid";
    const PAYMENT_TX = "tx-payment-1";

    beforeEach(() => {
      // A $50.00 charge the customer paid: $0.50 fee, $49.50 to the merchant.
      db.store.set(`api_charges/${CHARGE}`, {
        merchantId: MERCHANT,
        merchantName: "Hooyo Cafe",
        keyId: hashApiKey(KEY),
        amount: 5000,
        currency: "USD",
        status: "succeeded",
        paidBy: CUSTOMER,
        transactionId: PAYMENT_TX,
        journalEntryId: `apicharge_${CHARGE}`,
        feeCents: 50,
        netCents: 4950,
        amountRefunded: 0,
        feeRefunded: 0,
        refundCount: 0,
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
      });
      db.store.set(`transactions/${PAYMENT_TX}`, {
        type: "payment",
        fromUserId: CUSTOMER,
        toUserId: MERCHANT,
        amount: 5000,
        apiChargeId: CHARGE,
        status: "completed",
      });
      db.store.set(`wallets/${CUSTOMER}`, wallet(0));
      db.store.set(`wallets/${MERCHANT}`, wallet(4950));
      db.store.set("ledger_balances/platform:fees", { account: "platform:fees", balance: 50 });
    });

    const refund = (body: Record<string, unknown> = {}, idem = "refund-attempt-1") =>
      request("POST", `/v1/charges/${CHARGE}/refunds`, { body, idem });

    it("fully refunds by default, returning the whole fee", async () => {
      const res = await refund();
      expect(res.statusCode).toBe(201);
      expect(res.json).toMatchObject({ object: "refund", charge: CHARGE, amount: 5000, fee_returned: 50 });

      const entry = db.get(`journal_entries/refund_apicharge_${CHARGE}_1`)!;
      expect(entry.type).toBe("refund");
      expect(entry.lines).toEqual(
        expect.arrayContaining([
          { account: `user:${CUSTOMER}`, debit: 0, credit: 5000 },
          { account: `user:${MERCHANT}`, debit: 4950, credit: 0 },
          { account: "platform:fees", debit: 50, credit: 0 },
        ])
      );
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5000);
      expect(db.get(`wallets/${MERCHANT}`)!.balance).toBe(0);
      expect(db.get("ledger_balances/platform:fees")!.balance).toBe(0);

      const refundTx = db.get(`transactions/${res.json.transaction_id}`)!;
      expect(refundTx).toMatchObject({
        type: "refund",
        participants: [MERCHANT, CUSTOMER],
        journalEntryId: `refund_apicharge_${CHARGE}_1`,
        refundOfTransactionId: PAYMENT_TX,
      });
      expect(db.get(`transactions/${PAYMENT_TX}`)!.refundedAt).toBeDefined();
      expect(db.get(`api_charges/${CHARGE}`)).toMatchObject({ amountRefunded: 5000, feeRefunded: 50, refundCount: 1 });
      expect(mockedNotify).toHaveBeenCalledWith(CUSTOMER, "refund_issued", expect.any(String), expect.any(String), expect.any(Object));
    });

    it("partial refunds add up to exactly the charge and the fee", async () => {
      const r1 = await refund({ amount: 3333 }, "partial-refund-1");
      const r2 = await refund({ amount: 1667 }, "partial-refund-2");
      expect(r1.statusCode).toBe(201);
      expect(r2.statusCode).toBe(201);
      expect(r1.json.fee_returned + r2.json.fee_returned).toBe(50);
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5000);
      expect(db.get(`wallets/${MERCHANT}`)!.balance).toBe(0);
      expect(db.get("ledger_balances/platform:fees")!.balance).toBe(0);
      expect(db.get(`journal_entries/refund_apicharge_${CHARGE}_2`)).toBeDefined();
      expect(db.get(`transactions/${PAYMENT_TX}`)!.refundedAt).toBeDefined();

      const over = await refund({ amount: 1 }, "partial-refund-3");
      expect(over.statusCode).toBe(409);
      expect(over.json.error.code).toBe("charge_already_refunded");
    });

    it("refuses more than is left to refund", async () => {
      await refund({ amount: 4000 }, "partial-refund-1");
      const res = await refund({ amount: 1001 }, "partial-refund-2");
      expect(res.statusCode).toBe(400);
      expect(res.json.error.code).toBe("amount_too_large");
    });

    it("answers a retried refund with the first refund, moving nothing again", async () => {
      const first = await refund({ amount: 1000 });
      const second = await refund({ amount: 1000 });
      expect(second.statusCode).toBe(200);
      expect(second.json.id).toBe(first.json.id);
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(1000);
      expect(db.get(`journal_entries/refund_apicharge_${CHARGE}_2`)).toBeUndefined();
    });

    it("refuses when the merchant cannot cover the refund", async () => {
      db.store.set(`wallets/${MERCHANT}`, wallet(100));
      const res = await refund();
      expect(res.statusCode).toBe(409);
      expect(res.json.error.code).toBe("insufficient_balance");
      expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(0);
      expect(db.get(`api_charges/${CHARGE}`)!.refundCount).toBe(0);
    });

    it("refuses to refund an unpaid charge", async () => {
      const { json } = await createCharge();
      const res = await request("POST", `/v1/charges/${json.id}/refunds`, { idem: "refund-unpaid-1" });
      expect(res.statusCode).toBe(409);
      expect(res.json.error.code).toBe("charge_not_succeeded");
    });

    it("404s another merchant's charge", async () => {
      const res = await request("POST", `/v1/charges/${CHARGE}/refunds`, { idem: "refund-theirs-1", key: OTHER_KEY });
      expect(res.statusCode).toBe(404);
    });
  });
});

describe("cumulativeFeeReturned", () => {
  it("hands back the whole fee on a full refund, however it is split", () => {
    for (const [fee, amount] of [[50, 5000], [3, 333], [1, 99], [123, 12345]]) {
      for (const parts of [2, 3, 7]) {
        let refunded = 0;
        let returned = 0;
        for (let i = 1; i <= parts; i++) {
          const next = i === parts ? amount : Math.floor((amount * i) / parts);
          returned += cumulativeFeeReturned(fee, amount, next) - cumulativeFeeReturned(fee, amount, refunded);
          refunded = next;
        }
        expect(returned).toBe(fee);
      }
    }
  });
});
