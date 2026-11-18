/**
 * Zapp Business web sessions against the real Firestore rules
 * (MERCHANT_INSIGHTS.md, "Web sign-in"): with real session tokens from the
 * Auth emulator, a session reads its shop's figures and nothing else, never
 * another shop's, and nothing once it has ended.
 *
 *   firebase emulators:start --only auth,firestore --project demo-zapp
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     GCLOUD_PROJECT=demo-zapp npx jest portalRules.e2e
 *
 * Skipped by a plain `npm test`.
 */
import * as admin from "firebase-admin";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-zapp";
const FS = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const run = FS && AUTH ? describe : describe.skip;

const SHOP = "e2e-portal-shop";
const OTHER = "e2e-portal-other";
const SID = "ps_" + "e2e0".repeat(8);
const DAY = "2026-11-18";

run("portal session rules", () => {
  let db: FirebaseFirestore.Firestore;
  const base = () => `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/`;

  async function idToken(uid: string, claims: Record<string, unknown>): Promise<string> {
    const custom = await admin.auth().createCustomToken(uid, claims);
    const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    });
    return ((await r.json()) as { idToken: string }).idToken;
  }
  const read = async (token: string, path: string) => (await fetch(base() + path, { headers: { Authorization: `Bearer ${token}` } })).status;
  const write = async (token: string, path: string) =>
    (
      await fetch(base() + path, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { x: { stringValue: "y" } } }),
      })
    ).status;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
    db = admin.firestore();
    const now = Date.now();
    await Promise.all([
      db.doc(`portalSessions/${SID}`).set({
        merchantUid: SHOP,
        active: true,
        browser: "test",
        loginId: "pl_x",
        createdAt: admin.firestore.Timestamp.fromMillis(now),
        expiresAt: admin.firestore.Timestamp.fromMillis(now + 3600_000),
      }),
      db.doc(`merchantStats/${SHOP}/days/${DAY}`).set({ storeUid: SHOP }),
      db.doc(`merchantStats/${SHOP}/live/recent`).set({ items: [] }),
      db.doc(`merchantStats/${SHOP}/customers/c1`).set({ customerUid: "c1" }),
      db.doc(`merchantStats/${SHOP}/applied/t1`).set({ type: "sale" }),
      db.doc(`merchantStats/${OTHER}/days/${DAY}`).set({ storeUid: OTHER }),
      db.doc(`users/${SHOP}`).set({ accountType: "merchant" }),
      db.doc(`wallets/${SHOP}`).set({ balance: 100 }),
      db.doc("transactions/t1").set({ fromUserId: "c1", toUserId: SHOP, participants: ["c1", SHOP] }),
    ]);
  });

  it("reads its shop's figures and nothing else", async () => {
    const portal = await idToken(`portal_${SID}`, { portal: true, portalFor: SHOP, portalSid: SID });
    expect(await read(portal, `merchantStats/${SHOP}/days/${DAY}`)).toBe(200);
    expect(await read(portal, `merchantStats/${SHOP}/live/recent`)).toBe(200);
    expect(await read(portal, `merchantStats/${SHOP}/customers/c1`)).toBe(200);
    for (const path of [`users/${SHOP}`, `wallets/${SHOP}`, "transactions/t1", `portalSessions/${SID}`, `merchantStats/${SHOP}/applied/t1`, `merchantStats/${OTHER}/days/${DAY}`]) {
      expect([path, await read(portal, path)]).toEqual([path, 403]);
    }
    expect(await write(portal, `users/portal_${SID}/fcmTokens/t1`)).toBe(403);
    expect(await write(portal, `merchantStats/${SHOP}/days/${DAY}`)).toBe(403);
  });

  it("refuses claims that don't match the session, and the session once ended", async () => {
    const forged = await idToken(`portal_${SID}`, { portal: true, portalFor: OTHER, portalSid: SID });
    expect(await read(forged, `merchantStats/${OTHER}/days/${DAY}`)).toBe(403);
    const shop = await idToken(SHOP, {});
    expect(await read(shop, `merchantStats/${SHOP}/days/${DAY}`)).toBe(200);
    const portal = await idToken(`portal_${SID}`, { portal: true, portalFor: SHOP, portalSid: SID });
    await db.doc(`portalSessions/${SID}`).update({ active: false });
    expect(await read(portal, `merchantStats/${SHOP}/days/${DAY}`)).toBe(403);
  });
});
