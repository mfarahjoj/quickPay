/**
 * Signing a computer in to Zapp Business by scanning a QR with the phone.
 *
 *   browser  startPortalLogin    → a login id, a code for the QR, and a poll
 *                                  secret that never leaves the browser
 *   phone    describePortalLogin → the shop scans the QR; sees "Chrome on macOS"
 *   phone    approvePortalLogin  → the shop enters the PIN; a session is created
 *   browser  pollPortalLogin     → sees "approved" and gets a custom token for
 *                                  `portal_{sessionId}`, a read-only identity
 *
 * Why it is safe to sign a browser in this way:
 * - The session is not the shop's own Firebase user. requireAuth and
 *   requireAdmin refuse its token, and the rules give it nothing but the
 *   shop's insights docs, so it can view figures and never move money.
 * - The code in the QR approves; only the poll secret collects the token. A
 *   photo of the QR is no use to anyone but the browser that showed it.
 * - The phone shows which browser is asking and says to approve only a
 *   computer in front of you, now. A phishing page that relays a real QR
 *   ("QR-login jacking") still gets only the read-only view, until the shop
 *   signs it out in Settings → Zapp Business, or a PIN change ends it.
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { https } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import { verifyUserPin } from "../auth/validatePin";
import { getRates } from "../config/rates";
import { MERCHANT_TYPES, sameDigest, sha256 } from "../counterDisplay/guard";
import { callerIpKey, enforceDisplayRateLimit } from "../counterDisplay/rateLimit";
import { shopName } from "../counterDisplay/state";
import { assertAccountActive } from "../utils/accountStatus";
import { generateSecureId } from "../utils/encryption";
import { requireAuth } from "../utils/validation";
import { requireMerchantActor, staffDenied } from "../staff/access";
import { grantId, MERCHANT_STAFF, StaffGrant } from "../staff/types";
import { moveLegacyFeedNames } from "../merchantStats/apply";
import { enforceSessionLimit } from "./sessions";
import {
  LOGIN_CLEANUP_MS,
  LOGIN_ID,
  LOGIN_SECRET,
  LOGIN_TTL_MS,
  PORTAL_LOGINS,
  PORTAL_SESSIONS,
  PortalClaims,
  PortalLogin,
  PortalSession,
  portalUid,
} from "./types";

/**
 * The Firebase web app id of the Zapp Business site. When set, the
 * unauthenticated sign-in endpoints accept App Check tokens from that app
 * only. Empty in tests and the emulator.
 */
export const PORTAL_WEB_APP_ID = defineString("PORTAL_WEB_APP_ID", { default: "" });

const START_PER_IP_PER_MINUTE = 10;
const POLL_PER_LOGIN_PER_MINUTE = 60;
/** After approval, how long the browser may still collect its token. */
const COLLECT_GRACE_MS = 2 * 60 * 1000;

function requirePortalApp(request: https.CallableRequest): void {
  let expected = "";
  try {
    expected = PORTAL_WEB_APP_ID.value() || "";
  } catch {
    expected = "";
  }
  if (expected && request.app?.appId !== expected) {
    throw new https.HttpsError("permission-denied", "This endpoint is for Zapp Business on the web.", { reason: "wrong_app" });
  }
}

/** "Chrome on macOS" from a User-Agent. Pure; shown to the shop before they approve. */
export function describeBrowser(userAgent: unknown): string {
  const ua = typeof userAgent === "string" ? userAgent : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Mac OS X|Macintosh/.test(ua)
              ? "macOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "A web browser";
}

function loginNotFound(): https.HttpsError {
  return new https.HttpsError("not-found", "That sign-in code has run out. Refresh the page on the computer and scan again.", {
    reason: "portal_login_not_found",
  });
}

function validId(value: unknown): string {
  if (typeof value !== "string" || !LOGIN_ID.test(value)) {
    throw new https.HttpsError("invalid-argument", "That isn't a Zapp Business sign-in code.", { reason: "portal_login_invalid" });
  }
  return value;
}

function validSecret(value: unknown, what: string): string {
  if (typeof value !== "string" || !LOGIN_SECRET.test(value)) {
    throw new https.HttpsError("invalid-argument", `${what} is required`, { reason: "portal_login_invalid" });
  }
  return value;
}

