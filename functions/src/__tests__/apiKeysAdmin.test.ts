import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import { hashApiKey } from "../api/keys";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn().mockResolvedValue(true) }));

const MERCHANT = "merch-1";
const CUSTOMER = "cust-1";

const adminAuth = (roles: string[] = ["ops"]) => ({
  uid: "admin-1",
  token: {
    admin: true,
    adminRoles: roles,
    email: "ops@zapp.example",
    auth_time: Math.floor(Date.now() / 1000),
  },
});

describe("admin API key callables", () => {
  let issue: any;
  let revoke: any;
  let list: any;
  let db: FakeDb;
  let restore: () => void;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../admin/apiKeys");
    issue = test.wrap(mod.adminIssueApiKey);
    revoke = test.wrap(mod.adminRevokeApiKey);
    list = test.wrap(mod.adminListApiKeys);
  });

  beforeEach(() => {
    db = fakeFirestore({
      [`users/${MERCHANT}`]: { accountType: "merchant", accountStatus: "active" },
      [`users/${CUSTOMER}`]: { accountType: "customer", accountStatus: "active" },
    });
    restore = useFakeFirestore(db);
  });

  afterEach(() => restore());
  afterAll(() => test.cleanup());

  const issueKey = (data: Record<string, unknown> = {}, auth: any = adminAuth()) =>
    issue({ data: { merchantId: MERCHANT, label: "Website", reason: "Onboarding their online shop", ...data }, auth });

  it("returns the key once and stores only its hash, with an audit entry", async () => {
    const res = await issueKey();
    const { apiKey, keyId } = res.data;

    expect(apiKey).toMatch(/^zpk_live_[A-Za-z0-9_-]{32}$/);
    expect(keyId).toBe(hashApiKey(apiKey));
    const stored = db.get(`merchant_api_keys/${keyId}`)!;
    expect(stored).toMatchObject({ merchantId: MERCHANT, label: "Website", revoked: false, createdBy: "admin-1" });
    expect(JSON.stringify(stored)).not.toContain(apiKey);

    const audit = [...db.store.entries()].find(([p]) => p.startsWith("admin_audit/"))![1];
    expect(audit).toMatchObject({ action: "api_key.issue", target: { type: "api_key", id: keyId } });
    expect(JSON.stringify(audit)).not.toContain(apiKey);
  });

  it("only issues keys to active merchant accounts", async () => {
    await expect(issueKey({ merchantId: CUSTOMER })).rejects.toThrow(/merchant accounts/);
    db.store.set(`users/${MERCHANT}`, { accountType: "merchant", accountStatus: "frozen" });
    await expect(issueKey()).rejects.toThrow(/not active/);
  });

  it("needs an ops admin with a recent sign-in and a reason", async () => {
    await expect(issueKey({}, adminAuth(["compliance"]))).rejects.toThrow(/Not authorized/);
    await expect(issueKey({}, { uid: "u", token: {} })).rejects.toThrow(/Not authorized/);
    const stale = adminAuth();
    stale.token.auth_time -= 3600;
    await expect(issueKey({}, stale)).rejects.toThrow(/Recent sign-in/);
    await expect(issueKey({ reason: "x" })).rejects.toThrow(/reason/);
  });

  it("revokes a key and lists it as revoked", async () => {
    const { keyId } = (await issueKey()).data;

    const res = await revoke({ data: { keyId, reason: "Merchant reported a leak" }, auth: adminAuth() });
    expect(res.data.revoked).toBe(true);
    expect(db.get(`merchant_api_keys/${keyId}`)).toMatchObject({ revoked: true, revokedBy: "admin-1" });

    const listed = await list({ data: { merchantId: MERCHANT }, auth: adminAuth() });
    expect(listed.data.keys).toEqual([expect.objectContaining({ keyId, revoked: true })]);
  });
});

describe("refundPayment and API payments", () => {
  let refund: any;
  let restore: () => void;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    refund = test.wrap((await import("../qr-payments/refundPayment")).refundPayment);
  });

  afterEach(() => restore());

  it("refuses an in-app refund of a payment taken through the API", async () => {
    const db = fakeFirestore({
      "transactions/tx-1": {
        type: "payment",
        fromUserId: CUSTOMER,
        toUserId: MERCHANT,
        amount: 5000,
        status: "completed",
        apiChargeId: "ch_abcdefghijklmnopqrstuvwx",
      },
    });
    restore = useFakeFirestore(db);
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      refund({ data: { transactionId: "tx-1", pin: "123456" }, auth: { uid: MERCHANT } })
    ).rejects.toThrow(/taken online/);
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
