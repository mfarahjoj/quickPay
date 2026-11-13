/**
 * Linking a counter display to a shop.
 *
 *   tablet   startDisplayPairing   → a pairing id, a secret only it knows, an 8-digit code
 *   phone    linkDisplay           → the cashier scans the tablet's QR (or types the
 *                                    code) and enters their PIN; the pairing is claimed
 *   tablet   pollDisplayPairing    → sees "claimed" and the shop's name
 *   tablet   confirmDisplayPairing → someone at the counter taps Yes; the tablet gets
 *                                    its display id, secret and state key
 *
 * The confirm on the tablet is the point. The code is on a public screen, so
 * a stranger could photograph it and link their own shop first; customers
 * would then pay them. The tablet shows the name of the shop it is about to
 * join, the real owner sees the wrong one and taps No, and until Yes no state
 * doc exists and no QR is shown.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { verifyUserPin } from "../auth/validatePin";
import { assertAccountActive } from "../utils/accountStatus";
import { generateSecureId } from "../utils/encryption";
import { requireAuth } from "../utils/validation";
import { MERCHANT_TYPES, requireDisplayApp, sameDigest, sha256 } from "./guard";
import { callerIpKey, enforceDisplayRateLimit } from "./rateLimit";
import { shopName, syncCounterState } from "./state";
import {
  DISPLAY_PAIRINGS,
  DISPLAY_STATES,
  DisplayPairing,
  MAX_ACTIVE_DISPLAYS,
  MERCHANT_DISPLAYS,
  MerchantDisplay,
  PAIRING_CLEANUP_MS,
  PAIRING_CODE,
  PAIRING_ID,
  PAIRING_TTL_MS,
  SECRET,
} from "./types";

// A wrong pairing code counts against the merchant like a wrong agent code
// (utils/otpGuard.ts), on fields of its own so it never locks cash-in.
const LINK_MAX_ATTEMPTS = 5;
const LINK_BASE_LOCK_SECONDS = 60;
const LINK_MAX_LOCK_SECONDS = 15 * 60;

const START_PER_IP_PER_MINUTE = 6;
const POLL_PER_PAIRING_PER_MINUTE = 60;
const NAME_MAX = 40;

function newPairingCode(): string {
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "Counter display";
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX);
  return name || "Counter display";
}

/** Count one pairing-code guess before the lookup; throws while locked. */
async function reserveLinkAttempt(merchantId: string): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection("users").doc(merchantId);
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() ?? {};
    const now = Date.now();
    const lockedUntil = data.displayLinkLockedUntil?.toMillis?.() ?? 0;
    if (lockedUntil > now) {
      const secondsLeft = Math.ceil((lockedUntil - now) / 1000);
      throw new https.HttpsError(
        "resource-exhausted",
        `Too many incorrect codes. Try again in ${secondsLeft} seconds.`,
        { secondsLeft, reason: "display_code_attempts" }
      );
    }
    const attempts = (data.displayLinkFailedAttempts ?? 0) + 1;
    const updates: Record<string, unknown> = { displayLinkFailedAttempts: attempts };
    if (attempts >= LINK_MAX_ATTEMPTS) {
      const lockSeconds = Math.min(
        LINK_BASE_LOCK_SECONDS * 2 ** (attempts - LINK_MAX_ATTEMPTS),
        LINK_MAX_LOCK_SECONDS
      );
      updates.displayLinkLockedUntil = admin.firestore.Timestamp.fromMillis(now + lockSeconds * 1000);
    }
    tx.update(ref, updates);
  });
}

async function clearLinkAttempts(merchantId: string): Promise<void> {
  await admin
    .firestore()
    .collection("users")
    .doc(merchantId)
    .update({ displayLinkFailedAttempts: 0, displayLinkLockedUntil: null });
}

function codeNotFound(): https.HttpsError {
  return new https.HttpsError("not-found", "That code isn't showing on any screen. Check it and try again.", {
    reason: "display_code_not_found",
  });
}

// ─── Tablet: start ─────────────────────────────────────────────────────────