// ─── Browser: start ────────────────────────────────────────────────────────

export const startPortalLogin = https.onCall({ enforceAppCheck: true }, async (request) => {
  requirePortalApp(request);
  await enforceDisplayRateLimit(callerIpKey(request), START_PER_IP_PER_MINUTE);

  const loginId = `pl_${generateSecureId(12)}`;
  const pollSecret = generateSecureId(16);
  const code = generateSecureId(16);
  const now = Date.now();
  const login: PortalLogin = {
    pollSecretSha256: sha256(pollSecret),
    codeSha256: sha256(code),
    status: "waiting",
    browser: describeBrowser(request.rawRequest?.headers?.["user-agent"]),
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + LOGIN_TTL_MS),
    expireAt: Timestamp.fromMillis(now + LOGIN_CLEANUP_MS),
  };
  await admin.firestore().collection(PORTAL_LOGINS).doc(loginId).create(login);
  return { success: true, data: { loginId, code, pollSecret, expiresAtMs: now + LOGIN_TTL_MS, serverNowMs: now } };
});

// ─── Phone: look, then approve ─────────────────────────────────────────────

/**
 * Who is approving: the shop itself, or (with `merchantId`) a staff manager
 * for that shop (STAFF_ACCESS.md). `uid` is the shop either way; `staff` is
 * set for a staff member, whose own PIN approves.
 */
async function requireShop(request: https.CallableRequest<{ merchantId?: unknown }>) {
  requireAuth(request);
  const callerUid = request.auth!.uid;
  const merchantId = request.data?.merchantId;
  let staff: { uid: string; name: string; showCustomers: boolean } | undefined;
  let uid = callerUid;
  if (merchantId !== undefined && merchantId !== callerUid) {
    const actor = await requireMerchantActor(request, merchantId, "portal");
    uid = actor.merchantUid;
    staff = { uid: callerUid, name: actor.grant!.staffName, showCustomers: actor.grant!.showCustomers === true };
  }
  const userSnap = await admin.firestore().collection("users").doc(uid).get();
  const user = userSnap.data();
  if (!userSnap.exists || !MERCHANT_TYPES.includes(user?.accountType)) {
    throw new https.HttpsError("permission-denied", "Zapp Business is for shops.", { reason: "portal_not_shop" });
  }
  assertAccountActive(user);
  return { uid, user, staff };
}

/** A waiting login whose code matches, or not-found. */
async function waitingLogin(loginId: string, code: string) {
  const ref = admin.firestore().collection(PORTAL_LOGINS).doc(loginId);
  const snap = await ref.get();
  const login = snap.data() as PortalLogin | undefined;
  if (!snap.exists || !login || !sameDigest(login.codeSha256, sha256(code))) throw loginNotFound();
  if (login.status !== "waiting" || login.expiresAt.toMillis() <= Date.now()) throw loginNotFound();
  return { ref, login };
}

export const describePortalLogin = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ loginId?: unknown; code?: unknown; merchantId?: unknown }>) => {
    await requireShop(request);
    const loginId = validId(request.data?.loginId);
    const code = validSecret(request.data?.code, "code");
    const { login } = await waitingLogin(loginId, code);
    return { success: true, data: { browser: login.browser, expiresAtMs: login.expiresAt.toMillis() } };
  }
);

