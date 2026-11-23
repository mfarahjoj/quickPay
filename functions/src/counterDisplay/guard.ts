/**
 * The check every call from a counter display runs first.
 *
 * A tablet has no Firebase Auth identity (COUNTER_DISPLAY.md, "Why no Auth"):
 * `requireAuth` and the Firestore rules treat any signed-in user as someone
 * who may call most callables, so a tablet given an Auth user could reach far
 * more than the display endpoints. Instead it presents its id and secret on
 * every call, and only these endpoints accept them.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import { assertAccountActive } from "../utils/accountStatus";
import { enforceDisplayRateLimit } from "./rateLimit";
import { DISPLAY_ID, MERCHANT_DISPLAYS, MerchantDisplay, SECRET } from "./types";

/**
 * The Firebase web app id of the display site. When set, display endpoints
 * accept App Check tokens from that app only; otherwise a token minted for
 * the customer or merchant app would do. Empty in tests and the emulator.
 */
export const DISPLAY_WEB_APP_ID = defineString("DISPLAY_WEB_APP_ID", { default: "" });

const SECRET_MAX_ATTEMPTS = 10;
const SECRET_LOCK_MS = 15 * 60 * 1000;
const PER_DISPLAY_PER_MINUTE = 120;

export const MERCHANT_TYPES = ["merchant", "agent_merchant"];

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function sameDigest(a: string | null | undefined, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function configuredAppId(): string {
  try {
    return DISPLAY_WEB_APP_ID.value() || "";
  } catch {
    return "";
  }
}

/** Refuse App Check tokens from any app but the display site, once it is configured. */
export function requireDisplayApp(request: https.CallableRequest): void {
  const expected = configuredAppId();
  if (!expected) return;
  if (request.app?.appId !== expected) {
    throw new https.HttpsError("permission-denied", "This endpoint is for counter displays only.", {
      reason: "wrong_app",
    });
  }
}

function revoked(): https.HttpsError {
  return new https.HttpsError("permission-denied", "This screen is no longer linked to a shop.", {
    reason: "display_revoked",
  });
}

export interface DisplayCaller {
  displayId: string;
  display: MerchantDisplay;
  merchantId: string;
  merchant: admin.firestore.DocumentData;
}

/**
 * Who is calling: the display, the shop it belongs to, and that shop's user
 * doc. Throws `display_revoked` when the tablet should forget its link.
 */
export async function requireDisplay(
  request: https.CallableRequest<{ displayId?: unknown; secret?: unknown }>
): Promise<DisplayCaller> {
  requireDisplayApp(request);

  const displayId = request.data?.displayId;
  const secret = request.data?.secret;
  if (typeof displayId !== "string" || !DISPLAY_ID.test(displayId)) {
    throw new https.HttpsError("invalid-argument", "displayId is required");
  }
  if (typeof secret !== "string" || !SECRET.test(secret)) {
    throw new https.HttpsError("invalid-argument", "secret is required");
  }

  await enforceDisplayRateLimit(displayId, PER_DISPLAY_PER_MINUTE);

  const db = admin.firestore();
  const ref = db.collection(MERCHANT_DISPLAYS).doc(displayId);
  const snap = await ref.get();
  if (!snap.exists) throw revoked();
  const display = snap.data() as MerchantDisplay;
  if (display.status !== "active") throw revoked();

  const now = Date.now();
  const lockedUntil = display.secretLockedUntil?.toMillis?.() ?? 0;
  if (lockedUntil > now) {
    throw new https.HttpsError("resource-exhausted", "This screen is locked for a while. Try again later.", {
      reason: "display_locked",
      secondsLeft: Math.ceil((lockedUntil - now) / 1000),
    });
  }

  if (!sameDigest(display.secretSha256, sha256(secret))) {
    const attempts = (display.secretFailedAttempts ?? 0) + 1;
    const updates: Record<string, unknown> = {
      secretFailedAttempts: admin.firestore.FieldValue.increment(1),
    };
    if (attempts >= SECRET_MAX_ATTEMPTS) {
      updates.secretLockedUntil = admin.firestore.Timestamp.fromMillis(now + SECRET_LOCK_MS);
    }
    await ref.update(updates);
    throw revoked();
  }
  if (display.secretFailedAttempts) {
    await ref.update({ secretFailedAttempts: 0, secretLockedUntil: null });
  }

  const merchantSnap = await db.collection("users").doc(display.merchantId).get();
  const merchant = merchantSnap.data();
  if (!merchantSnap.exists || !merchant || !MERCHANT_TYPES.includes(merchant.accountType)) {
    throw revoked();
  }
  assertAccountActive(merchant);

  return { displayId, display, merchantId: display.merchantId, merchant };
}