export const startDisplayPairing = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireDisplayApp(request);
  await enforceDisplayRateLimit(callerIpKey(request), START_PER_IP_PER_MINUTE);

  const db = admin.firestore();
  const pairingId = `dp_${generateSecureId(12)}`;
  const pairingSecret = generateSecureId(32);
  const code = newPairingCode();
  const now = Date.now();

  const pairing: DisplayPairing = {
    secretSha256: sha256(pairingSecret),
    code,
    status: "waiting",
    createdAt: admin.firestore.Timestamp.fromMillis(now),
    expiresAt: admin.firestore.Timestamp.fromMillis(now + PAIRING_TTL_MS),
    expireAt: admin.firestore.Timestamp.fromMillis(now + PAIRING_CLEANUP_MS),
  };
  await db.collection(DISPLAY_PAIRINGS).doc(pairingId).create(pairing);

  return {
    success: true,
    data: { pairingId, pairingSecret, code, expiresAtMs: now + PAIRING_TTL_MS, serverNowMs: now },
  };
});

// ─── Phone: claim ──────────────────────────────────────────────────────────

interface LinkDisplayInput {
  pairingId?: string;
  code?: string;
  name?: string;
  pin?: string;
}

export const linkDisplay = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<LinkDisplayInput>) => {
    requireAuth(request);
    const merchantId = request.auth!.uid;
    const { pairingId, code, pin } = request.data ?? {};

    if (typeof code !== "string" || !PAIRING_CODE.test(code)) {
      throw new https.HttpsError("invalid-argument", "Enter the 8-digit code from the screen.");
    }
    if (pairingId !== undefined && (typeof pairingId !== "string" || !PAIRING_ID.test(pairingId))) {
      throw new https.HttpsError("invalid-argument", "That isn't a Zapp Pay screen code.");
    }
    if (typeof pin !== "string" || !pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }

    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(merchantId).get();
    const user = userSnap.data();
    if (!userSnap.exists || !MERCHANT_TYPES.includes(user?.accountType)) {
      throw new https.HttpsError("permission-denied", "Only shops can link a counter display.");
    }
    assertAccountActive(user);

    await reserveLinkAttempt(merchantId);

    if (!(await verifyUserPin(merchantId, pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    // Find the pairing: by id from a scanned QR, else by the typed code.
    let pairingRef: admin.firestore.DocumentReference;
    if (pairingId) {
      pairingRef = db.collection(DISPLAY_PAIRINGS).doc(pairingId);
    } else {
      const now = admin.firestore.Timestamp.now();
      const matches = (
        await db.collection(DISPLAY_PAIRINGS).where("code", "==", code).where("status", "==", "waiting").get()
      ).docs.filter((d) => (d.get("expiresAt") as admin.firestore.Timestamp).toMillis() > now.toMillis());
      if (matches.length === 0) throw codeNotFound();
      if (matches.length > 1) {
        throw new https.HttpsError("failed-precondition", "Scan the QR on the screen instead of typing the code.", {
          reason: "display_code_ambiguous",
        });
      }
      pairingRef = matches[0].ref;
    }

    const active = await db
      .collection(MERCHANT_DISPLAYS)
      .where("merchantId", "==", merchantId)
      .where("status", "==", "active")
      .get();
    if (active.size >= MAX_ACTIVE_DISPLAYS) {
      throw new https.HttpsError(
        "resource-exhausted",
        `A shop can link up to ${MAX_ACTIVE_DISPLAYS} screens. Unlink one first.`,
        { reason: "display_limit" }
      );
    }

    const profile = (await db.collection("merchantProfiles").doc(merchantId).get()).data();
    const merchantName = shopName(user, profile);
    const name = cleanName(request.data.name);
    const displayId = `cd_${generateSecureId(12)}`;
    const displayRef = db.collection(MERCHANT_DISPLAYS).doc(displayId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(pairingRef);
      const pairing = snap.data() as DisplayPairing | undefined;
      if (
        !snap.exists ||
        !pairing ||
        pairing.code !== code ||
        pairing.status !== "waiting" ||
        pairing.expiresAt.toMillis() <= Date.now()
      ) {
        throw codeNotFound();
      }
      const display: MerchantDisplay = {
        merchantId,
        name,
        status: "pending_confirm",
        secretSha256: null,
        stateKey: null,
        pairingId: pairingRef.id,
        secretFailedAttempts: 0,
        secretLockedUntil: null,
        createdAt: admin.firestore.Timestamp.now(),
        confirmedAt: null,
        lastSeenAt: null,
      };
      tx.create(displayRef, display);
      tx.update(pairingRef, { status: "claimed", displayId, merchantId, merchantName });
    });

    await clearLinkAttempts(merchantId);

    return { success: true, data: { displayId, name, merchantName } };
  }
);

// ─── Tablet: wait for the claim, then confirm ──────────────────────────────

interface PairingInput {
  pairingId?: unknown;
  pairingSecret?: unknown;
  accept?: unknown;
}

async function loadPairing(request: https.CallableRequest<PairingInput>) {
  requireDisplayApp(request);
  const { pairingId, pairingSecret } = request.data ?? {};
  if (typeof pairingId !== "string" || !PAIRING_ID.test(pairingId)) {
    throw new https.HttpsError("invalid-argument", "pairingId is required");
  }
  if (typeof pairingSecret !== "string" || !SECRET.test(pairingSecret)) {
    throw new https.HttpsError("invalid-argument", "pairingSecret is required");
  }
  await enforceDisplayRateLimit(pairingId, POLL_PER_PAIRING_PER_MINUTE);

  const ref = admin.firestore().collection(DISPLAY_PAIRINGS).doc(pairingId);
  const snap = await ref.get();
  const pairing = snap.data() as DisplayPairing | undefined;
  if (!snap.exists || !pairing || !sameDigest(pairing.secretSha256, sha256(pairingSecret))) {
    throw new https.HttpsError("not-found", "Pairing not found", { reason: "pairing_not_found" });
  }
  return { ref, pairing };
}

export const pollDisplayPairing = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<PairingInput>) => {
    const { pairing } = await loadPairing(request);
    const now = Date.now();
    const expired = pairing.expiresAt.toMillis() <= now && pairing.status !== "completed";
    return {
      success: true,
      data: {
        status: expired ? "expired" : pairing.status,
        merchantName: pairing.status === "claimed" ? pairing.merchantName ?? null : null,
        expiresAtMs: pairing.expiresAt.toMillis(),
        serverNowMs: now,
      },
    };
  }
);

