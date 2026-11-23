import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const fft = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/velocity", () => ({ enforceVelocity: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/limits", () => ({
  ...jest.requireActual("../utils/limits"),
  enforceTransactionLimits: jest.fn().mockResolvedValue(undefined),
}));

import { https } from "firebase-functions/v2";
import { verifyUserPin } from "../auth/validatePin";
import { sendPushNotification, notifyPaymentSent } from "../utils/notifications";
import { enforceTransactionLimits } from "../utils/limits";
import { handleApiRequest } from "../api/app";
import { generateApiKey, hashApiKey, apiKeyHint } from "../api/keys";
import { chargeConfirmationPayload, isP256PublicKey, signatureValid } from "../api/agreementSignature";
import { eventsForChange } from "../api/webhooks";
import { validatePartnerInput } from "../admin/apiPartners";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const mockedLimits = enforceTransactionLimits as jest.MockedFunction<typeof enforceTransactionLimits>;
const { Timestamp } = admin.firestore;

const RIDY = "ridy-merchant";
const OTHER_MERCHANT = "other-merchant";
const RIDER = "rider-1";
const STRANGER = "rider-2";
const RIDER_PHONE = "+252634111222";
const STRANGER_PHONE = "+252634333444";
const KEY = generateApiKey();
const PLAIN_KEY = generateApiKey();
const TEST_KEY = generateApiKey("test");
const OTHER_KEY = generateApiKey();

/** A phone's key pair, as the Secure Enclave or Android Keystore would make it. */
function phoneKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const sign = (text: string) => crypto.sign("sha256", Buffer.from(text, "utf8"), privateKey).toString("base64");
  return { pub, sign };
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  json: any;
}

async function request(method: string, path: string, opts: { key?: string; body?: unknown; idem?: string } = {}): Promise<FakeRes> {
  const headers: Record<string, string> = { authorization: `Bearer ${opts.key ?? KEY}` };
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  const req: any = { method, path, headers, body: opts.body ?? {}, query: {} };
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
    label: "Ridy charges",
    hint: apiKeyHint(key),
    revoked: false,
    createdAt: Timestamp.now(),
    createdBy: "admin-1",
    lastUsedAt: Timestamp.now(),
    ...extra,
  },
});

