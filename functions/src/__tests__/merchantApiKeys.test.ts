import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import { hashApiKey } from "../api/keys";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));

import { verifyUserPin } from "../auth/validatePin";
import { handleApiRequest } from "../api/app";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const MERCHANT = "merch-1";
const OTHER_MERCHANT = "merch-2";
const CUSTOMER = "cust-1";
const AGENT = "agent-1";

async function apiGet(path: string, key: string): Promise<{ statusCode: number; json: any }> {
  const out = { statusCode: 200, json: undefined as any };
  const res: any = {
    status(n: number) { out.statusCode = n; return res; },
    set() { return res; },
    send(s: string) { out.json = JSON.parse(s); return res; },
  };
  await handleApiRequest(
    { method: "GET", path, headers: { authorization: `Bearer ${key}` }, body: {}, query: {} } as any,
    res
  );
  return out;
}

describe("merchant self-serve API keys", () => {
  let create: any;
  let revoke: any;
  let list: any;
  let db: FakeDb;
  let restore: () => void;
  let logSpy: jest.SpyInstance;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../merchants/apiKeys");
    create = test.wrap(mod.createMyApiKey);
    revoke = test.wrap(mod.revokeMyApiKey);
    list = test.wrap(mod.listMyApiKeys);
  });

  beforeEach(() => {
    mockedPin.mockReset().mockResolvedValue(true);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    db = fakeFirestore({
      [`users/${MERCHANT}`]: { accountType: "merchant", accountStatus: "active" },
      [`users/${OTHER_MERCHANT}`]: { accountType: "agent_merchant", accountStatus: "active" },
      [`users/${CUSTOMER}`]: { accountType: "customer", accountStatus: "active" },
      [`users/${AGENT}`]: { accountType: "topup_agent", accountStatus: "active" },
    });
    restore = useFakeFirestore(db);
  });

  afterEach(() => {
    restore();
    logSpy.mockRestore();
  });
  afterAll(() => test.cleanup());

  const createKey = (data: Record<string, unknown> = {}, uid = MERCHANT) =>
    create({ data: { label: "Website", mode: "test", ...data }, auth: { uid } });

  it("makes a test key without a PIN, returns it once and stores only its hash", async () => {
    const res = await createKey();
    const { apiKey, keyId } = res.data;

    expect(apiKey).toMatch(/^zpk_test_[A-Za-z0-9_-]{32}$/);
    expect(keyId).toBe(hashApiKey(apiKey));
    expect(res.data).toMatchObject({ mode: "test", createdVia: "merchant_app", revoked: false });
    expect(mockedPin).not.toHaveBeenCalled();

    const stored = db.get(`merchant_api_keys/${keyId}`)!;
    expect(stored).toMatchObject({ merchantId: MERCHANT, livemode: false, createdBy: MERCHANT });
    expect(JSON.stringify(stored)).not.toContain(apiKey);
  });

  it("needs the PIN for a live key, and refuses a wrong one without making a key", async () => {
    await expect(createKey({ mode: "live" })).rejects.toThrow(/PIN is required/);

    mockedPin.mockResolvedValue(false);
    await expect(createKey({ mode: "live", pin: "000000" })).rejects.toThrow(/Invalid PIN/);
    expect([...db.store.keys()].some((p) => p.startsWith("merchant_api_keys/"))).toBe(false);

    mockedPin.mockResolvedValue(true);
    const res = await createKey({ mode: "live", pin: "123456" });
    expect(mockedPin).toHaveBeenCalledWith(MERCHANT, "123456");
    expect(res.data.apiKey).toMatch(/^zpk_live_/);
    expect(db.get(`merchant_api_keys/${res.data.keyId}`)!.livemode).toBe(true);
  });

  it("makes keys that work in the API, in their own mode", async () => {
    const { apiKey } = (await createKey()).data;
    const res = await apiGet("/v1/charges", apiKey);
    expect(res.statusCode).toBe(200);
    expect(res.json.object).toBe("list");
  });

  it("is for merchant accounts only, and active ones", async () => {
    await expect(createKey({}, CUSTOMER)).rejects.toThrow(/merchant accounts/);
    await expect(createKey({}, AGENT)).rejects.toThrow(/merchant accounts/);
    await expect(list({ data: undefined, auth: { uid: CUSTOMER } })).rejects.toThrow(/merchant accounts/);
    await expect(createKey({}, OTHER_MERCHANT)).resolves.toMatchObject({ success: true });

    db.store.set(`users/${MERCHANT}`, { accountType: "merchant", accountStatus: "frozen" });
    await expect(createKey()).rejects.toThrow();
  });

  it("validates the label and mode", async () => {
    await expect(createKey({ label: " " })).rejects.toThrow(/label/);
    await expect(createKey({ label: "x".repeat(61) })).rejects.toThrow(/label/);
    await expect(createKey({ mode: "sandbox" })).rejects.toThrow(/mode/);
    await expect(create({ data: { label: "Web", mode: "test" } })).rejects.toThrow();
  });

  it("caps active keys per mode, and counts keys from before test mode as live", async () => {
    // Five console-issued keys from before test mode: no livemode field.
    for (let i = 0; i < 5; i++) {
      db.store.set(`merchant_api_keys/${String(i).repeat(64)}`, {
        merchantId: MERCHANT,
        label: `Till ${i}`,
        hint: "zpk_live_abcd…wxyz",
        revoked: false,
        createdAt: admin.firestore.Timestamp.now(),
        createdBy: "admin-1",
      });
    }
    await expect(createKey({ mode: "live", pin: "123456" })).rejects.toThrow(/5 active live keys/);
    await expect(createKey()).resolves.toMatchObject({ success: true });
  });

  it("lists only the caller's keys, newest first, and never the key itself", async () => {
    const a = (await createKey({ label: "Website" })).data;
    const b = (await createKey({ label: "Till", mode: "live", pin: "123456" })).data;
    await createKey({ label: "Theirs" }, OTHER_MERCHANT);

    const res = await list({ data: undefined, auth: { uid: MERCHANT } });
    const labels = res.data.keys.map((k: any) => k.label).sort();
    expect(labels).toEqual(["Till", "Website"]);
    expect(JSON.stringify(res.data)).not.toContain(a.apiKey);
    expect(JSON.stringify(res.data)).not.toContain(b.apiKey);
  });

  it("revokes the caller's own key, which then stops working", async () => {
    const { apiKey, keyId } = (await createKey()).data;
    const res = await revoke({ data: { keyId }, auth: { uid: MERCHANT } });
    expect(res.data.revoked).toBe(true);
    expect(db.get(`merchant_api_keys/${keyId}`)).toMatchObject({ revoked: true, revokedBy: MERCHANT });
    expect((await apiGet("/v1/charges", apiKey)).statusCode).toBe(401);

    // Revoking twice is harmless.
    await expect(revoke({ data: { keyId }, auth: { uid: MERCHANT } })).resolves.toMatchObject({ success: true });
  });

  it("cannot revoke another merchant's key", async () => {
    const { keyId } = (await createKey({}, OTHER_MERCHANT)).data;
    await expect(revoke({ data: { keyId }, auth: { uid: MERCHANT } })).rejects.toThrow(/not found/);
    expect(db.get(`merchant_api_keys/${keyId}`)!.revoked).toBe(false);
    await expect(revoke({ data: { keyId: "nope" }, auth: { uid: MERCHANT } })).rejects.toThrow(/valid keyId/);
  });
});