export const approvePortalLogin = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ loginId?: unknown; code?: unknown; pin?: unknown; decline?: unknown; merchantId?: unknown }>
  ) => {
    const { uid, user, staff } = await requireShop(request);
    const loginId = validId(request.data?.loginId);
    const code = validSecret(request.data?.code, "code");
    const db = admin.firestore();
    const { ref } = await waitingLogin(loginId, code);

    if (request.data?.decline === true) {
      await ref.update({ status: "declined" });
      return { success: true, data: { status: "declined" } };
    }

    const pin = request.data?.pin;
    if (typeof pin !== "string" || !pin) throw new https.HttpsError("invalid-argument", "PIN is required");
    // A staff member approves with their own PIN; they never know the shop's.
    if (!(await verifyUserPin(staff?.uid ?? uid, pin))) throw new https.HttpsError("permission-denied", "Invalid PIN");

    // A manager who may not see customers reads the shop's live feed: make
    // sure no names from before they moved out of it are still there.
    if (staff && !staff.showCustomers) await moveLegacyFeedNames(db, uid);

    const profile = (await db.collection("merchantProfiles").doc(uid).get()).data();
    const merchantName = shopName(user, profile);
    const { portalSessionHours } = await getRates();
    const sessionId = `ps_${generateSecureId(16)}`;

    const expiresAtMs = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const login = snap.data() as PortalLogin | undefined;
      // Read with the session's creation, so a removal that lands now either
      // happens first (and this refuses) or finds the new session to end.
      const grantSnap = staff ? await tx.get(db.collection(MERCHANT_STAFF).doc(grantId(uid, staff.uid))) : null;
      const now = Date.now();
      if (grantSnap) {
        const grant = grantSnap.data() as StaffGrant | undefined;
        if (grant?.status !== "active" || grant.role !== "manager" || grant.showCustomers !== staff!.showCustomers) {
          throw staffDenied();
        }
      }
      if (!login || login.status !== "waiting" || login.expiresAt.toMillis() <= now || !sameDigest(login.codeSha256, sha256(code))) {
        throw loginNotFound();
      }
      const ends = now + portalSessionHours * 60 * 60 * 1000;
      const session: PortalSession = {
        merchantUid: uid,
        active: true,
        browser: login.browser,
        loginId,
        createdAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(ends),
        ...(staff ? { actorUid: staff.uid, actorName: staff.name, role: "manager" as const, showCustomers: staff.showCustomers } : {}),
      };
      tx.create(db.collection(PORTAL_SESSIONS).doc(sessionId), session);
      tx.update(ref, {
        status: "approved",
        merchantUid: uid,
        merchantName,
        sessionId,
        approvedAt: Timestamp.fromMillis(now),
      });
      return ends;
    });

    await enforceSessionLimit(uid);
    return { success: true, data: { status: "approved", sessionId, expiresAtMs } };
  }
);

// ─── Browser: wait, then collect the sign-in ───────────────────────────────

export const pollPortalLogin = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ loginId?: unknown; pollSecret?: unknown }>) => {
    requirePortalApp(request);
    const loginId = validId(request.data?.loginId);
    const pollSecret = validSecret(request.data?.pollSecret, "pollSecret");
    await enforceDisplayRateLimit(loginId, POLL_PER_LOGIN_PER_MINUTE);

    const db = admin.firestore();
    const ref = db.collection(PORTAL_LOGINS).doc(loginId);
    const snap = await ref.get();
    const login = snap.data() as PortalLogin | undefined;
    if (!snap.exists || !login || !sameDigest(login.pollSecretSha256, sha256(pollSecret))) throw loginNotFound();

    const now = Date.now();
    const base = { expiresAtMs: login.expiresAt.toMillis(), serverNowMs: now };
    if (login.status === "declined") return { success: true, data: { ...base, status: "declined" } };
    if (login.status === "waiting") {
      return { success: true, data: { ...base, status: login.expiresAt.toMillis() <= now ? "expired" : "waiting" } };
    }

    // Approved (or collected already, and the reply was lost): hand over a
    // token while the session lives and the collection window is open.
    const sessionId = login.sessionId;
    const merchantUid = login.merchantUid;
    if (!sessionId || !merchantUid || login.expiresAt.toMillis() + COLLECT_GRACE_MS <= now) {
      return { success: true, data: { ...base, status: "expired" } };
    }
    const session = (await db.collection(PORTAL_SESSIONS).doc(sessionId).get()).data() as PortalSession | undefined;
    if (!session?.active || session.expiresAt.toMillis() <= now) {
      return { success: true, data: { ...base, status: "expired" } };
    }
    const claims: PortalClaims = { portal: true, portalFor: merchantUid, portalSid: sessionId };
    const token = await admin.auth().createCustomToken(portalUid(sessionId), claims as unknown as Record<string, unknown>);
    if (login.status !== "completed") await ref.update({ status: "completed" });
    return {
      success: true,
      data: {
        ...base,
        status: "approved",
        token,
        merchantName: login.merchantName ?? null,
        sessionExpiresAtMs: session.expiresAt.toMillis(),
      },
    };
  }
);
