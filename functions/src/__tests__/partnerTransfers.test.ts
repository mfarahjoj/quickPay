import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

jest.mock("../utils/notifications", () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { notifyUser } from "../utils/notifications";
import { handleApiRequest } from "../api/app";
import { generateApiKey, hashApiKey, apiKeyHint } from "../api/keys";
import { maskName, transferDayKey } from "../api/transfers";
import { chargeFeeRateFor } from "../api/partners";
import { validatePartnerInput } from "../admin/apiPartners";

const { Timestamp } = admin.firestore;
const RIDY = "ridy-merchant";
const DRIVER = "driver-1";
const DRIVER_PHONE = "+252634111222";
const TRANSFER_KEY = generateApiKey();
const TILL_KEY = generateApiKey();
const TEST_KEY = generateApiKey("test");

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  json: any;
}

async function request(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown; idem?: string; query?: Record<string, string> } = {}
): Promise<FakeRes> {
  const headers: Record<string, string> = { authorization: `Bearer ${opts.key ?? TRANSFER_KEY}` };
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

const keyDoc = (key: string, extra: Record<string, unknown> = {}) => ({
  [`merchant_api_keys/${hashApiKey(key)}`]: {
    merchantId: RIDY,
    label: "Payouts",
    hint: apiKeyHint(key),
    revoked: false,
    createdAt: Timestamp.now(),
    createdBy: "admin-1",
    lastUsedAt: Timestamp.now(),
    ...extra,
  },
});

describe("partner transfers", () => {
  let db: FakeDb;
  let restore: () => void;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    db = fakeFirestore({
      [`users/${RIDY}`]: { accountType: "merchant", fullName: "Ridy", accountStatus: "active" },
      [`users/${DRIVER}`]: {
        accountType: "customer",
        fullName: "Cabdi Xasan",
        phoneNumber: DRIVER_PHONE,
        accountStatus: "active",
      },
      [`wallets/${RIDY}`]: wallet(50_000, { sls: { balance: 1_000_000, totalSent: 0, totalReceived: 1_000_000 } }),
      [`wallets/${DRIVER}`]: wallet(0),
      [`api_partners/${RIDY}`]: {
        transfersEnabled: true,
        maxTransferUsdCents: 10_000,
        dailyTransferUsdCents: 20_000,
        updatedAt: Timestamp.now(),
        updatedBy: "admin-1",
      },
      ...keyDoc(TRANSFER_KEY, { scopes: ["transfers"] }),
      ...keyDoc(TILL_KEY),
      ...keyDoc(TEST_KEY, { scopes: ["transfers"], livemode: false }),
    });
    restore = useFakeFirestore(db);
  });

  afterEach(() => {
    restore();
    logSpy.mockRestore();
  });

  const transfer = (body: Record<string, unknown> = {}, idem = "payout-ride-1", key?: string) =>
    request("POST", "/v1/transfers", {
      body: { amount: 23_000, currency: "SLSH", destination_phone: DRIVER_PHONE, reference: "Ride 1", ...body },
      idem,
      key,
    });

  it("pays the driver's shillings from the partner's shillings, in one entry", async () => {
    const res = await transfer({ metadata: { rideId: "ride-1" } });
    expect(res.statusCode).toBe(201);
    expect(res.json).toMatchObject({
      object: "transfer",
      amount: 23_000,
      currency: "SLSH",
      status: "succeeded",
      failure_code: null,
      destination_phone: DRIVER_PHONE,
      metadata: { rideId: "ride-1" },
      livemode: true,
    });
    expect(res.json.id).toMatch(/^tr_/);

    expect(db.get(`wallets/${DRIVER}`)!.sls.balance).toBe(23_000);
    expect(db.get(`wallets/${RIDY}`)!.sls.balance).toBe(977_000);
    expect(db.get(`wallets/${RIDY}`)!.balance).toBe(50_000);

    const entry = db.get(`journal_entries/transfer_${res.json.id}`)!;
    expect(entry).toMatchObject({ type: "payroll", currency: "SLS" });
    expect(entry.refs.apiTransferId).toBe(res.json.id);

    const row = db.get(`transactions/${res.json.transaction_id}`)!;
    expect(row).toMatchObject({ kind: "payroll", toUserId: DRIVER, currency: "SLS", amount: 23_000 });
    expect(notifyUser).toHaveBeenCalledWith(
      DRIVER,
      "payment_received",
      expect.objectContaining({ key: "transfer.received" }),
      expect.anything()
    );
  });

  it("answers a retry with the first transfer and never pays twice", async () => {
    const first = await transfer();
    const again = await transfer();
    expect(again.statusCode).toBe(200);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json.id).toBe(first.json.id);
    expect(db.get(`wallets/${DRIVER}`)!.sls.balance).toBe(23_000);

    const changed = await transfer({ amount: 24_000 });
    expect(changed.statusCode).toBe(422);
  });

  it("requires the currency: paying in the wrong one is a real loss", async () => {
    const res = await transfer({ currency: undefined });
    expect(res.statusCode).toBe(400);
    expect(res.json.error.code).toBe("currency_unsupported");
  });

  it("records a failed transfer when the number has no account, and moves nothing", async () => {
    const res = await transfer({ destination_phone: "+252634999888" });
    expect(res.statusCode).toBe(201);
    expect(res.json).toMatchObject({ status: "failed", failure_code: "recipient_not_found", transaction_id: null });
    expect(db.get(`wallets/${RIDY}`)!.sls.balance).toBe(1_000_000);
    // Final for its key.
    const again = await transfer({ destination_phone: "+252634999888" });
    expect(again.json).toMatchObject({ id: res.json.id, status: "failed" });
  });

  it("fails for a frozen account or one with no wallet", async () => {
    db.store.set(`users/${DRIVER}`, { ...db.get(`users/${DRIVER}`)!, accountStatus: "frozen" });
    expect((await transfer({}, "k-frozen-1")).json.failure_code).toBe("recipient_inactive");

    db.store.set(`users/${DRIVER}`, { ...db.get(`users/${DRIVER}`)!, accountStatus: "active" });
    db.store.delete(`wallets/${DRIVER}`);
    expect((await transfer({}, "k-nowallet-1")).json.failure_code).toBe("recipient_inactive");
  });

  it("refuses a short balance without recording anything, so the same key can retry", async () => {
    db.store.set(`wallets/${RIDY}`, wallet(50_000, { sls: { balance: 1_000, totalSent: 0, totalReceived: 1_000 } }));
    const res = await transfer();
    expect(res.statusCode).toBe(409);
    expect(res.json.error.code).toBe("insufficient_balance");

    db.store.set(`wallets/${RIDY}`, wallet(50_000, { sls: { balance: 100_000, totalSent: 0, totalReceived: 100_000 } }));
    const retry = await transfer();
    expect(retry.statusCode).toBe(201);
    expect(retry.json.status).toBe("succeeded");
  });

  it("holds the per-transfer cap, counting shillings at the rate", async () => {
    // $100 cap at 8,000 SLSH a dollar is 800,000 SLSH.
    const res = await transfer({ amount: 800_001 });
    expect(res.statusCode).toBe(400);
    expect(res.json.error.code).toBe("amount_over_limit");
  });

  it("holds the daily cap across transfers", async () => {
    // $200 a day: 800,000 + 800,000 fits; a third does not.
    db.store.set(`wallets/${RIDY}`, wallet(0, { sls: { balance: 5_000_000, totalSent: 0, totalReceived: 5_000_000 } }));
    expect((await transfer({ amount: 800_000 }, "idem-d-1-key")).statusCode).toBe(201);
    expect((await transfer({ amount: 800_000 }, "idem-d-2-key")).statusCode).toBe(201);
    const third = await transfer({ amount: 8_000 }, "idem-d-3-key");
    expect(third.statusCode).toBe(409);
    expect(third.json.error.code).toBe("daily_limit_reached");
    const day = db.get(`api_partners/${RIDY}/transfer_days/${transferDayKey(new Date())}`)!;
    expect(day).toEqual({ usdCents: 20_000, count: 2 });
  });

  it("refuses a key without the transfers scope, and a merchant that is not a partner", async () => {
    const till = await transfer({}, "idem-till-1-key", TILL_KEY);
    expect(till.statusCode).toBe(403);
    expect(till.json.error.code).toBe("transfers_not_enabled");

    db.store.set(`api_partners/${RIDY}`, { ...db.get(`api_partners/${RIDY}`)!, transfersEnabled: false });
    const off = await transfer({}, "idem-off-1-key");
    expect(off.statusCode).toBe(403);
    expect(off.json.error.code).toBe("transfers_not_enabled");
    expect(db.get(`wallets/${DRIVER}`)!.sls).toBeUndefined();
  });

  it("refuses a transfer to the partner itself", async () => {
    db.store.set(`users/${RIDY}`, { ...db.get(`users/${RIDY}`)!, phoneNumber: "+252634000777" });
    const res = await transfer({ destination_phone: "+252634000777" });
    expect(res.statusCode).toBe(400);
    expect(res.json.error.code).toBe("destination_invalid");
  });

  it("in test mode records a transfer and moves nothing", async () => {
    const ok = await transfer({}, "idem-t-1-key", TEST_KEY);
    expect(ok.json).toMatchObject({ status: "succeeded", livemode: false, transaction_id: null });
    expect(db.get(`wallets/${DRIVER}`)!.sls).toBeUndefined();
    expect(db.get(`wallets/${RIDY}`)!.sls.balance).toBe(1_000_000);

    const fail = await transfer({ destination_phone: "+252634110000" }, "idem-t-2-key", TEST_KEY);
    expect(fail.json).toMatchObject({ status: "failed", failure_code: "recipient_not_found" });

    // Live keys cannot read test transfers.
    expect((await request("GET", `/v1/transfers/${ok.json.id}`)).statusCode).toBe(404);
    expect((await request("GET", `/v1/transfers/${ok.json.id}`, { key: TEST_KEY })).json.id).toBe(ok.json.id);
  });

  it("retrieves its own transfer", async () => {
    const made = await transfer();
    const got = await request("GET", `/v1/transfers/${made.json.id}`);
    expect(got.statusCode).toBe(200);
    expect(got.json).toEqual(made.json);
  });

  describe("account lookup", () => {
    const lookup = (phone: string, key?: string) =>
      request("GET", "/v1/accounts/lookup", { query: { phone }, key });

    it("says whether a number can be paid, with the name mostly hidden", async () => {
      const res = await lookup(DRIVER_PHONE);
      expect(res.json).toEqual({
        object: "account_lookup",
        phone: DRIVER_PHONE,
        found: true,
        name_hint: "Ca*** Xa***",
        livemode: true,
      });
      expect((await lookup("+252634999888")).json.found).toBe(false);
    });

    it("reads a frozen account as not found", async () => {
      db.store.set(`users/${DRIVER}`, { ...db.get(`users/${DRIVER}`)!, accountStatus: "frozen" });
      expect((await lookup(DRIVER_PHONE)).json).toMatchObject({ found: false, name_hint: null });
    });

    it("is for partners only", async () => {
      expect((await lookup(DRIVER_PHONE, TILL_KEY)).statusCode).toBe(403);
    });

    it("is rate-limited on its own budget", async () => {
      const bucket = Math.floor(Date.now() / 60000);
      db.store.set(`api_rate_limits/lookup:${hashApiKey(TRANSFER_KEY).slice(0, 25)}_${bucket}`, { count: 1_000 });
      expect((await lookup(DRIVER_PHONE)).statusCode).toBe(429);
    });
  });

  describe("partner fee", () => {
    it("uses the partner's own rate, or the standard one", async () => {
      expect(await chargeFeeRateFor(RIDY, 0.01)).toBe(0.01);
      db.store.set(`api_partners/${RIDY}`, { ...db.get(`api_partners/${RIDY}`)!, chargeFeeRate: 0.005 });
      expect(await chargeFeeRateFor(RIDY, 0.01)).toBe(0.005);
      expect(await chargeFeeRateFor("someone-else", 0.01)).toBe(0.01);
    });
  });
});

describe("maskName", () => {
  it("keeps enough to confirm a number", () => {
    expect(maskName("Mahamed Farah")).toBe("Ma***** Fa***");
    expect(maskName("Al")).toBe("A*");
    expect(maskName("  Xasan  ")).toBe("Xa***");
  });
});

describe("validatePartnerInput", () => {
  const ok = { transfersEnabled: true, maxTransferUsdCents: 10_000, dailyTransferUsdCents: 200_000, chargeFeeRate: null };
  it("accepts sane settings", () => {
    expect(validatePartnerInput(ok)).toEqual(ok);
    expect(validatePartnerInput({ ...ok, chargeFeeRate: 0.005 }).chargeFeeRate).toBe(0.005);
  });
  it("refuses caps out of order and silly fees", () => {
    expect(() => validatePartnerInput({ ...ok, dailyTransferUsdCents: 5_000 })).toThrow(/daily cap/);
    expect(() => validatePartnerInput({ ...ok, chargeFeeRate: 0.5 })).toThrow(/chargeFeeRate/);
    expect(() => validatePartnerInput({ ...ok, maxTransferUsdCents: 1.5 })).toThrow(/whole US cents/);
  });
});
