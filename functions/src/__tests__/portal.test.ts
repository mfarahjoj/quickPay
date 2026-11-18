import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));

import { verifyUserPin } from "../auth/validatePin";
import { requireAuth, isPortalToken } from "../utils/validation";
import { requireAdmin } from "../admin/guard";
import { describeBrowser } from "../portal/login";
import { requirePortalViewer } from "../portal/viewer";
import { endAllPortalSessions, expirePortalSessionsNow } from "../portal/sessions";
import { isLapsedRegular, lapsedRegulars, monthlyValue } from "../merchantStats/customers";
import { CustomerStats } from "../merchantStats/types";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const { Timestamp } = admin.firestore;
const SHOP = "shop-1";
const OTHER_SHOP = "shop-2";
const HOUR = 3600_000;

/** A session's token as Firebase hands it to a callable. */
const portalAuth = (sid: string, shop = SHOP) => ({
  uid: `portal_${sid}`,
  token: { portal: true, portalFor: shop, portalSid: sid },
});

describe("portal identity is refused everywhere but the portal", () => {
  it("requireAuth turns a portal session away", () => {
    expect(() => requireAuth({ auth: { uid: "portal_ps_x", token: { portal: true } } } as any)).toThrow(/only view figures/);
    expect(() => requireAuth({ auth: { uid: SHOP, token: {} } } as any)).not.toThrow();
    expect(isPortalToken({ portal: "true" })).toBe(false);
  });

  it("requireAdmin turns it away even with admin claims", () => {
    expect(() =>
      requireAdmin({ auth: { uid: "portal_ps_x", token: { portal: true, admin: true, adminRoles: ["super"] } } } as any)
    ).toThrow(/Not authorized/);
  });

  /**
   * Every callable runs one of the guards before anything else. A callable
   * reading request.auth without requireAuth would let a portal session in.
   * Source scan, as appCheckCoverage.test.ts does for App Check.
   */
  it("every callable goes through a guard that knows about portal sessions", () => {
    const SRC = path.join(__dirname, "..");
    const files = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "__tests__" ? [] : files(full);
        return e.name.endsWith(".ts") ? [full] : [];
      });
    // Guards, and the helpers that call one of them first.
    const GUARDS = /\b(requireAuth|requireAdmin|requirePortalViewer|requirePortalApp|requireShop|requireAgent|requireDisplayApp|requireDisplay|loadPairing)\(/;
    // Unauthenticated by design, and never reading request.auth: signing in
    // with a trusted phone's secret and the PIN.
    const NO_AUTH_BY_DESIGN = new Set(["loginWithPin"]);
    const unguarded: string[] = [];
    for (const file of files(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      const starts = [...text.matchAll(/onCall\(/g)].map((m) => m.index!);
      starts.forEach((at, i) => {
        const body = text.slice(at, starts[i + 1] ?? text.length);
        const name = [...text.slice(0, at).matchAll(/export const (\w+)\s*=/g)].pop()?.[1] ?? "";
        if (NO_AUTH_BY_DESIGN.has(name)) {
          const own = body.slice(0, body.search(/\nexport /) >>> 0);
          expect(own).not.toMatch(/request\.auth/);
          return;
        }
        if (!GUARDS.test(body)) unguarded.push(`${path.relative(SRC, file)}:${text.slice(0, at).split("\n").length} ${name}`);
      });
    }
    expect(unguarded).toEqual([]);
  });
});

describe("describeBrowser", () => {
  it("names the browser and the system", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
    expect(describeBrowser(mac)).toBe("Chrome on macOS");
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("Edge on Windows");
    expect(describeBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(describeBrowser("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0")).toBe("Firefox on Linux");
    expect(describeBrowser(undefined)).toBe("A web browser");
  });
});

describe("signing a computer in with the phone", () => {
  let start: any, describeLogin: any, approve: any, poll: any, list: any, revoke: any;
  let getStore: any, getCustomers: any, getCustomer: any, listTx: any, exportCsv: any;
  let restoreDb: (() => void) | undefined;
  let authSpy: jest.SpyInstance;
  const auth = {
    createCustomToken: jest.fn(async (uid: string, claims: object) => `token:${uid}:${JSON.stringify(claims)}`),
    deleteUser: jest.fn(async () => undefined),
    revokeRefreshTokens: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const login = await import("../portal/login");
    const sessions = await import("../portal/sessions");
    const data = await import("../portal/data");
    start = test.wrap(login.startPortalLogin);
    describeLogin = test.wrap(login.describePortalLogin);
    approve = test.wrap(login.approvePortalLogin);
    poll = test.wrap(login.pollPortalLogin);
    list = test.wrap(sessions.listPortalSessions);
    revoke = test.wrap(sessions.revokePortalSession);
    getStore = test.wrap(data.portalGetStore);
    getCustomers = test.wrap(data.portalGetCustomers);
    getCustomer = test.wrap(data.portalGetCustomer);
    listTx = test.wrap(data.portalListTransactions);
    exportCsv = test.wrap(data.portalExportStatement);
  });

  beforeEach(() => {
    mockedPin.mockReset().mockResolvedValue(true);
    Object.values(auth).forEach((f) => f.mockClear());
    authSpy = jest.spyOn(admin, "auth").mockReturnValue(auth as any);
  });

  afterEach(() => {
    restoreDb?.();
    restoreDb = undefined;
    authSpy.mockRestore();
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali", phoneNumber: "+252630000001" },
      [`merchantProfiles/${SHOP}`]: { businessName: "Hodan's Shop", area: "Jigjiga Yar", autoPayout: { enabled: false } },
      [`wallets/${SHOP}`]: { balance: 125000, sls: { balance: 300000 } },
      [`users/${OTHER_SHOP}`]: { accountType: "agent_merchant", fullName: "Other Shop" },
      ["users/cust-1"]: { accountType: "customer", fullName: "Amina Yusuf", phoneNumber: "+252630000009" },
      ...extra,
    });
    restoreDb = useFakeFirestore(db);
    return db;
  };

  /** The browser starts, the shop scans and approves: the browser's token. */
  const signIn = async (shop = SHOP) => {
    const s = (await start({ data: {} })).data;
    await approve({ data: { loginId: s.loginId, code: s.code, pin: "135790" }, auth: { uid: shop } });
    const p = (await poll({ data: { loginId: s.loginId, pollSecret: s.pollSecret } })).data;
    return { start: s, poll: p, sid: (p.token as string).split(":")[1].replace("portal_", "") };
  };

  it("signs a browser in end to end, as a separate read-only user", async () => {
    const db = seed();
    const s = (await start({ data: {} })).data;
    expect(s.loginId).toMatch(/^pl_[0-9a-f]{24}$/);
    expect(s.code).not.toEqual(s.pollSecret);
    // Nothing stored that would let a reader of the doc act as the browser or phone.
    const stored = db.get(`portalLogins/${s.loginId}`)!;
    expect(JSON.stringify(stored)).not.toContain(s.code);
    expect(JSON.stringify(stored)).not.toContain(s.pollSecret);

    await expect(poll({ data: { loginId: s.loginId, pollSecret: s.pollSecret } })).resolves.toMatchObject({
      data: { status: "waiting" },
    });
    await expect(describeLogin({ data: { loginId: s.loginId, code: s.code }, auth: { uid: SHOP } })).resolves.toMatchObject({
      data: { browser: "A web browser" },
    });
    const ok = await approve({ data: { loginId: s.loginId, code: s.code, pin: "135790" }, auth: { uid: SHOP } });
    expect(ok.data.status).toBe("approved");
    expect(mockedPin).toHaveBeenCalledWith(SHOP, "135790");

    const p = (await poll({ data: { loginId: s.loginId, pollSecret: s.pollSecret } })).data;
    expect(p).toMatchObject({ status: "approved", merchantName: "Hodan's Shop" });
    const sid = ok.data.sessionId;
    expect(auth.createCustomToken).toHaveBeenCalledWith(`portal_${sid}`, { portal: true, portalFor: SHOP, portalSid: sid });
    expect(db.get(`portalSessions/${sid}`)).toMatchObject({ merchantUid: SHOP, active: true });
    // 12 hours by default.
    const session = db.get(`portalSessions/${sid}`)!;
    expect(session.expiresAt.toMillis() - session.createdAt.toMillis()).toBe(12 * HOUR);

    // A lost reply: polling again in the window hands the token over again.
    await expect(poll({ data: { loginId: s.loginId, pollSecret: s.pollSecret } })).resolves.toMatchObject({
      data: { status: "approved" },
    });
  });

  it("needs the QR's code to approve and the browser's secret to collect", async () => {
    seed();
    const s = (await start({ data: {} })).data;
    const wrong = "0".repeat(32);
    await expect(approve({ data: { loginId: s.loginId, code: wrong, pin: "1" }, auth: { uid: SHOP } })).rejects.toMatchObject({
      details: { reason: "portal_login_not_found" },
    });
    // Someone holding a photo of the QR can approve it, but can't collect the sign-in.
    await approve({ data: { loginId: s.loginId, code: s.code, pin: "1" }, auth: { uid: SHOP } });
    await expect(poll({ data: { loginId: s.loginId, pollSecret: s.code } })).rejects.toMatchObject({
      details: { reason: "portal_login_not_found" },
    });
    // And a used code can't be approved again.
    await expect(approve({ data: { loginId: s.loginId, code: s.code, pin: "1" }, auth: { uid: SHOP } })).rejects.toMatchObject({
      details: { reason: "portal_login_not_found" },
    });
  });

  it("refuses customers, a wrong PIN, and expired codes", async () => {
    const db = seed();
    const s = (await start({ data: {} })).data;
    await expect(approve({ data: { loginId: s.loginId, code: s.code, pin: "1" }, auth: { uid: "cust-1" } })).rejects.toMatchObject({
      details: { reason: "portal_not_shop" },
    });
    mockedPin.mockResolvedValueOnce(false);
    await expect(approve({ data: { loginId: s.loginId, code: s.code, pin: "1" }, auth: { uid: SHOP } })).rejects.toThrow(/Invalid PIN/);

    const doc = db.get(`portalLogins/${s.loginId}`)!;
    db.store.set(`portalLogins/${s.loginId}`, { ...doc, expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    await expect(approve({ data: { loginId: s.loginId, code: s.code, pin: "1" }, auth: { uid: SHOP } })).rejects.toMatchObject({
      details: { reason: "portal_login_not_found" },
    });
    await expect(poll({ data: { loginId: s.loginId, pollSecret: s.pollSecret } })).resolves.toMatchObject({ data: { status: "expired" } });
  });

  it("lets the shop say no", async () => {
    seed();
    const s = (await start({ data: {} })).data;
    await approve({ data: { loginId: s.loginId, code: s.code, decline: true }, auth: { uid: SHOP } });
    expect(mockedPin).not.toHaveBeenCalled();
    await expect(poll({ data: { loginId: s.loginId, pollSecret: s.pollSecret } })).resolves.toMatchObject({ data: { status: "declined" } });
  });

  it("lists and signs out computers from the phone, and lets a computer sign itself out", async () => {
    const db = seed();
    const a = await signIn();
    const b = await signIn();
    const listed = (await list({ data: {}, auth: { uid: SHOP } })).data.sessions;
    expect(listed.map((x: any) => x.sessionId).sort()).toEqual([a.sid, b.sid].sort());

    await revoke({ data: { sessionId: a.sid }, auth: { uid: SHOP } });
    expect(db.get(`portalSessions/${a.sid}`)).toMatchObject({ active: false, endReason: "revoked" });
    expect(auth.deleteUser).toHaveBeenCalledWith(`portal_${a.sid}`);

    // Another shop can't sign this one's computers out.
    await expect(revoke({ data: { sessionId: b.sid }, auth: { uid: OTHER_SHOP } })).rejects.toMatchObject({
      details: { reason: "portal_session_not_found" },
    });
    // The computer signs itself out (and only itself).
    await revoke({ data: { sessionId: a.sid }, auth: portalAuth(b.sid) });
    expect(db.get(`portalSessions/${b.sid}`)).toMatchObject({ active: false, endReason: "signed_out" });
  });

  it("keeps at most five computers signed in, ending the oldest", async () => {
    const db = seed();
    const sids: string[] = [];
    for (let i = 0; i < 6; i++) {
      sids.push((await signIn()).sid);
      // Distinct creation times.
      const doc = db.get(`portalSessions/${sids[i]}`)!;
      db.store.set(`portalSessions/${sids[i]}`, { ...doc, createdAt: Timestamp.fromMillis(1000 + i) });
    }
    // The limit ran after each approval; the first one was replaced.
    const active = sids.filter((sid) => db.get(`portalSessions/${sid}`)!.active);
    expect(active).toEqual(sids.slice(1));
    expect(db.get(`portalSessions/${sids[0]}`)).toMatchObject({ active: false, endReason: "replaced" });
  });

  it("ends every computer when the shop's security changes, and expires old ones", async () => {
    const db = seed();
    const a = await signIn();
    const b = await signIn();
    await expect(endAllPortalSessions(SHOP)).resolves.toBe(2);
    expect(db.get(`portalSessions/${a.sid}`)).toMatchObject({ active: false, endReason: "security" });

    const c = await signIn();
    const doc = db.get(`portalSessions/${c.sid}`)!;
    db.store.set(`portalSessions/${c.sid}`, { ...doc, expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    await expect(expirePortalSessionsNow()).resolves.toBe(1);
    expect(db.get(`portalSessions/${c.sid}`)).toMatchObject({ active: false, endReason: "expired" });
    expect(b.sid).toBeTruthy();
  });

  describe("requirePortalViewer", () => {
    it("honours a live session for its own shop only", async () => {
      const db = seed();
      const { sid } = await signIn();
      const viewer = await requirePortalViewer({ auth: portalAuth(sid) } as any, SHOP);
      expect(viewer).toMatchObject({ merchantUid: SHOP, storeUids: [SHOP] });

      await expect(requirePortalViewer({ auth: portalAuth(sid) } as any, OTHER_SHOP)).rejects.toMatchObject({
        details: { reason: "portal_store_denied" },
      });
      // A token whose claims name another shop than its session.
      await expect(requirePortalViewer({ auth: portalAuth(sid, OTHER_SHOP) } as any)).rejects.toMatchObject({
        details: { reason: "portal_session_ended" },
      });
      // A real user's token is not a portal session.
      await expect(requirePortalViewer({ auth: { uid: SHOP, token: {} } } as any)).rejects.toMatchObject({
        details: { reason: "portal_signin_required" },
      });
      // Ended: refused at once, even though its ID token still has up to an hour.
      await endAllPortalSessions(SHOP, "revoked");
      await expect(requirePortalViewer({ auth: portalAuth(sid) } as any)).rejects.toMatchObject({
        details: { reason: "portal_session_ended" },
      });
      expect(db.get(`portalSessions/${sid}`)!.active).toBe(false);
    });
  });

  describe("dashboard data", () => {
    const customer = (uid: string, over: Partial<CustomerStats>): CustomerStats => ({
      customerUid: uid,
      firstSeenAtMs: 0,
      firstSeenDay: "2026-09-01",
      lastSeenAtMs: 0,
      lastSeenDay: "2026-09-01",
      visits: 1,
      visitDays: 1,
      spend: { USD: 1000 },
      refunded: {},
      usualGapDays: null,
      spendUSD: 1000,
      spendSLS: 0,
      updatedAtMs: 0,
      ...over,
    });

    it("shows the shop with balances and no phone numbers anywhere", async () => {
      seed({
        "transactions/t1": {
          type: "payment",
          kind: "merchant_payment",
          fromUserId: "cust-1",
          toUserId: SHOP,
          participants: ["cust-1", SHOP],
          amount: 1000,
          feeCents: 10,
          netCents: 990,
          currency: "USD",
          status: "completed",
          description: "QR payment",
          createdAt: Timestamp.fromMillis(1_000_000),
        },
      });
      const { sid } = await signIn();
      const store = (await getStore({ data: {}, auth: portalAuth(sid) })).data;
      expect(store.stores[0]).toMatchObject({
        storeUid: SHOP,
        name: "Hodan's Shop",
        area: "Jigjiga Yar",
        autoPayout: false,
        balances: { USD: 125000, SLS: 300000 },
      });
      const tx = (await listTx({ data: {}, auth: portalAuth(sid) })).data;
      expect(tx.transactions[0]).toMatchObject({ incoming: true, net: 990, counterpartyName: "Amina Yusuf", kind: "merchant_payment" });
      expect(JSON.stringify([store, tx])).not.toContain("+252");

      const csv = (await exportCsv({ data: { fromMs: 0, toMs: 2_000_000 }, auth: portalAuth(sid) })).data;
      expect(csv.totals).toMatchObject({ inCents: 990, feeCents: 10, count: 1 });
      // The app's own token can't use the portal callables, nor the other way round.
      await expect(getStore({ data: {}, auth: { uid: SHOP, token: {} } })).rejects.toMatchObject({
        details: { reason: "portal_signin_required" },
      });
    });

    it("lists top, new and gone-quiet customers with names", async () => {
      const now = Date.now();
      const day = (msAgo: number) => new Date(now - msAgo + 3 * HOUR).toISOString().slice(0, 10);
      seed({
        [`merchantStats/${SHOP}/customers/cust-1`]: customer("cust-1", {
          visits: 8,
          visitDays: 6,
          usualGapDays: 4,
          spend: { USD: 9000 },
          spendUSD: 9000,
          lastSeenAtMs: now - 30 * 24 * HOUR,
          lastSeenDay: day(30 * 24 * HOUR),
        }),
        [`merchantStats/${SHOP}/customers/cust-2`]: customer("cust-2", {
          spend: { USD: 500 },
          spendUSD: 500,
          firstSeenDay: day(HOUR),
          lastSeenAtMs: now - HOUR,
          lastSeenDay: day(HOUR),
        }),
        ["users/cust-2"]: { fullName: "Bashir Omar" },
      });
      const { sid } = await signIn();
      const top = (await getCustomers({ data: { view: "top" }, auth: portalAuth(sid) })).data.customers;
      expect(top.map((c: any) => c.name)).toEqual(["Amina Yusuf", "Bashir Omar"]);
      const fresh = (await getCustomers({ data: { view: "new" }, auth: portalAuth(sid) })).data.customers;
      expect(fresh.map((c: any) => c.customerUid)).toEqual(["cust-2"]);
      const lapsed = (await getCustomers({ data: { view: "lapsed" }, auth: portalAuth(sid) })).data.customers;
      expect(lapsed).toHaveLength(1);
      expect(lapsed[0]).toMatchObject({ customerUid: "cust-1", daysSinceLastVisit: 30, lapseThresholdDays: 14 });
      expect(lapsed[0].monthlyValue.USD).toBe(11250); // 1500 a visit day, every 4 days

      const one = (await getCustomer({ data: { customerUid: "cust-1" }, auth: portalAuth(sid) })).data;
      expect(one.customer).toMatchObject({ name: "Amina Yusuf", visits: 8 });
      await expect(getCustomer({ data: { customerUid: "nobody" }, auth: portalAuth(sid) })).rejects.toMatchObject({
        details: { reason: "customer_not_found" },
      });
    });
  });
});

describe("regulars who have gone quiet", () => {
  const c = (over: Partial<CustomerStats>): CustomerStats => ({
    customerUid: "c",
    firstSeenAtMs: 0,
    firstSeenDay: "2026-08-01",
    lastSeenAtMs: 0,
    lastSeenDay: "2026-11-01",
    visits: 6,
    visitDays: 5,
    spend: { USD: 5000 },
    refunded: {},
    usualGapDays: 3,
    spendUSD: 5000,
    spendSLS: 0,
    updatedAtMs: 0,
    ...over,
  });

  it("needs three visit days and an absence past the larger of 14 days and twice their gap", () => {
    expect(isLapsedRegular(c({}), "2026-11-16")).toBe(true); // 15 days, gap 3
    expect(isLapsedRegular(c({}), "2026-11-14")).toBe(false); // 13 days
    expect(isLapsedRegular(c({ visitDays: 2 }), "2026-11-30")).toBe(false);
    expect(isLapsedRegular(c({ usualGapDays: 10 }), "2026-11-20")).toBe(false); // 19 < 20
    expect(isLapsedRegular(c({ usualGapDays: 10 }), "2026-11-22")).toBe(true);
  });

  it("puts the most valuable first", () => {
    const big = c({ customerUid: "big", spend: { USD: 20000 } });
    const small = c({ customerUid: "small" });
    expect(lapsedRegulars([small, big], "2026-11-30").map((x) => x.customerUid)).toEqual(["big", "small"]);
    expect(monthlyValue(c({ spend: { USD: 5000 }, visitDays: 5, usualGapDays: 3 }), "USD")).toBe(10000);
    expect(monthlyValue(c({ spend: {} }), "SLS")).toBe(0);
  });
});
