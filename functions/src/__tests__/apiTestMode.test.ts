import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

jest.mock("../utils/notifications", () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { sendPushNotification, notifyUser } from "../utils/notifications";
import { handleApiRequest } from "../api/app";
import { generateApiKey, hashApiKey, apiKeyHint } from "../api/keys";
import { recordEvent } from "../api/webhooks";
import { encrypt } from "../utils/encryption";

/**
 * Test mode: `zpk_test_` keys reach the same API, but nothing they make is
 * visible to live keys, payable by a customer, or backed by money.
 */

const mockedPush = sendPushNotification as jest.MockedFunction<typeof sendPushNotification>;
const mockedNotify = notifyUser as jest.MockedFunction<typeof notifyUser>;

const { Timestamp } = admin.firestore;
const MERCHANT = "merch-1";
const OTHER_MERCHANT = "merch-2";
const CUSTOMER = "cust-1";
const LIVE_KEY = generateApiKey("live");
const TEST_KEY = generateApiKey("test");
const OTHER_TEST_KEY = generateApiKey("test");

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
  const key = opts.key === undefined ? TEST_KEY : opts.key;
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

describe("Merchant API test mode", () => {
  let db: FakeDb;
  let restore: () => void;
  let logSpy: jest.SpyInstance;

  const keyDoc = (merchantId: string, key: string, livemode: boolean | undefined) => ({
    [`merchant_api_keys/${hashApiKey(key)}`]: {
      merchantId,
      label: "Dev",
      hint: apiKeyHint(key),
      ...(livemode === undefined ? {} : { livemode }),
      revoked: false,
      createdAt: Timestamp.now(),
      createdBy: MERCHANT,
      lastUsedAt: Timestamp.now(),
    },
  });

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "a".repeat(64);
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
      [`wallets/${MERCHANT}`]: wallet(0),
      [`wallets/${CUSTOMER}`]: wallet(10_000),
      // A key from before test mode: no livemode field, so live.
      ...keyDoc(MERCHANT, LIVE_KEY, undefined),
      ...keyDoc(MERCHANT, TEST_KEY, false),
      ...keyDoc(OTHER_MERCHANT, OTHER_TEST_KEY, false),
    });
    restore = useFakeFirestore(db);
  });

  afterEach(() => {
    restore();
    logSpy.mockRestore();
  });

  const createCharge = (body: Record<string, unknown> = {}, idem = "order-1001-attempt", key?: string) =>
    request("POST", "/v1/charges", { body: { amount: 1250, reference: "Order 1001", ...body }, idem, key });

  const ledgerEntries = () => [...db.store.keys()].filter((p) => p.startsWith("journal_entries/"));
  const transactions = () => [...db.store.keys()].filter((p) => p.startsWith("transactions/"));

  describe("keys", () => {
    it("refuses a test key whose stored record says live, and the reverse", async () => {
      const forgedTest = generateApiKey("test");
      const forgedLive = generateApiKey("live");
      Object.entries({ ...keyDoc(MERCHANT, forgedTest, true), ...keyDoc(MERCHANT, forgedLive, false) })
        .forEach(([p, d]) => db.store.set(p, d));
      for (const key of [forgedTest, forgedLive]) {
        const res = await request("GET", "/v1/charges", { key });
        expect(res.statusCode).toBe(401);
        expect(res.json.error.code).toBe("invalid_api_key");
      }
    });
  });

  describe("charges", () => {
    it("marks a test charge livemode false", async () => {
      const res = await createCharge();
      expect(res.statusCode).toBe(201);
      expect(res.json.livemode).toBe(false);
      expect(db.get(`api_charges/${res.json.id}`)!.livemode).toBe(false);
    });

    it("marks a live charge livemode true", async () => {
      const res = await createCharge({}, "live-order-1", LIVE_KEY);
      expect(res.json.livemode).toBe(true);
      expect(db.get(`api_charges/${res.json.id}`)!.livemode).toBe(true);
    });

    it("never looks up or notifies a real customer from a test charge", async () => {
      const res = await createCharge({ customer_phone: "+252634000001" });
      expect(res.statusCode).toBe(201);
      expect(db.get(`api_charges/${res.json.id}`)!.customerId).toBeUndefined();
      expect(mockedPush).not.toHaveBeenCalled();
    });

    it("keeps the modes apart: neither key can read the other's charges", async () => {
      const test = await createCharge();
      const live = await createCharge({}, "live-order-1", LIVE_KEY);

      expect((await request("GET", `/v1/charges/${test.json.id}`, { key: LIVE_KEY })).statusCode).toBe(404);
      expect((await request("GET", `/v1/charges/${live.json.id}`)).statusCode).toBe(404);
      expect((await request("POST", `/v1/charges/${live.json.id}/cancel`)).statusCode).toBe(404);

      const testList = await request("GET", "/v1/charges");
      const liveList = await request("GET", "/v1/charges", { key: LIVE_KEY });
      expect(testList.json.data.map((c: any) => c.id)).toEqual([test.json.id]);
      expect(liveList.json.data.map((c: any) => c.id)).toEqual([live.json.id]);
    });

    it("refuses a cursor from the other mode", async () => {
      const live = await createCharge({}, "live-order-1", LIVE_KEY);
      const res = await request("GET", "/v1/charges", { query: { starting_after: live.json.id } });
      expect(res.statusCode).toBe(400);
    });

    it("does not let the same Idempotency-Key in test mode replay a live charge", async () => {
      const live = await createCharge({}, "order-1001-attempt", LIVE_KEY);
      const test = await createCharge({}, "order-1001-attempt");
      expect(test.statusCode).toBe(201);
      expect(test.json.id).not.toBe(live.json.id);
      expect(test.json.livemode).toBe(false);
    });
  });

  describe("test helpers", () => {
    it("settles a test charge as paid with the fee a live one would show, posting nothing", async () => {
      const { json: charge } = await createCharge({ amount: 10_000 });
      const res = await request("POST", `/v1/test_helpers/charges/${charge.id}/succeed`);

      expect(res.statusCode).toBe(200);
      expect(res.json).toMatchObject({ status: "succeeded", fee: 100, net: 9900, livemode: false, transaction_id: null });
      expect(ledgerEntries()).toEqual([]);
      expect(transactions()).toEqual([]);
      expect(db.get(`wallets/${MERCHANT}`)!.balance).toBe(0);
    });

    it("is a no-op on a charge already settled the same way", async () => {
      const { json: charge } = await createCharge();
      await request("POST", `/v1/test_helpers/charges/${charge.id}/succeed`);
      const again = await request("POST", `/v1/test_helpers/charges/${charge.id}/succeed`);
      expect(again.statusCode).toBe(200);
      expect(again.json.status).toBe("succeeded");
      const other = await request("POST", `/v1/test_helpers/charges/${charge.id}/expire`);
      expect(other.statusCode).toBe(409);
      expect(other.json.error.code).toBe("charge_not_pending");
    });

    it("expires a test charge", async () => {
      const { json: charge } = await createCharge();
      const res = await request("POST", `/v1/test_helpers/charges/${charge.id}/expire`);
      expect(res.json.status).toBe("expired");
      expect(db.get(`api_charges/${charge.id}`)!.status).toBe("expired");
    });

    it("refuses a live key", async () => {
      const { json: charge } = await createCharge({}, "live-order-1", LIVE_KEY);
      const res = await request("POST", `/v1/test_helpers/charges/${charge.id}/succeed`, { key: LIVE_KEY });
      expect(res.statusCode).toBe(400);
      expect(res.json.error.code).toBe("test_mode_only");
      expect(db.get(`api_charges/${charge.id}`)!.status).toBe("pending");
    });

    it("cannot reach a live charge or another merchant's test charge", async () => {
      const { json: live } = await createCharge({}, "live-order-1", LIVE_KEY);
      const { json: theirs } = await createCharge({}, "theirs-order-1", OTHER_TEST_KEY);
      for (const id of [live.id, theirs.id]) {
        const res = await request("POST", `/v1/test_helpers/charges/${id}/succeed`);
        expect([400, 404]).toContain(res.statusCode);
        expect(db.get(`api_charges/${id}`)!.status).toBe("pending");
      }
    });

    it("refuses to pay a test charge that has lapsed, and records the expiry", async () => {
      const { json: charge } = await createCharge();
      db.store.set(`api_charges/${charge.id}`, {
        ...db.get(`api_charges/${charge.id}`)!,
        expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      });
      const res = await request("POST", `/v1/test_helpers/charges/${charge.id}/succeed`);
      expect(res.statusCode).toBe(409);
      expect(res.json.error.code).toBe("charge_expired");
      expect(db.get(`api_charges/${charge.id}`)!.status).toBe("expired");
    });
  });

  describe("hosted checkout's simulated payment", () => {
    it("pays a test charge from its link, without a key", async () => {
      const { json: charge } = await createCharge();
      const res = await request("POST", `/v1/public/charges/${charge.id}/test_payment`, { key: null });
      expect(res.statusCode).toBe(200);
      expect(res.json).toMatchObject({ object: "public_charge", status: "succeeded", livemode: false });
      expect(ledgerEntries()).toEqual([]);
    });

    it("can do nothing to a live charge", async () => {
      const { json: charge } = await createCharge({}, "live-order-1", LIVE_KEY);
      const res = await request("POST", `/v1/public/charges/${charge.id}/test_payment`, { key: null });
      expect(res.statusCode).toBe(400);
      expect(res.json.error.code).toBe("test_mode_only");
      expect(db.get(`api_charges/${charge.id}`)!.status).toBe("pending");
    });

    it("tells the checkout page which mode a charge is in", async () => {
      const { json: test } = await createCharge();
      const { json: live } = await createCharge({}, "live-order-1", LIVE_KEY);
      expect((await request("GET", `/v1/public/charges/${test.id}`, { key: null })).json.livemode).toBe(false);
      expect((await request("GET", `/v1/public/charges/${live.id}`, { key: null })).json.livemode).toBe(true);
    });
  });

  describe("refunds", () => {
    const paidTestCharge = async (amount = 10_000) => {
      const { json: charge } = await createCharge({ amount });
      await request("POST", `/v1/test_helpers/charges/${charge.id}/succeed`);
      return charge.id as string;
    };

    it("refunds a test charge in parts with the live fee arithmetic, posting nothing", async () => {
      const id = await paidTestCharge();
      const first = await request("POST", `/v1/charges/${id}/refunds`, { body: { amount: 2500 }, idem: "refund-1" });
      const rest = await request("POST", `/v1/charges/${id}/refunds`, { idem: "refund-2" });

      expect(first.statusCode).toBe(201);
      expect(first.json).toMatchObject({ amount: 2500, fee_returned: 25, livemode: false, transaction_id: null });
      expect(rest.json).toMatchObject({ amount: 7500, fee_returned: 75 });
      expect(db.get(`api_charges/${id}`)).toMatchObject({ amountRefunded: 10_000, feeRefunded: 100, refundCount: 2 });
      expect(ledgerEntries()).toEqual([]);
      expect(transactions()).toEqual([]);
      expect(mockedNotify).not.toHaveBeenCalled();

      const over = await request("POST", `/v1/charges/${id}/refunds`, { body: { amount: 1 }, idem: "refund-3" });
      expect(over.statusCode).toBe(409);
      expect(over.json.error.code).toBe("charge_already_refunded");
    });

    it("replays a retried test refund", async () => {
      const id = await paidTestCharge();
      const a = await request("POST", `/v1/charges/${id}/refunds`, { body: { amount: 100 }, idem: "refund-1" });
      const b = await request("POST", `/v1/charges/${id}/refunds`, { body: { amount: 100 }, idem: "refund-1" });
      expect(b.statusCode).toBe(200);
      expect(b.headers["idempotent-replayed"]).toBe("true");
      expect(b.json.id).toBe(a.json.id);
      expect(db.get(`api_charges/${id}`)!.amountRefunded).toBe(100);
    });

    it("refuses an unpaid test charge", async () => {
      const { json: charge } = await createCharge();
      const res = await request("POST", `/v1/charges/${charge.id}/refunds`, { idem: "refund-1" });
      expect(res.statusCode).toBe(409);
      expect(res.json.error.code).toBe("charge_not_succeeded");
    });
  });

  describe("webhook endpoints", () => {
    it("keeps endpoints per mode", async () => {
      const t = await request("POST", "/v1/webhook_endpoints", { body: { url: "https://shop.example/test-hooks" } });
      const l = await request("POST", "/v1/webhook_endpoints", {
        body: { url: "https://shop.example/hooks" },
        key: LIVE_KEY,
      });
      expect(t.json.livemode).toBe(false);
      expect(l.json.livemode).toBe(true);

      expect((await request("GET", "/v1/webhook_endpoints")).json.data.map((e: any) => e.id)).toEqual([t.json.id]);
      expect((await request("DELETE", `/v1/webhook_endpoints/${l.json.id}`)).statusCode).toBe(404);
    });

    it("sends a test charge's events only to test endpoints", async () => {
      const now = Timestamp.now();
      const endpoint = (livemode: boolean) => ({
        merchantId: MERCHANT,
        livemode,
        url: `https://shop.example/${livemode ? "live" : "test"}`,
        secretEnc: encrypt("whsec_x"),
        enabled: true,
        createdAt: now,
      });
      db.store.set("webhook_endpoints/we_testtesttesttesttest", endpoint(false));
      db.store.set("webhook_endpoints/we_liveliveliveliveliv", endpoint(true));

      const { json: charge } = await createCharge();
      await request("POST", `/v1/test_helpers/charges/${charge.id}/succeed`);
      const stored = db.get(`api_charges/${charge.id}`)! as any;
      const deliveries = await recordEvent(charge.id, stored, {
        eventId: `evt_${charge.id}_succeeded`,
        type: "charge.succeeded",
      });

      expect(deliveries).toEqual([`evt_${charge.id}_succeeded__we_testtesttesttesttest`]);
      const payload = JSON.parse(db.get(`api_events/evt_${charge.id}_succeeded`)!.payload);
      expect(payload.livemode).toBe(false);
      expect(payload.data.object.livemode).toBe(false);
    });
  });
});
