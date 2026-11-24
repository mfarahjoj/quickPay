import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const mockedNotify = notifyUser as jest.MockedFunction<typeof notifyUser>;

const SHOP = "shop-1";
const LEGACY_SHOP = "shop-legacy";
const CUSTOMER = "cust-1";
const PURPOSE = "Payments on our website's checkout";

const adminAuth = (roles: string[] = ["ops"]) => ({
  uid: "admin-1",
  token: { admin: true, adminRoles: roles, email: "ops@zapp.example", auth_time: Math.floor(Date.now() / 1000) },
});

describe("live API access: shops ask, Zapp approves", () => {
  let request: any;
  let createKey: any;
  let listMine: any;
  let listRequests: any;
  let decide: any;
  let withdraw: any;
  let adminListKeys: any;
  let db: FakeDb;
  let restore: () => void;
  let logSpy: jest.SpyInstance;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mine = await import("../merchants/apiKeys");
    const ops = await import("../admin/liveAccess");
    const opsKeys = await import("../admin/apiKeys");
    request = test.wrap(mine.requestLiveApiAccess);
    createKey = test.wrap(mine.createMyApiKey);
    listMine = test.wrap(mine.listMyApiKeys);
    listRequests = test.wrap(ops.adminListLiveAccessRequests);
    decide = test.wrap(ops.adminDecideLiveAccess);
    withdraw = test.wrap(ops.adminWithdrawLiveAccess);
    adminListKeys = test.wrap(opsKeys.adminListApiKeys);
  });

  beforeEach(() => {
    mockedPin.mockReset().mockResolvedValue(true);
    mockedNotify.mockClear();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", accountStatus: "active", businessName: "Hargeisa Coffee" },
      [`users/${LEGACY_SHOP}`]: { accountType: "agent_merchant", accountStatus: "active" },
      [`users/${CUSTOMER}`]: { accountType: "customer", accountStatus: "active" },
      // A live key made before approvals existed.
      "merchant_api_keys/legacykey": {
        merchantId: LEGACY_SHOP,
        label: "Till",
        hint: "zpk_live_abcd…wxyz",
        livemode: true,
        revoked: false,
        createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86_400_000),
        createdBy: LEGACY_SHOP,
        createdVia: "merchant_app",
      },
    });
    restore = useFakeFirestore(db);
  });

  afterEach(() => {
    restore();
    logSpy.mockRestore();
  });
  afterAll(() => test.cleanup());

  const ask = (purpose = PURPOSE, uid = SHOP) => request({ data: { purpose }, auth: { uid } });
  const makeKey = (mode: "live" | "test", uid = SHOP) =>
    createKey({ data: { label: "Website", mode, pin: "123456" }, auth: { uid } });
  const decideAs = (decision: string, data: Record<string, unknown> = {}, auth: any = adminAuth()) =>
    decide({ data: { merchantId: SHOP, decision, reason: "Spoke to the owner and their developer", ...data }, auth });
  const audits = () => [...db.store.entries()].filter(([p]) => p.startsWith("admin_audit/")).map(([, v]) => v);

  it("refuses a live key until Zapp approves, before asking for the PIN; test keys stay free", async () => {
    await expect(makeKey("live")).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "live_access_required", status: "none" },
    });
    expect(mockedPin).not.toHaveBeenCalled();
    await expect(makeKey("test")).resolves.toMatchObject({ success: true });

    const mine = await listMine({ data: undefined, auth: { uid: SHOP } });
    expect(mine.data.liveAccess).toMatchObject({ status: "none", legacy: false });
  });

  it("takes a request with the shop's own words, from shops only", async () => {
    await expect(ask("too short")).rejects.toMatchObject({ details: { reason: "purpose_length" } });
    await expect(ask(PURPOSE, CUSTOMER)).rejects.toThrow(/merchant accounts/);

    const res = await ask(`  ${PURPOSE}\n  for card-free checkout  `);
    expect(res.data).toMatchObject({ status: "pending", purpose: `${PURPOSE} for card-free checkout` });
    expect(db.get(`api_live_access/${SHOP}`)).toMatchObject({ merchantId: SHOP, status: "pending" });
    await expect(makeKey("live")).rejects.toMatchObject({ details: { status: "pending" } });
  });

  it("keeps a waiting shop's place in the queue when it rewrites its request", async () => {
    await ask();
    const first = db.get(`api_live_access/${SHOP}`)!.requestedAt;
    await ask("Payments at our till system, from the POS vendor");
    const doc = db.get(`api_live_access/${SHOP}`)!;
    expect(doc.purpose).toBe("Payments at our till system, from the POS vendor");
    expect(doc.requestedAt).toBe(first);
  });

  it("lists waiting shops for ops, with who they are and whether they've started building", async () => {
    await makeKey("test");
    await ask();
    const res = await listRequests({ data: undefined, auth: adminAuth() });
    expect(res.data.requests).toEqual([
      expect.objectContaining({
        merchantId: SHOP,
        businessName: "Hargeisa Coffee",
        accountType: "merchant",
        status: "pending",
        purpose: PURPOSE,
        activeTestKeys: 1,
      }),
    ]);
    await expect(listRequests({ data: undefined, auth: { uid: SHOP, token: {} } })).rejects.toThrow(/Not authorized/);
  });

  it("approves once, audited, tells the shop, and then the owner can make live keys with the PIN", async () => {
    await ask();
    const res = await decideAs("approve");
    expect(res.data).toMatchObject({ status: "approved", note: null });
    expect(db.get(`api_live_access/${SHOP}`)).toMatchObject({ status: "approved", decidedBy: "admin-1" });
    expect(audits()).toEqual([
      expect.objectContaining({ action: "api_live_access.approve", target: { type: "api_live_access", id: SHOP } }),
    ]);
    expect(mockedNotify).toHaveBeenCalledWith(SHOP, "api_access", { key: "api.live_approved" }, { type: "api_access" });

    const key = await makeKey("live");
    expect(key.data.apiKey).toMatch(/^zpk_live_/);
    expect(mockedPin).toHaveBeenCalledWith(SHOP, "123456");

    // Only a waiting request can be decided.
    await expect(decideAs("approve")).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("needs ops or super, a recent sign-in and a reason", async () => {
    await ask();
    await expect(decideAs("approve", {}, adminAuth(["compliance"]))).rejects.toThrow(/Not authorized/);
    await expect(decideAs("approve", { reason: "" })).rejects.toThrow();
    const stale = adminAuth();
    stale.token.auth_time -= 60 * 60;
    await expect(decideAs("approve", {}, stale)).rejects.toThrow();
    expect(db.get(`api_live_access/${SHOP}`)!.status).toBe("pending");
  });

  it("declines with a message the shop sees, and the shop can ask again", async () => {
    await ask();
    await decideAs("decline", { note: "Call us so we can set this up with your developer" });
    const mine = await listMine({ data: undefined, auth: { uid: SHOP } });
    expect(mine.data.liveAccess).toMatchObject({
      status: "declined",
      note: "Call us so we can set this up with your developer",
    });
    expect(mockedNotify).toHaveBeenCalledWith(SHOP, "api_access", { key: "api.live_declined" }, { type: "api_access" });
    await expect(makeKey("live")).rejects.toMatchObject({ details: { status: "declined" } });

    await expect(ask()).resolves.toMatchObject({ data: { status: "pending", note: null } });
  });

  it("withdraws access and revokes only the live keys, at once", async () => {
    await ask();
    await decideAs("approve");
    const live = (await makeKey("live")).data;
    const testKey = (await makeKey("test")).data;

    const res = await withdraw({
      data: { merchantId: SHOP, reason: "Owner reported a leaked key", note: "Ask again when you're ready" },
      auth: adminAuth(),
    });
    expect(res.data).toMatchObject({ status: "withdrawn", revokedKeys: 1, note: "Ask again when you're ready" });
    expect(db.get(`merchant_api_keys/${live.keyId}`)).toMatchObject({ revoked: true, revokedBy: "admin-1" });
    expect(db.get(`merchant_api_keys/${testKey.keyId}`)!.revoked).toBe(false);
    expect(audits().map((a: any) => a.action)).toContain("api_live_access.withdraw");
    expect(mockedNotify).toHaveBeenCalledWith(SHOP, "api_access", { key: "api.live_withdrawn" }, { type: "api_access" });

    await expect(makeKey("live")).rejects.toMatchObject({ details: { status: "withdrawn" } });
    // Nothing left to withdraw.
    await expect(withdraw({ data: { merchantId: SHOP, reason: "Again, by mistake" }, auth: adminAuth() })).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("counts a shop that already held a live key as approved, and can still withdraw it", async () => {
    const mine = await listMine({ data: undefined, auth: { uid: LEGACY_SHOP } });
    expect(mine.data.liveAccess).toMatchObject({ status: "approved", legacy: true });
    await expect(makeKey("live", LEGACY_SHOP)).resolves.toMatchObject({ success: true });

    const ops = await adminListKeys({ data: { merchantId: LEGACY_SHOP }, auth: adminAuth() });
    expect(ops.data.liveAccess).toMatchObject({ status: "approved", legacy: true });

    const res = await withdraw({ data: { merchantId: LEGACY_SHOP, reason: "No longer integrating" }, auth: adminAuth() });
    expect(res.data).toMatchObject({ status: "withdrawn", revokedKeys: 2 });
    expect(db.get("merchant_api_keys/legacykey")!.revoked).toBe(true);
    await expect(makeKey("live", LEGACY_SHOP)).rejects.toMatchObject({ details: { status: "withdrawn" } });
  });
});
