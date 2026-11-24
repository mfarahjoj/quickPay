import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/limits", () => ({
  enforcePerTransactionLimit: jest.fn().mockResolvedValue(undefined),
  enforceTransactionLimits: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { requireMerchantActor } from "../staff/access";
import { requirePortalViewer } from "../portal/viewer";
import { endSessions } from "../auth/sessions";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const { Timestamp } = admin.firestore;

const SHOP = "shop-1";
const OTHER_SHOP = "shop-2";
const HODAN = "staff-hodan";
const ABDI = "staff-abdi";
const CUSTOMER = "cust-1";

const grant = (staffUid: string, role: string, extra: Record<string, unknown> = {}) => ({
  merchantUid: SHOP,
  staffUid,
  role,
  status: "active",
  showCustomers: false,
  shopName: "Café Hargeisa",
  staffName: staffUid === HODAN ? "Hodan Ali" : "Abdi Warsame",
  staffPhone: "+252630000000",
  invitedAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...extra,
});

describe("staff access", () => {
  let invite: any, respond: any, update: any, remove: any, leave: any;
  let scan: any, charge: any, cancel: any;
  let start: any, approve: any, poll: any, getStore: any, getCustomers: any, listTx: any, listSessions: any;
  let restore: (() => void) | undefined;
  let authSpy: jest.SpyInstance;
  let db: FakeDb;
  const auth = {
    createCustomToken: jest.fn(async (uid: string, claims?: object) => `token:${uid}:${JSON.stringify(claims ?? {})}`),
    deleteUser: jest.fn(async () => undefined),
    revokeRefreshTokens: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const m = await import("../staff/manage");
    invite = test.wrap(m.staffInvite);
    respond = test.wrap(m.staffRespond);
    update = test.wrap(m.staffUpdate);
    remove = test.wrap(m.staffRemove);
    leave = test.wrap(m.staffLeave);
    scan = test.wrap((await import("../customer-qr/scanToken")).scanCustomerToken);
    charge = test.wrap((await import("../customer-qr/createPaymentRequest")).createPaymentRequest);
    cancel = test.wrap((await import("../customer-qr/cancelPayment")).cancelPaymentRequest);
    const login = await import("../portal/login");
    start = test.wrap(login.startPortalLogin);
    approve = test.wrap(login.approvePortalLogin);
    poll = test.wrap(login.pollPortalLogin);
    const data = await import("../portal/data");
    getStore = test.wrap(data.portalGetStore);
    getCustomers = test.wrap(data.portalGetCustomers);
    listTx = test.wrap(data.portalListTransactions);
    listSessions = test.wrap((await import("../portal/sessions")).listPortalSessions);
  });
  afterAll(() => test.cleanup());

  beforeEach(() => {
    mockedPin.mockReset().mockResolvedValue(true);
    (notifyUser as jest.Mock).mockClear();
    Object.values(auth).forEach((f) => f.mockClear());
    authSpy = jest.spyOn(admin, "auth").mockReturnValue(auth as any);
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
    authSpy.mockRestore();
  });

  const seed = (extra: Record<string, any> = {}) => {
    db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Café Owner", phoneNumber: "+252630000001" },
      [`merchantProfiles/${SHOP}`]: { businessName: "Café Hargeisa" },
      [`wallets/${SHOP}`]: { balance: 125000 },
      [`users/${OTHER_SHOP}`]: { accountType: "merchant", fullName: "Other", phoneNumber: "+252630000002" },
      [`users/${HODAN}`]: { accountType: "customer", fullName: "Hodan Ali", phoneNumber: "+252630000011" },
      [`users/${ABDI}`]: { accountType: "customer", fullName: "Abdi Warsame", phoneNumber: "+252630000012" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina Yusuf", phoneNumber: "+252630000009" },
      ...extra,
    });
    restore = useFakeFirestore(db);
  };
  const audits = () => [...db.store.entries()].filter(([p]) => p.startsWith("merchantStaffAudit/")).map(([, v]) => v);

  // ─── Granting ────────────────────────────────────────────────────────────

  it("gives no access until the shop invites with its PIN and the person accepts", async () => {
    seed();
    await expect(requireMerchantActor({ auth: { uid: HODAN } } as any, SHOP, "tables")).rejects.toMatchObject({
      details: { reason: "staff_access_denied" },
    });

    const out = await invite({ data: { phone: "063 000 0011", role: "cashier", pin: "135790" }, auth: { uid: SHOP } });
    expect(mockedPin).toHaveBeenCalledWith(SHOP, "135790");
    expect(out.data).toMatchObject({ staffUid: HODAN, role: "cashier", status: "invited", shopName: "Café Hargeisa" });
    expect(notifyUser).toHaveBeenCalledWith(HODAN, "staff", { key: "staff.invited", params: { shop: "Café Hargeisa" } }, { type: "staff" });

    // Invited is not granted.
    await expect(requireMerchantActor({ auth: { uid: HODAN } } as any, SHOP, "charge")).rejects.toMatchObject({
      details: { reason: "staff_access_denied" },
    });

    await respond({ data: { merchantId: SHOP, accept: true }, auth: { uid: HODAN } });
    const actor = await requireMerchantActor({ auth: { uid: HODAN } } as any, SHOP, "charge");
    expect(actor).toMatchObject({ merchantUid: SHOP, actorUid: HODAN, role: "cashier" });
    expect(audits().map((a) => a.action)).toEqual(["invited", "accepted"]);
  });

  it("refuses an invite without the right PIN, to the shop itself, to a business, or twice", async () => {
    seed({ [`merchantStaff/${SHOP}_${ABDI}`]: grant(ABDI, "waiter") });
    mockedPin.mockResolvedValueOnce(false);
    await expect(invite({ data: { phone: "0630000011", role: "waiter", pin: "000000" }, auth: { uid: SHOP } })).rejects.toThrow(/Invalid PIN/);
    await expect(invite({ data: { phone: "0630000001", role: "waiter", pin: "1" }, auth: { uid: SHOP } })).rejects.toMatchObject({
      details: { reason: "staff_self" },
    });
    await expect(invite({ data: { phone: "0630000002", role: "waiter", pin: "1" }, auth: { uid: SHOP } })).rejects.toMatchObject({
      details: { reason: "staff_not_customer" },
    });
    await expect(invite({ data: { phone: "0630000012", role: "waiter", pin: "1" }, auth: { uid: SHOP } })).rejects.toMatchObject({
      details: { reason: "staff_exists" },
    });
    await expect(invite({ data: { phone: "0630000099", role: "waiter", pin: "1" }, auth: { uid: SHOP } })).rejects.toMatchObject({
      details: { reason: "staff_no_account" },
    });
  });

  it("never lets staff manage staff", async () => {
    seed({ [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "manager") });
    await expect(invite({ data: { phone: "0630000012", role: "manager", pin: "1" }, auth: { uid: HODAN } })).rejects.toMatchObject({
      details: { reason: "staff_not_shop" },
    });
    await expect(remove({ data: { staffUid: HODAN }, auth: { uid: HODAN } })).rejects.toMatchObject({
      details: { reason: "staff_not_shop" },
    });
  });

  it("only gives each role its own capabilities", async () => {
    seed({
      [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "waiter"),
      [`merchantStaff/${SHOP}_${ABDI}`]: grant(ABDI, "manager"),
    });
    const as = (uid: string) => ({ auth: { uid } }) as any;
    await expect(requireMerchantActor(as(HODAN), SHOP, "tables")).resolves.toMatchObject({ role: "waiter" });
    await expect(requireMerchantActor(as(HODAN), SHOP, "charge")).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
    await expect(requireMerchantActor(as(HODAN), SHOP, "portal")).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
    await expect(requireMerchantActor(as(ABDI), SHOP, "portal")).resolves.toMatchObject({ role: "manager" });
    // A grant is for one shop only.
    await expect(requireMerchantActor(as(ABDI), OTHER_SHOP, "tables")).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
    // The shop itself, with or without naming itself.
    await expect(requireMerchantActor(as(SHOP), undefined, "portal")).resolves.toMatchObject({ role: "owner", merchantUid: SHOP });
    await expect(requireMerchantActor(as(SHOP), SHOP, "portal")).resolves.toMatchObject({ role: "owner" });
  });

  it("stops at once when removed, left, or when either account is frozen", async () => {
    seed({ [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "cashier") });
    const call = () => requireMerchantActor({ auth: { uid: HODAN } } as any, SHOP, "charge");
    await expect(call()).resolves.toBeTruthy();

    await db.doc(`users/${HODAN}`).update({ accountStatus: "frozen" });
    await expect(call()).rejects.toThrow();
    await db.doc(`users/${HODAN}`).update({ accountStatus: "active" });
    await db.doc(`users/${SHOP}`).update({ accountStatus: "frozen" });
    await expect(call()).rejects.toThrow();
    await db.doc(`users/${SHOP}`).update({ accountStatus: "active" });
    await expect(call()).resolves.toBeTruthy();

    await remove({ data: { staffUid: HODAN }, auth: { uid: SHOP } });
    await expect(call()).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
    expect(db.get(`merchantStaff/${SHOP}_${HODAN}`)).toMatchObject({ status: "revoked" });
    expect(notifyUser).toHaveBeenCalledWith(HODAN, "staff", { key: "staff.removed", params: { shop: "Café Hargeisa" } }, { type: "staff" });
    expect(audits().map((a) => a.action)).toEqual(["removed"]);
  });

  // ─── Counter charge ──────────────────────────────────────────────────────

  const scanned = (actor?: string) => ({
    customerId: CUSTOMER,
    status: "scanned",
    scannedBy: SHOP,
    ...(actor ? { scannedByActor: actor } : {}),
    scannedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
  });

  it("lets a cashier charge for the shop, recording who served", async () => {
    seed({
      [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "cashier"),
      ["customerTokens/tok1"]: scanned(HODAN),
    });
    const out = await charge({ data: { tokenId: "tok1", amount: 1250, currency: "USD", merchantId: SHOP }, auth: { uid: HODAN } });
    expect(out.data.status).toBe("pending");
    expect(db.get("paymentRequests/tok1")).toMatchObject({ merchantId: SHOP, raisedBy: HODAN, customerId: CUSTOMER, amount: 1250 });
  });

  it("won't let a staff member charge a colleague's or the shop's scan, or a waiter charge at all", async () => {
    seed({
      [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "cashier"),
      [`merchantStaff/${SHOP}_${ABDI}`]: grant(ABDI, "waiter"),
      ["customerTokens/tokHodan"]: scanned(HODAN),
      ["customerTokens/tokShop"]: scanned(),
    });
    await expect(
      charge({ data: { tokenId: "tokShop", amount: 100, currency: "USD", merchantId: SHOP }, auth: { uid: HODAN } })
    ).rejects.toThrow(/different merchant/);
    await expect(
      charge({ data: { tokenId: "tokHodan", amount: 100, currency: "USD" }, auth: { uid: SHOP } })
    ).rejects.toThrow(/different merchant/);
    await expect(
      charge({ data: { tokenId: "tokHodan", amount: 100, currency: "USD", merchantId: SHOP }, auth: { uid: ABDI } })
    ).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
  });

  it("never lets staff pay out cash from an agent's float", async () => {
    seed({
      [`users/${SHOP}`]: { accountType: "agent_merchant", fullName: "Agent Shop", phoneNumber: "+252630000001" },
      [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "manager"),
      ["customerTokens/tok1"]: scanned(HODAN),
    });
    await expect(
      charge({ data: { tokenId: "tok1", amount: 1000, currency: "USD", purpose: "cash_out", merchantId: SHOP }, auth: { uid: HODAN } })
    ).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
  });

  it("marks a staff scan as theirs and refuses their own code", async () => {
    seed({ [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "cashier") });
    const encryption = await import("../utils/encryption");
    const spy = jest.spyOn(encryption, "decrypt");
    db.doc("customerTokens/tok9").set({ customerId: CUSTOMER, status: "active", createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 60_000) });
    db.doc("customerTokens/tokSelf").set({ customerId: HODAN, status: "active", createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 60_000) });

    spy.mockReturnValueOnce(JSON.stringify({ id: "tok9", customerId: CUSTOMER }));
    await scan({ data: { tokenData: "x", merchantId: SHOP }, auth: { uid: HODAN } });
    expect(db.get("customerTokens/tok9")).toMatchObject({ status: "scanned", scannedBy: SHOP, scannedByActor: HODAN });

    spy.mockReturnValueOnce(JSON.stringify({ id: "tokSelf", customerId: HODAN }));
    await expect(scan({ data: { tokenData: "x", merchantId: SHOP }, auth: { uid: HODAN } })).rejects.toThrow(/own token/);
    spy.mockRestore();
  });

  it("lets staff cancel only their own charges, and the shop any", async () => {
    const pending = (raisedBy?: string) => ({
      merchantId: SHOP,
      customerId: CUSTOMER,
      tokenId: "t",
      amount: 100,
      currency: "USD",
      status: "pending",
      ...(raisedBy ? { raisedBy } : {}),
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    seed({
      [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "cashier"),
      [`merchantStaff/${SHOP}_${ABDI}`]: grant(ABDI, "cashier"),
      ["paymentRequests/r1"]: pending(HODAN),
      ["paymentRequests/r2"]: pending(HODAN),
      ["paymentRequests/r3"]: pending(),
    });
    await expect(cancel({ data: { requestId: "r1", merchantId: SHOP }, auth: { uid: ABDI } })).rejects.toThrow(/different merchant/);
    await expect(cancel({ data: { requestId: "r3", merchantId: SHOP }, auth: { uid: ABDI } })).rejects.toThrow(/different merchant/);
    await expect(cancel({ data: { requestId: "r1", merchantId: SHOP }, auth: { uid: HODAN } })).resolves.toMatchObject({ data: { status: "cancelled" } });
    await expect(cancel({ data: { requestId: "r2" }, auth: { uid: SHOP } })).resolves.toMatchObject({ data: { status: "cancelled" } });
  });

  // ─── Zapp Business on the web ────────────────────────────────────────────

  const staffSignIn = async (staffUid: string) => {
    const s = (await start({ data: {} })).data;
    await approve({ data: { loginId: s.loginId, code: s.code, pin: "246810", merchantId: SHOP }, auth: { uid: staffUid } });
    const p = (await poll({ data: { loginId: s.loginId, pollSecret: s.pollSecret } })).data;
    const sid = (p.token as string).split(":")[1].replace("portal_", "");
    return { sid, auth: { uid: `portal_${sid}`, token: { portal: true, portalFor: SHOP, portalSid: sid } } };
  };

  it("signs a manager in with their own PIN, without the balance, linked stores or customers", async () => {
    const sale = {
      type: "payment",
      fromUserId: CUSTOMER,
      toUserId: SHOP,
      participants: [CUSTOMER, SHOP],
      amount: 3300,
      feeCents: 33,
      netCents: 3267,
      currency: "USD",
      status: "completed",
      description: "QR Payment (Customer Token)",
      createdAt: Timestamp.fromMillis(1_000_000),
    };
    seed({
      [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "manager"),
      "transactions/t1": sale,
      // A feed written before names moved out of it.
      [`merchantStats/${SHOP}/live/recent`]: {
        items: [{ txId: "t1", type: "sale", currency: "USD", gross: 3300, net: 3267, atMs: 1, customerName: "Amina Y." }],
        updatedAtMs: 0,
      },
    });
    const { sid, auth: portal } = await staffSignIn(HODAN);
    expect(mockedPin).toHaveBeenCalledWith(HODAN, "246810");
    expect(db.get(`portalSessions/${sid}`)).toMatchObject({ merchantUid: SHOP, actorUid: HODAN, role: "manager", showCustomers: false });

    const store = (await getStore({ data: {}, auth: portal })).data;
    expect(store.stores[0].balances).toBeNull();
    expect(store.links).toBeNull();
    expect(store.viewer).toEqual({ role: "manager", canSeeCustomers: false, name: "Hodan Ali" });
    await expect(getCustomers({ data: { view: "top" }, auth: portal })).rejects.toMatchObject({
      details: { reason: "portal_customers_denied" },
    });
    // The sale, but not who paid.
    const tx = (await listTx({ data: {}, auth: portal })).data.transactions;
    expect(tx[0]).toMatchObject({ gross: 3300, net: 3267, counterpartyName: null });
    expect(JSON.stringify(tx)).not.toContain("Amina");
    // Nor in the live feed she reads: the names moved where she can't.
    expect(JSON.stringify(db.get(`merchantStats/${SHOP}/live/recent`))).not.toContain("Amina");
    expect(db.get(`merchantStats/${SHOP}/live/recentNames`)!.names).toEqual({ t1: "Amina Y." });

    // The shop sees who signed that computer in.
    const listed = (await listSessions({ data: {}, auth: { uid: SHOP } })).data.sessions;
    expect(listed[0].signedInBy).toEqual({ name: "Hodan Ali", role: "manager" });
  });

  it("refuses a cashier or waiter at the web sign-in", async () => {
    seed({ [`merchantStaff/${SHOP}_${ABDI}`]: grant(ABDI, "cashier") });
    const s = (await start({ data: {} })).data;
    await expect(
      approve({ data: { loginId: s.loginId, code: s.code, pin: "1", merchantId: SHOP }, auth: { uid: ABDI } })
    ).rejects.toMatchObject({ details: { reason: "staff_access_denied" } });
  });

  it("ends a manager's computers when the shop removes them or changes their access", async () => {
    seed({ [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "manager", { showCustomers: true }) });
    const first = await staffSignIn(HODAN);
    await expect(requirePortalViewer({ auth: first.auth } as any)).resolves.toMatchObject({ role: "manager", canSeeCustomers: true });

    await update({ data: { staffUid: HODAN, role: "manager", showCustomers: false, pin: "1" }, auth: { uid: SHOP } });
    expect(db.get(`portalSessions/${first.sid}`)).toMatchObject({ active: false });
    await expect(requirePortalViewer({ auth: first.auth } as any)).rejects.toMatchObject({ details: { reason: "portal_session_ended" } });

    const second = await staffSignIn(HODAN);
    await expect(requirePortalViewer({ auth: second.auth } as any)).resolves.toMatchObject({ canSeeCustomers: false });
    await remove({ data: { staffUid: HODAN }, auth: { uid: SHOP } });
    expect(db.get(`portalSessions/${second.sid}`)).toMatchObject({ active: false });
  });

  it("ends a manager's computers when their own sessions end (PIN change, freeze)", async () => {
    seed({ [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "manager") });
    const { sid } = await staffSignIn(HODAN);
    await endSessions(HODAN, { keepCaller: false });
    expect(db.get(`portalSessions/${sid}`)).toMatchObject({ active: false });
  });

  it("treats a session as ended if the grant goes, even before it's signed out", async () => {
    seed({ [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "manager") });
    const { auth: portal } = await staffSignIn(HODAN);
    await db.doc(`merchantStaff/${SHOP}_${HODAN}`).update({ status: "revoked" });
    await expect(requirePortalViewer({ auth: portal } as any)).rejects.toMatchObject({ details: { reason: "portal_session_ended" } });
  });

  it("lets a staff member leave, which ends their access", async () => {
    seed({ [`merchantStaff/${SHOP}_${HODAN}`]: grant(HODAN, "waiter") });
    await leave({ data: { merchantId: SHOP }, auth: { uid: HODAN } });
    await expect(requireMerchantActor({ auth: { uid: HODAN } } as any, SHOP, "tables")).rejects.toMatchObject({
      details: { reason: "staff_access_denied" },
    });
    expect(audits().map((a) => a.action)).toEqual(["left"]);
  });
});
