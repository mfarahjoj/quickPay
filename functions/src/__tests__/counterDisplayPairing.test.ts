import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));

import { verifyUserPin } from "../auth/validatePin";
import { sha256 } from "../counterDisplay/guard";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const { Timestamp } = admin.firestore;
const SHOP = "merchant-1";
const OTHER_SHOP = "merchant-2";

/**
 * Linking a counter tablet to a shop: the tablet shows a code, the cashier
 * claims it from the merchant app with their PIN, and someone at the counter
 * confirms the shop's name on the tablet. Until then the tablet has nothing
 * to show and no way to act for the shop.
 */
describe("counter display pairing", () => {
  let start: any;
  let link: any;
  let poll: any;
  let confirm: any;
  let heartbeat: any;
  let list: any;
  let unlink: any;
  let rename: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const pairing = await import("../counterDisplay/pairing");
    const manage = await import("../counterDisplay/manage");
    start = test.wrap(pairing.startDisplayPairing);
    link = test.wrap(pairing.linkDisplay);
    poll = test.wrap(pairing.pollDisplayPairing);
    confirm = test.wrap(pairing.confirmDisplayPairing);
    heartbeat = test.wrap((await import("../counterDisplay/heartbeat")).displayHeartbeat);
    list = test.wrap(manage.listMyDisplays);
    unlink = test.wrap(manage.unlinkDisplay);
    rename = test.wrap(manage.renameDisplay);
  });

  beforeEach(() => {
    mockedPin.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali", preferredLanguage: "so" },
      [`merchantProfiles/${SHOP}`]: { businessName: "Hodan's Shop", businessAddress: "26 June Road" },
      [`users/${OTHER_SHOP}`]: { accountType: "agent_merchant", fullName: "Other Shop" },
      ["users/cust-1"]: { accountType: "customer", fullName: "Amina Yusuf" },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const startPairing = async () => (await start({ data: {} })).data;

  /** Start, claim and confirm: the tablet's credentials. */
  const pairFully = async (merchant = SHOP) => {
    const p = await startPairing();
    await link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357", name: "Front counter" }, auth: { uid: merchant } });
    const res = await confirm({ data: { pairingId: p.pairingId, pairingSecret: p.pairingSecret, accept: true } });
    return { pairing: p, creds: res.data };
  };

  it("links a tablet end to end, and shows the shop's My QR", async () => {
    const db = seed();
    const p = await startPairing();
    expect(p.pairingId).toMatch(/^dp_[a-f0-9]{24}$/);
    expect(p.code).toMatch(/^[0-9]{8}$/);
    expect(p.pairingSecret).toMatch(/^[a-f0-9]{64}$/);
    // Only a hash of the tablet's secret is stored.
    expect(JSON.stringify(db.get(`displayPairings/${p.pairingId}`))).not.toContain(p.pairingSecret);

    expect((await poll({ data: { pairingId: p.pairingId, pairingSecret: p.pairingSecret } })).data.status).toBe("waiting");

    const linked = await link({
      data: { pairingId: p.pairingId, code: p.code, pin: "1357", name: "Front counter" },
      auth: { uid: SHOP },
    });
    expect(linked.data).toMatchObject({ name: "Front counter", merchantName: "Hodan's Shop" });
    expect(mockedPin).toHaveBeenCalledWith(SHOP, "1357");

    const polled = (await poll({ data: { pairingId: p.pairingId, pairingSecret: p.pairingSecret } })).data;
    expect(polled).toMatchObject({ status: "claimed", merchantName: "Hodan's Shop" });

    // Claimed but not confirmed: no state doc, nothing on screen.
    const pending = db.get(`merchantDisplays/${linked.data.displayId}`)!;
    expect(pending).toMatchObject({ status: "pending_confirm", secretSha256: null, stateKey: null });
    expect([...db.store.keys()].some((k) => k.startsWith("counterDisplayStates/"))).toBe(false);

    const res = (await confirm({ data: { pairingId: p.pairingId, pairingSecret: p.pairingSecret, accept: true } })).data;
    expect(res).toMatchObject({ status: "completed", displayId: linked.data.displayId, merchantName: "Hodan's Shop" });
    expect(res.displaySecret).toMatch(/^[a-f0-9]{64}$/);
    expect(res.stateKey).toMatch(/^[a-f0-9]{64}$/);

    const display = db.get(`merchantDisplays/${res.displayId}`)!;
    expect(display).toMatchObject({ status: "active", stateKey: res.stateKey, merchantId: SHOP });
    expect(display.secretSha256).toBe(sha256(res.displaySecret));
    expect(JSON.stringify(display)).not.toContain(res.displaySecret);

    const state = db.get(`counterDisplayStates/${res.stateKey}`)!;
    expect(state).toMatchObject({ v: 1, mode: "idle", merchantName: "Hodan's Shop", lang: "so" });
    expect(JSON.parse(state.idleQr)).toEqual({
      type: "quickpay_merchant",
      merchantId: SHOP,
      merchantName: "Hodan's Shop",
      address: "26 June Road",
    });

    // The tablet can now call in.
    const hb = (await heartbeat({ data: { displayId: res.displayId, secret: res.displaySecret, appBuild: "abc123" } })).data;
    expect(typeof hb.serverNowMs).toBe("number");
    expect(db.get(`merchantDisplays/${res.displayId}`)!.appBuild).toBe("abc123");
  });

  it("finds the tablet by its typed code when the QR wasn't scanned", async () => {
    seed();
    const p = await startPairing();
    const linked = await link({ data: { code: p.code, pin: "1357" }, auth: { uid: SHOP } });
    expect(linked.data.name).toBe("Counter display");
  });

  it("refuses a wrong PIN", async () => {
    seed();
    mockedPin.mockResolvedValue(false);
    const p = await startPairing();
    await expect(
      link({ data: { pairingId: p.pairingId, code: p.code, pin: "0000" }, auth: { uid: SHOP } })
    ).rejects.toMatchObject({ code: "permission-denied", message: "Invalid PIN" });
  });

  it("locks the shop out after five wrong codes, and a right code resets the count", async () => {
    const db = seed();
    const p = await startPairing();
    const wrong = p.code === "00000000" ? "00000001" : "00000000";
    for (let i = 0; i < 4; i++) {
      await expect(link({ data: { code: wrong, pin: "1357" }, auth: { uid: SHOP } })).rejects.toMatchObject({
        code: "not-found",
      });
    }
    await link({ data: { code: p.code, pin: "1357" }, auth: { uid: SHOP } });
    expect(db.get(`users/${SHOP}`)!.displayLinkFailedAttempts).toBe(0);

    for (let i = 0; i < 5; i++) {
      await expect(link({ data: { code: wrong, pin: "1357" }, auth: { uid: SHOP } })).rejects.toBeDefined();
    }
    await expect(link({ data: { code: wrong, pin: "1357" }, auth: { uid: SHOP } })).rejects.toMatchObject({
      code: "resource-exhausted",
      details: { reason: "display_code_attempts" },
    });
  });

  it("only lets shops link a display", async () => {
    seed();
    const p = await startPairing();
    await expect(
      link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" }, auth: { uid: "cust-1" } })
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" } })).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("refuses a frozen shop", async () => {
    seed({ [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali", accountStatus: "frozen" } });
    const p = await startPairing();
    await expect(
      link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" }, auth: { uid: SHOP } })
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("allows three active displays per shop", async () => {
    const extra: Record<string, any> = {};
    for (let i = 0; i < 3; i++) {
      extra[`merchantDisplays/cd_${String(i).repeat(24)}`] = { merchantId: SHOP, status: "active", stateKey: null };
    }
    seed(extra);
    const p = await startPairing();
    await expect(
      link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" }, auth: { uid: SHOP } })
    ).rejects.toMatchObject({ code: "resource-exhausted", details: { reason: "display_limit" } });
  });

  it("won't link with a code that has run out", async () => {
    const db = seed();
    const p = await startPairing();
    db.store.set(`displayPairings/${p.pairingId}`, {
      ...db.get(`displayPairings/${p.pairingId}`)!,
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
    });
    await expect(
      link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" }, auth: { uid: SHOP } })
    ).rejects.toMatchObject({ code: "not-found" });
    expect((await poll({ data: { pairingId: p.pairingId, pairingSecret: p.pairingSecret } })).data.status).toBe(
      "expired"
    );
  });

  it("can't be claimed twice: a second shop is refused", async () => {
    seed();
    const p = await startPairing();
    await link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" }, auth: { uid: OTHER_SHOP } });
    await expect(
      link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" }, auth: { uid: SHOP } })
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("lets the person at the counter decline a shop they don't recognise", async () => {
    const db = seed();
    const p = await startPairing();
    const linked = await link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" }, auth: { uid: OTHER_SHOP } });
    const res = await confirm({ data: { pairingId: p.pairingId, pairingSecret: p.pairingSecret, accept: false } });
    expect(res.data.status).toBe("declined");
    expect(db.get(`merchantDisplays/${linked.data.displayId}`)).toBeUndefined();
    expect(db.get(`displayPairings/${p.pairingId}`)!.status).toBe("declined");
    await expect(
      confirm({ data: { pairingId: p.pairingId, pairingSecret: p.pairingSecret, accept: true } })
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("needs the pairing secret: knowing the code isn't enough to confirm", async () => {
    seed();
    const p = await startPairing();
    await link({ data: { pairingId: p.pairingId, code: p.code, pin: "1357" }, auth: { uid: SHOP } });
    await expect(
      confirm({ data: { pairingId: p.pairingId, pairingSecret: "f".repeat(64), accept: true } })
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("issues fresh credentials when the first confirm's reply was lost", async () => {
    const db = seed();
    const { pairing, creds: first } = await pairFully();
    const second = (await confirm({ data: { pairingId: pairing.pairingId, pairingSecret: pairing.pairingSecret, accept: true } })).data;
    expect(second.displayId).toBe(first.displayId);
    expect(second.displaySecret).not.toBe(first.displaySecret);
    expect(second.stateKey).not.toBe(first.stateKey);
    expect(db.get(`counterDisplayStates/${first.stateKey}`)).toBeUndefined();
    expect(db.get(`counterDisplayStates/${second.stateKey}`)).toBeDefined();

    await expect(heartbeat({ data: { displayId: first.displayId, secret: first.displaySecret } })).rejects.toMatchObject({
      details: { reason: "display_revoked" },
    });
    await heartbeat({ data: { displayId: second.displayId, secret: second.displaySecret } });
  });

  it("lists, renames and unlinks displays for their own shop only", async () => {
    const db = seed();
    const { creds } = await pairFully();
    await heartbeat({ data: { displayId: creds.displayId, secret: creds.displaySecret } });

    const listed = (await list({ data: {}, auth: { uid: SHOP } })).data.displays;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ displayId: creds.displayId, name: "Front counter", status: "active", online: true });
    expect(JSON.stringify(listed)).not.toMatch(/secret|stateKey/i);
    expect((await list({ data: {}, auth: { uid: OTHER_SHOP } })).data.displays).toHaveLength(0);

    await rename({ data: { displayId: creds.displayId, name: "  Till 1 " }, auth: { uid: SHOP } });
    expect(db.get(`merchantDisplays/${creds.displayId}`)!.name).toBe("Till 1");
    await expect(
      rename({ data: { displayId: creds.displayId, name: "Mine" }, auth: { uid: OTHER_SHOP } })
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(unlink({ data: { displayId: creds.displayId }, auth: { uid: OTHER_SHOP } })).rejects.toMatchObject({
      code: "not-found",
    });

    await unlink({ data: { displayId: creds.displayId }, auth: { uid: SHOP } });
    expect(db.get(`merchantDisplays/${creds.displayId}`)).toMatchObject({ status: "revoked", secretSha256: null, stateKey: null });
    expect(db.get(`counterDisplayStates/${creds.stateKey}`)).toBeUndefined();
    await expect(heartbeat({ data: { displayId: creds.displayId, secret: creds.displaySecret } })).rejects.toMatchObject({
      details: { reason: "display_revoked" },
    });
  });

  it("locks a display out after ten wrong secrets", async () => {
    const db = seed();
    const { creds } = await pairFully();
    for (let i = 0; i < 10; i++) {
      await expect(heartbeat({ data: { displayId: creds.displayId, secret: "e".repeat(64) } })).rejects.toBeDefined();
    }
    expect(db.get(`merchantDisplays/${creds.displayId}`)!.secretLockedUntil).toBeDefined();
    await expect(heartbeat({ data: { displayId: creds.displayId, secret: creds.displaySecret } })).rejects.toMatchObject({
      code: "resource-exhausted",
      details: { reason: "display_locked" },
    });
  });

  it("stops working when the shop is frozen", async () => {
    const db = seed();
    const { creds } = await pairFully();
    db.store.set(`users/${SHOP}`, { ...db.get(`users/${SHOP}`)!, accountStatus: "frozen" });
    await expect(heartbeat({ data: { displayId: creds.displayId, secret: creds.displaySecret } })).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("revokes every display when the shop's account is deleted", async () => {
    const db = seed();
    const { creds } = await pairFully();
    const { revokeAllDisplays } = await import("../counterDisplay/manage");
    expect(await revokeAllDisplays(SHOP)).toBe(1);
    expect(db.get(`merchantDisplays/${creds.displayId}`)!.status).toBe("revoked");
    expect(db.get(`counterDisplayStates/${creds.stateKey}`)).toBeUndefined();
  });

  describe("only the display site may call", () => {
    const original = process.env.DISPLAY_WEB_APP_ID;
    afterEach(() => {
      if (original === undefined) delete process.env.DISPLAY_WEB_APP_ID;
      else process.env.DISPLAY_WEB_APP_ID = original;
    });

    it("refuses another app's App Check token once the display app id is set", async () => {
      seed();
      process.env.DISPLAY_WEB_APP_ID = "1:123:web:display";
      await expect(start({ data: {}, app: { appId: "1:123:ios:customer" } })).rejects.toMatchObject({
        code: "permission-denied",
        details: { reason: "wrong_app" },
      });
      const ok = await start({ data: {}, app: { appId: "1:123:web:display" } });
      expect(ok.data.pairingId).toBeDefined();
    });
  });
});

describe("display rate limit", () => {
  it("allows the limit within a minute and refuses the next", async () => {
    if (!admin.apps.length) admin.initializeApp();
    const db = fakeFirestore();
    const restore = useFakeFirestore(db);
    try {
      const { enforceDisplayRateLimit } = await import("../counterDisplay/rateLimit");
      const now = 1_800_000_000_000;
      await enforceDisplayRateLimit("cd_x", 2, now);
      await enforceDisplayRateLimit("cd_x", 2, now + 1);
      await expect(enforceDisplayRateLimit("cd_x", 2, now + 2)).rejects.toMatchObject({ code: "resource-exhausted" });
      // A new minute starts a new window.
      await enforceDisplayRateLimit("cd_x", 2, now + 60_000);
    } finally {
      restore();
    }
  });
});