export const confirmDisplayPairing = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<PairingInput>) => {
    const { ref, pairing } = await loadPairing(request);
    const accept = request.data?.accept === true;
    const db = admin.firestore();
    const now = Date.now();

    if (pairing.expiresAt.toMillis() <= now) {
      throw new https.HttpsError("failed-precondition", "This code has run out. Start again.", {
        reason: "pairing_expired",
      });
    }
    if (!pairing.displayId || !pairing.merchantId || (pairing.status !== "claimed" && pairing.status !== "completed")) {
      throw new https.HttpsError("failed-precondition", "No shop has claimed this screen yet.", {
        reason: "pairing_not_claimed",
      });
    }
    const displayRef = db.collection(MERCHANT_DISPLAYS).doc(pairing.displayId);

    if (!accept) {
      await db.runTransaction(async (tx) => {
        const displaySnap = await tx.get(displayRef);
        const display = displaySnap.data() as MerchantDisplay | undefined;
        if (display?.stateKey) tx.delete(db.collection(DISPLAY_STATES).doc(display.stateKey));
        if (displaySnap.exists) tx.delete(displayRef);
        tx.update(ref, { status: "declined" });
      });
      return { success: true, data: { status: "declined" } };
    }

    // A second Yes inside the window is a lost reply, not an attack: whoever
    // calls holds the pairing secret. Issue fresh credentials so the tablet
    // can finish; the first set stops working.
    const displaySecret = generateSecureId(32);
    const stateKey = generateSecureId(32);
    const merchantId = pairing.merchantId;

    await db.runTransaction(async (tx) => {
      const displaySnap = await tx.get(displayRef);
      const display = displaySnap.data() as MerchantDisplay | undefined;
      const ok =
        displaySnap.exists &&
        display &&
        display.pairingId === ref.id &&
        display.merchantId === merchantId &&
        (display.status === "pending_confirm" || (display.status === "active" && pairing.status === "completed"));
      if (!ok) {
        throw new https.HttpsError("failed-precondition", "This link was cancelled. Start again.", {
          reason: "pairing_not_claimed",
        });
      }
      if (display!.stateKey) tx.delete(db.collection(DISPLAY_STATES).doc(display!.stateKey));
      tx.update(displayRef, {
        status: "active",
        secretSha256: sha256(displaySecret),
        stateKey,
        confirmedAt: admin.firestore.Timestamp.now(),
        secretFailedAttempts: 0,
        secretLockedUntil: null,
      });
      tx.update(ref, { status: "completed" });
    });

    await syncCounterState(merchantId, { onlyStateKey: stateKey });

    return {
      success: true,
      data: {
        status: "completed",
        displayId: pairing.displayId,
        displaySecret,
        stateKey,
        merchantName: pairing.merchantName ?? null,
        serverNowMs: Date.now(),
      },
    };
  }
);