describe("payment agreements", () => {
  let db: FakeDb;
  let restore: () => void;
  let logSpy: jest.SpyInstance;
  let mod: typeof import("../api/approveApiAgreement");
  let approveCall: any;
  let getCall: any;
  let listCall: any;
  let revokeCall: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    mod = await import("../api/approveApiAgreement");
    approveCall = fft.wrap(mod.approveApiAgreement);
    getCall = fft.wrap(mod.getApiAgreement);
    listCall = fft.wrap(mod.listMyAgreements);
    revokeCall = fft.wrap(mod.revokeMyAgreement);
  });
  afterAll(() => fft.cleanup());

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
    mockedLimits.mockReset().mockResolvedValue(undefined);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    db = fakeFirestore({
      [`users/${RIDY}`]: { accountType: "merchant", fullName: "Ridy", accountStatus: "active" },
      [`users/${OTHER_MERCHANT}`]: { accountType: "merchant", fullName: "Other", accountStatus: "active" },
      [`users/${RIDER}`]: { accountType: "customer", fullName: "Amina", phoneNumber: RIDER_PHONE, accountStatus: "active" },
      [`users/${STRANGER}`]: { accountType: "customer", fullName: "Xasan", phoneNumber: STRANGER_PHONE, accountStatus: "active" },
      [`wallets/${RIDY}`]: wallet(0),
      [`wallets/${RIDER}`]: wallet(10_000, { sls: { balance: 500_000, totalSent: 0, totalReceived: 500_000 } }),
      [`wallets/${STRANGER}`]: wallet(10_000),
      [`api_partners/${RIDY}`]: {
        transfersEnabled: false,
        maxTransferUsdCents: 10_000,
        dailyTransferUsdCents: 20_000,
        agreementsEnabled: true,
        agreementMaxChargeUsdCents: 2_000,
        agreementDailyUsdCents: 6_000,
        updatedAt: Timestamp.now(),
        updatedBy: "admin-1",
      },
      ...keyDoc(KEY, { scopes: ["agreements"] }),
      ...keyDoc(PLAIN_KEY),
      ...keyDoc(TEST_KEY, { scopes: ["agreements"], livemode: false }),
      [`merchant_api_keys/${hashApiKey(OTHER_KEY)}`]: {
        merchantId: OTHER_MERCHANT, label: "x", hint: apiKeyHint(OTHER_KEY), revoked: false,
        createdAt: Timestamp.now(), createdBy: "a", scopes: ["agreements"],
      },
      [`api_partners/${OTHER_MERCHANT}`]: { transfersEnabled: false, maxTransferUsdCents: 100, dailyTransferUsdCents: 100,
        agreementsEnabled: true, updatedAt: Timestamp.now(), updatedBy: "a" },
    });
    restore = useFakeFirestore(db);
  });

  afterEach(() => {
    restore();
    logSpy.mockRestore();
  });

  const createAgreement = (pub: string, body: Record<string, unknown> = {}, idem = "link-rider-1", key = KEY) =>
    request("POST", "/v1/agreements", {
      body: { customer_phone: RIDER_PHONE, device_public_key: pub, device_label: "iPhone 15", ...body },
      idem,
      key,
    });

  const approve = (agreementId: string, uid = RIDER, extra: Record<string, unknown> = {}) =>
    approveCall({
      data: { agreementId, pin: "123456", expectedMaxChargeUsdCents: 2_000, expectedDailyUsdCents: 6_000, ...extra },
      auth: { uid },
    });

  /** A rider linked on a phone: the agreement id and the phone. */
  async function linked() {
    const phone = phoneKey();
    const res = await createAgreement(phone.pub);
    await approve(res.json.id);
    return { agreementId: res.json.id as string, phone };
  }

  const charge = (agreementId: string, body: Record<string, unknown> = {}, idem = "ride-1-1-idem-key", key = KEY) =>
    request("POST", "/v1/charges", {
      body: { amount: 30_000, currency: "SLSH", customer_phone: RIDER_PHONE, agreement: agreementId, reference: "Ride 1", ...body },
      idem,
      key,
    });

  const confirm = (chargeId: string, signature: string, key = KEY) =>
    request("POST", `/v1/charges/${chargeId}/confirm`, { body: { signature }, key });

  describe("the signed text", () => {
    it("accepts the phone's P-256 signature and nothing else", () => {
      const phone = phoneKey();
      const text = chargeConfirmationPayload({ chargeId: "ch_x", agreementId: "agr_y", amount: 30_000, currency: "SLS" });
      expect(text).toBe("zapp-agreement-charge:v1:ch_x:agr_y:30000:SLS");
      const sig = phone.sign(text);
      expect(signatureValid(phone.pub, text, sig)).toBe(true);
      expect(signatureValid(phone.pub, text.replace("30000", "30001"), sig)).toBe(false);
      expect(signatureValid(phoneKey().pub, text, sig)).toBe(false);
      expect(signatureValid(phone.pub, text, "bm90IGEgc2lnbmF0dXJl")).toBe(false);
    });

    it("accepts only P-256 public keys", () => {
      expect(isP256PublicKey(phoneKey().pub)).toBe(true);
      const p384 = crypto.generateKeyPairSync("ec", { namedCurve: "P-384" }).publicKey.export({ format: "der", type: "spki" });
      const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "der", type: "spki" });
      expect(isP256PublicKey(p384.toString("base64"))).toBe(false);
      expect(isP256PublicKey(rsa.toString("base64"))).toBe(false);
      expect(isP256PublicKey("garbage")).toBe(false);
    });
  });

  describe("creating", () => {
    it("makes a pending agreement with a link for Zapp, and answers a retry with it", async () => {
      const phone = phoneKey();
      const res = await createAgreement(phone.pub);
      expect(res.statusCode).toBe(201);
      expect(res.json).toMatchObject({
        object: "agreement",
        status: "pending",
        customer_phone: RIDER_PHONE,
        device_label: "iPhone 15",
        max_charge: null,
        livemode: true,
      });
      expect(res.json.id).toMatch(/^agr_/);
      expect(res.json.deep_link).toBe(`zapppay://agreement/${res.json.id}`);
      expect(JSON.stringify(res.json)).not.toContain(phone.pub);

      const again = await createAgreement(phone.pub);
      expect(again.statusCode).toBe(200);
      expect(again.json.id).toBe(res.json.id);
      expect((await createAgreement(phoneKey().pub)).statusCode).toBe(422);
    });

    it("is for partners with linked payments on, and keys with the scope", async () => {
      const pub = phoneKey().pub;
      expect((await createAgreement(pub, {}, "k-plain-1-idem-key", PLAIN_KEY)).json.error.code).toBe("agreements_not_enabled");
      db.store.set(`api_partners/${RIDY}`, { ...db.get(`api_partners/${RIDY}`)!, agreementsEnabled: false });
      expect((await createAgreement(pub, {}, "k-off-1-idem-key")).statusCode).toBe(403);
    });

    it("refuses a key that isn't P-256, and a number that isn't +252", async () => {
      const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "der", type: "spki" });
      expect((await createAgreement(rsa.toString("base64"))).json.error.code).toBe("device_key_invalid");
      expect((await createAgreement(phoneKey().pub, { customer_phone: "+447700900123" }, "k-uk-idem-key")).json.error.code).toBe("phone_invalid");
    });

    it("takes the partner's test numbers", async () => {
      db.store.set(`api_partners/${RIDY}`, { ...db.get(`api_partners/${RIDY}`)!, testPhoneNumbers: ["+447700900123"] });
      expect((await createAgreement(phoneKey().pub, { customer_phone: "+447700900123" }, "k-uk-2-idem-key")).statusCode).toBe(201);
    });
  });

  describe("approving in Zapp", () => {
    it("binds the customer and the partner's caps as they are now", async () => {
      const res = await createAgreement(phoneKey().pub);
      const shown = await getCall({ data: { agreementId: res.json.id }, auth: { uid: RIDER } });
      expect(shown.data).toMatchObject({ merchantName: "Ridy", status: "pending", deviceLabel: "iPhone 15", maxChargeUsdCents: 2_000 });

      const out = await approve(res.json.id);
      expect(out.data).toMatchObject({ status: "active", maxChargeUsdCents: 2_000, dailyUsdCents: 6_000 });
      expect(db.get(`api_agreements/${res.json.id}`)).toMatchObject({ status: "active", customerId: RIDER, maxChargeUsdCents: 2_000 });

      const seen = await request("GET", `/v1/agreements/${res.json.id}`);
      expect(seen.json).toMatchObject({ status: "active", max_charge: 2_000, daily_limit: 6_000 });

      // Raising the partner's caps later doesn't raise this agreement's.
      db.store.set(`api_partners/${RIDY}`, { ...db.get(`api_partners/${RIDY}`)!, agreementMaxChargeUsdCents: 9_000 });
      expect(db.get(`api_agreements/${res.json.id}`)!.maxChargeUsdCents).toBe(2_000);
    });

    it("needs the right PIN, the right customer, and the limits that were shown", async () => {
      const res = await createAgreement(phoneKey().pub);
      mockedPin.mockResolvedValueOnce(false);
      await expect(approve(res.json.id)).rejects.toThrow("Invalid PIN");
      await expect(approve(res.json.id, STRANGER)).rejects.toThrow("different customer");
      await expect(approve(res.json.id, RIDER, { expectedMaxChargeUsdCents: 5_000 })).rejects.toThrow("limits changed");
      expect(db.get(`api_agreements/${res.json.id}`)!.status).toBe("pending");
    });

    it("expires after 15 minutes", async () => {
      const res = await createAgreement(phoneKey().pub);
      db.store.set(`api_agreements/${res.json.id}`, {
        ...db.get(`api_agreements/${res.json.id}`)!,
        expiresAt: Timestamp.fromMillis(Date.now() - 1),
      });
      await expect(approve(res.json.id)).rejects.toThrow("expired");
      expect(db.get(`api_agreements/${res.json.id}`)!.status).toBe("expired");
    });

    it("replaces the customer's earlier agreement with the same partner", async () => {
      const first = await linked();
      const second = await createAgreement(phoneKey().pub, {}, "link-rider-2");
      await approve(second.json.id);
      expect(db.get(`api_agreements/${first.agreementId}`)).toMatchObject({ status: "revoked", revokedBy: "replaced" });
      expect(db.get(`api_agreements/${second.json.id}`)!.status).toBe("active");
    });

    it("refuses a test agreement in the app", async () => {
      const res = await createAgreement(phoneKey().pub, {}, "k-test-idem-key", TEST_KEY);
      await expect(approve(res.json.id)).rejects.toThrow("test request");
    });
  });

  describe("switching off", () => {
    it("lets the customer list and switch off their agreements, without a PIN", async () => {
      const { agreementId } = await linked();
      const list = await listCall({ data: {}, auth: { uid: RIDER } });
      expect(list.data).toHaveLength(1);
      expect(list.data[0]).toMatchObject({ agreementId, merchantName: "Ridy" });

      await expect(revokeCall({ data: { agreementId }, auth: { uid: STRANGER } })).rejects.toThrow();
      await revokeCall({ data: { agreementId }, auth: { uid: RIDER } });
      expect(db.get(`api_agreements/${agreementId}`)).toMatchObject({ status: "revoked", revokedBy: "customer" });
      await revokeCall({ data: { agreementId }, auth: { uid: RIDER } });
      expect((await listCall({ data: {}, auth: { uid: RIDER } })).data).toHaveLength(0);
    });

    it("lets the partner switch one off", async () => {
      const { agreementId } = await linked();
      const res = await request("POST", `/v1/agreements/${agreementId}/revoke`);
      expect(res.json.status).toBe("revoked");
      expect(db.get(`api_agreements/${agreementId}`)!.revokedBy).toBe("merchant");
      expect((await request("POST", `/v1/agreements/${agreementId}/revoke`)).statusCode).toBe(200);
    });
  });

  describe("paying a charge", () => {
    it("waits for the phone, then pays with its signature: same entry as a PIN payment", async () => {
      const { agreementId, phone } = await linked();
      const res = await charge(agreementId);
      expect(res.statusCode).toBe(201);
      expect(res.json).toMatchObject({ status: "pending", agreement: agreementId, auto_pay: { status: "requires_confirmation" } });
      expect(res.json.auto_pay.payload).toBe(`zapp-agreement-charge:v1:${res.json.id}:${agreementId}:30000:SLS`);
      // The rider is approving in Ridy: no second prompt from Zapp.
      expect(sendPushNotification).not.toHaveBeenCalled();

      const paid = await confirm(res.json.id, phone.sign(res.json.auto_pay.payload));
      expect(paid.statusCode).toBe(200);
      expect(paid.json).toMatchObject({ status: "succeeded", auto_pay: { status: "paid" } });
      expect(paid.json.auto_pay.payload).toBeUndefined();

      expect(db.get(`wallets/${RIDER}`)!.sls.balance).toBe(470_000);
      const entry = db.get(`journal_entries/apicharge_${res.json.id}`)!;
      expect(entry).toMatchObject({ type: "online_payment", currency: "SLS" });
      const row = db.get(`transactions/${paid.json.transaction_id}`)!;
      expect(row).toMatchObject({
        kind: "online_payment",
        participants: [RIDER, RIDY],
        journalEntryId: `apicharge_${res.json.id}`,
        approvedVia: "partner_device",
        apiAgreementId: agreementId,
      });
      expect(notifyPaymentSent).toHaveBeenCalledWith(RIDER, 30_000, "SLS", RIDY);

      const day = [...db.store.keys()].find((k) => k.startsWith(`api_agreements/${agreementId}/days/`))!;
      expect(db.get(day)).toEqual({ usdCents: 375, count: 1 });

      // Exactly one charge.succeeded.
      const before = { ...db.get(`api_charges/${res.json.id}`)!, status: "pending" } as any;
      expect(eventsForChange(res.json.id, before, db.get(`api_charges/${res.json.id}`) as any).map((e) => e.type)).toEqual(["charge.succeeded"]);

      // A retried confirm moves nothing.
      const again = await confirm(res.json.id, phone.sign(res.json.auto_pay.payload));
      expect(again.json.status).toBe("succeeded");
      expect(db.get(`wallets/${RIDER}`)!.sls.balance).toBe(470_000);
    });

    it("refuses another phone's signature, or one for another charge, and changes nothing", async () => {
      const { agreementId, phone } = await linked();
      const a = await charge(agreementId, {}, "ride-a-idem-key");
      const b = await charge(agreementId, {}, "ride-b-idem-key");
      const wrongPhone = await confirm(a.json.id, phoneKey().sign(a.json.auto_pay.payload));
      expect(wrongPhone.statusCode).toBe(402);
      expect(wrongPhone.json.error.code).toBe("signature_invalid");
      // Same agreement, same amount, other charge: a replayed signature.
      const replayed = await confirm(b.json.id, phone.sign(a.json.auto_pay.payload));
      expect(replayed.statusCode).toBe(402);
      expect(db.get(`api_charges/${b.json.id}`)!.status).toBe("pending");
      expect(db.get(`wallets/${RIDER}`)!.sls.balance).toBe(500_000);
      // The real one still works.
      expect((await confirm(b.json.id, phone.sign(b.json.auto_pay.payload))).json.status).toBe("succeeded");
    });

    it("falls back to Zapp after five bad signatures", async () => {
      const { agreementId } = await linked();
      const c = await charge(agreementId);
      const stranger = phoneKey();
      for (let i = 0; i < 4; i++) expect((await confirm(c.json.id, stranger.sign(c.json.auto_pay.payload))).statusCode).toBe(402);
      const fifth = await confirm(c.json.id, stranger.sign(c.json.auto_pay.payload));
      expect(fifth.statusCode).toBe(200);
      expect(fifth.json).toMatchObject({ status: "pending", auto_pay: { status: "declined" } });
      expect(sendPushNotification).toHaveBeenCalled();
    });

    it("sends a fare over the per-payment cap to Zapp at once", async () => {
      const { agreementId } = await linked();
      // $20 at 8,000 a dollar is 160,000 SLSH.
      const res = await charge(agreementId, { amount: 160_001 });
      expect(res.json).toMatchObject({ status: "pending", auto_pay: { status: "declined", declined_code: "over_charge_limit" } });
      expect(res.json.auto_pay.payload).toBeUndefined();
      expect(sendPushNotification).toHaveBeenCalledWith(RIDER, expect.anything(), expect.objectContaining({ chargeId: res.json.id }));
      expect((await confirm(res.json.id, "x")).json.error.code).toBe("charge_not_confirmable");
    });

    it("holds the daily cap", async () => {
      const { agreementId, phone } = await linked();
      // $60 a day: three $20 fares fit, the fourth does not.
      for (let i = 1; i <= 3; i++) {
        const c = await charge(agreementId, { amount: 160_000 }, `ride-day-${i}-idem-key`);
        expect((await confirm(c.json.id, phone.sign(c.json.auto_pay.payload))).json.status).toBe("succeeded");
      }
      const fourth = await charge(agreementId, { amount: 8_000 }, "ride-day-4");
      const res = await confirm(fourth.json.id, phone.sign(fourth.json.auto_pay.payload));
      expect(res.json).toMatchObject({ status: "pending", auto_pay: { status: "declined", declined_code: "over_daily_limit" } });
    });

    it("pays exactly one of two confirms racing for the last of the daily cap", async () => {
      const { agreementId, phone } = await linked();
      const day = `api_agreements/${agreementId}/days/`;
      const first = await charge(agreementId, { amount: 160_000 }, "race-0-idem-key");
      await confirm(first.json.id, phone.sign(first.json.auto_pay.payload));
      const key = [...db.store.keys()].find((k) => k.startsWith(day))!;
      db.store.set(key, { usdCents: 4_000, count: 2 });
      const a = await charge(agreementId, { amount: 120_000 }, "race-a-idem-key");
      const b = await charge(agreementId, { amount: 120_000 }, "race-b-idem-key");
      const [ra, rb] = await Promise.all([
        confirm(a.json.id, phone.sign(a.json.auto_pay.payload)),
        confirm(b.json.id, phone.sign(b.json.auto_pay.payload)),
      ]);
      expect([ra.json.status, rb.json.status].sort()).toEqual(["pending", "succeeded"]);
    });

    it("declines a short balance, and the customer can still pay in Zapp with the PIN", async () => {
      const { agreementId, phone } = await linked();
      db.store.set(`wallets/${RIDER}`, wallet(10_000, { sls: { balance: 1_000, totalSent: 0, totalReceived: 1_000 } }));
      const c = await charge(agreementId);
      const res = await confirm(c.json.id, phone.sign(c.json.auto_pay.payload));
      expect(res.json).toMatchObject({ status: "pending", auto_pay: { status: "declined", declined_code: "insufficient_balance" } });
      expect(db.get(`journal_entries/apicharge_${c.json.id}`)).toBeUndefined();

      db.store.set(`wallets/${RIDER}`, wallet(10_000, { sls: { balance: 100_000, totalSent: 0, totalReceived: 100_000 } }));
      const approveCharge = fft.wrap((await import("../api/approveApiCharge")).approveApiCharge);
      await approveCharge({ data: { chargeId: c.json.id, pin: "123456", expectedAmount: 30_000 }, auth: { uid: RIDER } });
      expect(db.get(`api_charges/${c.json.id}`)!.status).toBe("succeeded");
      // Paid by PIN: not counted against the agreement's day.
      expect([...db.store.keys()].some((k) => k.startsWith(`api_agreements/${agreementId}/days/`))).toBe(false);
      // A late confirm moves nothing.
      expect((await confirm(c.json.id, phone.sign(c.json.auto_pay.payload))).json.status).toBe("succeeded");
      expect(db.get(`wallets/${RIDER}`)!.sls.balance).toBe(70_000);
    });

    it("declines when the customer's own limits refuse it", async () => {
      const { agreementId, phone } = await linked();
      mockedLimits.mockRejectedValueOnce(new https.HttpsError("permission-denied", "Over your limit"));
      const c = await charge(agreementId);
      const res = await confirm(c.json.id, phone.sign(c.json.auto_pay.payload));
      expect(res.json.auto_pay).toMatchObject({ status: "declined", declined_code: "customer_limit" });
    });

    it("declines once the agreement is switched off, even mid-charge", async () => {
      const { agreementId, phone } = await linked();
      const c = await charge(agreementId);
      await revokeCall({ data: { agreementId }, auth: { uid: RIDER } });
      const res = await confirm(c.json.id, phone.sign(c.json.auto_pay.payload));
      expect(res.json.auto_pay).toMatchObject({ status: "declined", declined_code: "agreement_not_active" });
      const next = await charge(agreementId, {}, "ride-2-idem-key");
      expect(next.json.auto_pay).toMatchObject({ status: "declined", declined_code: "agreement_not_active" });
    });

    it("treats another partner's agreement, or another customer, as not usable", async () => {
      const { agreementId } = await linked();
      const theirs = await charge(agreementId, {}, "other-1-idem-key", OTHER_KEY);
      expect(theirs.json.auto_pay.declined_code).toBe("agreement_not_active");
      const wrongCustomer = await charge(agreementId, { customer_phone: STRANGER_PHONE }, "ride-x-idem-key");
      expect(wrongCustomer.json.auto_pay.declined_code).toBe("customer_mismatch");
    });

    it("needs the scope to charge on an agreement, and customer_phone", async () => {
      const { agreementId } = await linked();
      expect((await charge(agreementId, {}, "plain-1-idem-key", PLAIN_KEY)).json.error.code).toBe("agreements_not_enabled");
      expect((await charge(agreementId, { customer_phone: undefined }, "nophone-idem-key")).statusCode).toBe(400);
    });

    it("answers a retried create with the same charge and never pays it twice", async () => {
      const { agreementId, phone } = await linked();
      const first = await charge(agreementId);
      await confirm(first.json.id, phone.sign(first.json.auto_pay.payload));
      const again = await charge(agreementId);
      expect(again.json.id).toBe(first.json.id);
      expect(again.json.status).toBe("succeeded");
      expect(db.get(`wallets/${RIDER}`)!.sls.balance).toBe(470_000);
    });

    it("can be refunded like any charge", async () => {
      const { agreementId, phone } = await linked();
      const c = await charge(agreementId);
      await confirm(c.json.id, phone.sign(c.json.auto_pay.payload));
      db.store.set(`wallets/${RIDY}`, wallet(0, { sls: { balance: 100_000, totalSent: 0, totalReceived: 100_000 } }));
      const refund = await request("POST", `/v1/charges/${c.json.id}/refunds`, { body: { amount: 30_000 }, idem: "refund-1-idem-key" });
      expect(refund.statusCode).toBe(201);
      expect(db.get(`wallets/${RIDER}`)!.sls.balance).toBe(500_000);
    });
  });

  describe("test mode", () => {
    it("approves with the helper, and pays with a valid signature and no ledger entry", async () => {
      const phone = phoneKey();
      const created = await createAgreement(phone.pub, {}, "test-link-idem-key", TEST_KEY);
      const ok = await request("POST", `/v1/test_helpers/agreements/${created.json.id}/approve`, { key: TEST_KEY });
      expect(ok.json).toMatchObject({ status: "active", max_charge: 2_000, livemode: false });
      const c = await charge(created.json.id, {}, "test-ride-idem-key", TEST_KEY);
      expect(c.json.auto_pay.status).toBe("requires_confirmation");
      expect((await confirm(c.json.id, phoneKey().sign(c.json.auto_pay.payload), TEST_KEY)).statusCode).toBe(402);
      const paid = await confirm(c.json.id, phone.sign(c.json.auto_pay.payload), TEST_KEY);
      expect(paid.json).toMatchObject({ status: "succeeded", livemode: false });
      expect(db.get(`journal_entries/apicharge_${c.json.id}`)).toBeUndefined();
      expect(db.get(`wallets/${RIDER}`)!.sls.balance).toBe(500_000);
      // A live key can't use the helper.
      expect((await request("POST", `/v1/test_helpers/agreements/${created.json.id}/approve`)).statusCode).toBe(400);
    });
  });

  describe("partner settings", () => {
    const base = { transfersEnabled: true, maxTransferUsdCents: 10_000, dailyTransferUsdCents: 20_000, chargeFeeRate: null };
    it("validates linked-payment caps, and leaves them alone when an older console omits them", () => {
      expect(validatePartnerInput({ ...base })).not.toHaveProperty("agreementsEnabled");
      expect(validatePartnerInput({ ...base, agreementsEnabled: true, agreementMaxChargeUsdCents: 2_000, agreementDailyUsdCents: 6_000 }))
        .toMatchObject({ agreementsEnabled: true, agreementMaxChargeUsdCents: 2_000, agreementDailyUsdCents: 6_000 });
      expect(() => validatePartnerInput({ ...base, agreementsEnabled: true, agreementMaxChargeUsdCents: 7_000, agreementDailyUsdCents: 6_000 }))
        .toThrow("daily cap");
    });
  });
});
