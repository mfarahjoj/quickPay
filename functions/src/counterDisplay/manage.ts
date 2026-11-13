/**
 * The shop managing its counter displays from the merchant app, and a
 * display signing itself out.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { requireDisplay } from "./guard";
import { DISPLAY_ID, DISPLAY_STATES, MERCHANT_DISPLAYS, MerchantDisplay } from "./types";

/** A display counts as online when its last heartbeat is this recent. */
export const ONLINE_WITHIN_MS = 150 * 1000;
const NAME_MAX = 40;

const ms = (t: admin.firestore.Timestamp | null | undefined) => (t ? t.toMillis() : null);

/** Unlink one display: it stops working at once and its screen goes back to pairing. */
export async function revokeDisplay(displayId: string, expectedMerchantId?: string): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(MERCHANT_DISPLAYS).doc(displayId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const display = snap.data() as MerchantDisplay | undefined;
    if (!snap.exists || !display) return false;
    if (expectedMerchantId && display.merchantId !== expectedMerchantId) {
      throw new https.HttpsError("permission-denied", "Not your display");
    }
    if (display.stateKey) tx.delete(db.collection(DISPLAY_STATES).doc(display.stateKey));
    tx.update(ref, {
      status: "revoked",
      secretSha256: null,
      stateKey: null,
      revokedAt: admin.firestore.Timestamp.now(),
    });
    return display.status !== "revoked";
  });
}

/** Every display of a shop, for account deletion and freezes. */
export async function revokeAllDisplays(merchantId: string): Promise<number> {
  const snap = await admin
    .firestore()
    .collection(MERCHANT_DISPLAYS)
    .where("merchantId", "==", merchantId)
    .get();
  let revoked = 0;
  for (const doc of snap.docs) {
    if (doc.get("status") === "revoked") continue;
    if (await revokeDisplay(doc.id)) revoked += 1;
  }
  return revoked;
}

function requireOwnDisplayId(value: unknown): string {
  if (typeof value !== "string" || !DISPLAY_ID.test(value)) {
    throw new https.HttpsError("invalid-argument", "displayId is required");
  }
  return value;
}

export const listMyDisplays = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAuth(request);
  const merchantId = request.auth!.uid;
  const snap = await admin
    .firestore()
    .collection(MERCHANT_DISPLAYS)
    .where("merchantId", "==", merchantId)
    .get();
  const now = Date.now();
  const displays = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MerchantDisplay) }))
    .filter((d) => d.status === "active" || d.status === "pending_confirm")
    .map((d) => {
      const lastSeenAtMs = ms(d.lastSeenAt);
      return {
        displayId: d.id,
        name: d.name,
        status: d.status,
        online: d.status === "active" && lastSeenAtMs !== null && now - lastSeenAtMs < ONLINE_WITHIN_MS,
        lastSeenAtMs,
        createdAtMs: ms(d.createdAt),
        confirmedAtMs: ms(d.confirmedAt),
      };
    })
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return { success: true, data: { displays, serverNowMs: now } };
});

export const renameDisplay = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAuth(request);
  const merchantId = request.auth!.uid;
  const displayId = requireOwnDisplayId(request.data?.displayId);
  const raw = request.data?.name;
  const name =
    typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX) : "";
  if (!name) throw new https.HttpsError("invalid-argument", "Give the screen a name.");

  const ref = admin.firestore().collection(MERCHANT_DISPLAYS).doc(displayId);
  const snap = await ref.get();
  if (!snap.exists || snap.get("merchantId") !== merchantId || snap.get("status") === "revoked") {
    throw new https.HttpsError("not-found", "Display not found");
  }
  await ref.update({ name });
  return { success: true, data: { name } };
});

export const unlinkDisplay = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAuth(request);
  const merchantId = request.auth!.uid;
  const displayId = requireOwnDisplayId(request.data?.displayId);
  const ref = admin.firestore().collection(MERCHANT_DISPLAYS).doc(displayId);
  const snap = await ref.get();
  if (!snap.exists || snap.get("merchantId") !== merchantId) {
    throw new https.HttpsError("not-found", "Display not found");
  }
  await revokeDisplay(displayId, merchantId);
  return { success: true, data: { unlinked: true } };
});

/** From the tablet's own Setup screen. */
export const displaySignOut = https.onCall({ enforceAppCheck: true }, async (request) => {
  const caller = await requireDisplay(request);
  await revokeDisplay(caller.displayId, caller.merchantId);
  return { success: true, data: { unlinked: true } };
});
