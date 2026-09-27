import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import * as bcrypt from "bcrypt";
import { hashPin } from "../utils/encryption";
import { requireAuth, validatePin } from "../utils/validation";
import { notifyUser } from "../utils/notifications";
import { getRates } from "../config/rates";
import { ApiResponse } from "../types";

interface ResetPinRequest {
  newPin: string;
  /** This phone's trusted-device credential, when it has one. */
  deviceId?: string;
  deviceSecret?: string;
  /** Last characters of the customer's verified ID, for a phone we don't know. */
  idLast4?: string;
}

interface ResetPinResult {
  /** Outgoing money is paused until then. */
  cooldownUntil: string;
  /** What may still be spent at shops in total before then, in cents. */
  allowanceCents: number;
}

// The caller must have completed phone verification this recently, on a
// session that was actually established by phone. The client re-runs OTP
// (reauthenticateWithCredential) right before calling, which refreshes
// auth_time.
const MAX_AUTH_AGE_SECONDS = 5 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RESETS_PER_DAY = 1;
const MAX_RESETS_PER_30_DAYS = 3;
const HISTORY_KEPT = 5;

/**
 * A phone counts as the owner's only once its trusted-device record is this
 * old. Registering a device needs no PIN, so a SIM-swapper's phone can become
 * "trusted" minutes after signing in; it cannot become a week old.
 */
const KNOWN_DEVICE_MIN_AGE_MS = 7 * DAY_MS;

const MAX_ID_ATTEMPTS = 3;
const ID_LOCK_MS = DAY_MS;

/** Letters and digits only, upper-cased: "ab-12 34" and "AB1234" compare equal. */
const normaliseId = (value: string) => value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * Reset a forgotten PIN.
 *
 * The SMS code proves only that the caller holds the phone number, and so
 * does a thief holding the phone or anyone who has talked a telco into a SIM
 * swap. So a reset is limited in three ways:
 *
 * - On a phone this account has used for at least a week, the SMS code is
 *   enough. On any other phone the caller must also give the last four
 *   characters of their admin-verified ID; without verified KYC, the reset
 *   has to go through an agent or support.
 * - After any reset, outgoing money pauses (see utils/resetCooldown.ts),
 *   other trusted devices are dropped, and the owner is told.
 * - At most one reset a day and three in thirty days.
 */
export const resetPin = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ResetPinRequest>
  ): Promise<ApiResponse<ResetPinResult>> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const { newPin, deviceId, deviceSecret, idLast4 } = request.data ?? {};

    if (!validatePin(newPin)) {
      throw new https.HttpsError(
        "invalid-argument",
        "PIN must be exactly 6 digits"
      );
    }

    // Recency alone is NOT enough: a trusted-device PIN login signs in with a
    // custom token, which also mints a fresh auth_time despite involving no
    // phone verification at all.
    const signInProvider = request.auth!.token.firebase?.sign_in_provider;
    const authTime = request.auth!.token.auth_time;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      signInProvider !== "phone" ||
      !authTime ||
      nowSeconds - authTime > MAX_AUTH_AGE_SECONDS
    ) {
      throw new https.HttpsError(
        "failed-precondition",
        "Recent phone verification required. Please verify your phone number again."
      );
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new https.HttpsError("not-found", "User not found");
    }
    const user = userDoc.data()!;
    const nowMs = Date.now();

    const history: admin.firestore.Timestamp[] = user.pinResetHistory ?? [];
    const within = (ms: number) => history.filter((t) => nowMs - t.toMillis() < ms).length;
    if (within(DAY_MS) >= MAX_RESETS_PER_DAY || within(30 * DAY_MS) >= MAX_RESETS_PER_30_DAYS) {
      throw new https.HttpsError(
        "resource-exhausted",
        "Too many PIN resets. Contact support.",
        { reason: "reset_limit" }
      );
    }

    const knownDeviceId = await knownDevice(db, userId, deviceId, deviceSecret, nowMs);

    if (!knownDeviceId) {
      await checkIdAnswer(userRef, user, idLast4, nowMs);
    }

    const pinHash = await hashPin(newPin);
    const now = admin.firestore.Timestamp.now();

    await userRef.update({
      pinHash,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      pinResetAt: now,
      pinResetHistory: [...history, now].slice(-HISTORY_KEPT),
      resetIdFailedAttempts: 0,
      resetIdLockedUntil: null,
      updatedAt: now,
    });

    // Whoever held the old trust — another phone, or the one this reset is
    // guarding against — has to prove themselves again.
    const devices = await db.collection("trustedDevices").where("uid", "==", userId).get();
    await Promise.all(
      devices.docs
        .filter((doc) => doc.id !== knownDeviceId)
        .map((doc) => doc.ref.delete())
    );

    const { pinResetCooldownHours, pinResetCooldownAllowanceCents } = await getRates();
    const cooldownUntil = new Date(now.toMillis() + pinResetCooldownHours * 60 * 60 * 1000);

    notifyUser(
      userId,
      "pin_reset",
      "Your Zapp Pay PIN was reset",
      `If this wasn't you, contact support now. Sending money is paused until ${cooldownUntil.toUTCString()}.`,
      { type: "pin_reset" }
    ).catch((err) => console.error("Failed to notify PIN reset:", err));

    console.log(
      `PIN reset for user ${userId} (${knownDeviceId ? "known device" : "verified ID"})`
    );
    return {
      success: true,
      message: "PIN reset successfully",
      data: {
        cooldownUntil: cooldownUntil.toISOString(),
        allowanceCents: pinResetCooldownAllowanceCents,
      },
    };
  }
);

/**
 * The ID of the caller's trusted device, if it proves it is one of this
 * account's devices and has been for at least a week; otherwise null.
 */
async function knownDevice(
  db: FirebaseFirestore.Firestore,
  userId: string,
  deviceId: unknown,
  deviceSecret: unknown,
  nowMs: number
): Promise<string | null> {
  if (
    typeof deviceId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(deviceId) ||
    typeof deviceSecret !== "string" || !deviceSecret
  ) {
    return null;
  }
  const snap = await db.collection("trustedDevices").doc(deviceId).get();
  const device = snap.data();
  if (!device || device.uid !== userId || !device.createdAt) return null;
  if (nowMs - device.createdAt.toMillis() < KNOWN_DEVICE_MIN_AGE_MS) return null;
  const ok = await bcrypt.compare(deviceSecret, device.secretHash);
  return ok ? deviceId : null;
}

/**
 * On a phone we don't know, the caller must match their admin-verified ID.
 * Throws with a `reason` the app turns into the next step.
 */
async function checkIdAnswer(
  userRef: FirebaseFirestore.DocumentReference,
  user: FirebaseFirestore.DocumentData,
  idLast4: unknown,
  nowMs: number
): Promise<void> {
  // Only a reviewed ID counts: an unreviewed submission could be the caller's
  // own, typed in to answer this very question.
  if (user.kycStatus !== "verified") {
    throw new https.HttpsError(
      "failed-precondition",
      "Reset your PIN with an agent or support, and bring your ID.",
      { reason: "reset_needs_agent" }
    );
  }

  const lockedUntil = user.resetIdLockedUntil as admin.firestore.Timestamp | null | undefined;
  if (lockedUntil && lockedUntil.toMillis() > nowMs) {
    throw new https.HttpsError(
      "resource-exhausted",
      "Too many wrong answers. Try again later or visit an agent.",
      { reason: "reset_id_locked", until: lockedUntil.toDate().toISOString() }
    );
  }

  if (typeof idLast4 !== "string" || !idLast4.trim()) {
    throw new https.HttpsError(
      "failed-precondition",
      "Enter the last 4 characters of your ID.",
      { reason: "reset_needs_id" }
    );
  }

  const kyc = await userRef.collection("kyc").doc("latest").get();
  const stored = normaliseId(String(kyc.data()?.idNumber ?? ""));
  if (stored.length < 4) {
    throw new https.HttpsError(
      "failed-precondition",
      "Reset your PIN with an agent or support, and bring your ID.",
      { reason: "reset_needs_agent" }
    );
  }

  if (normaliseId(idLast4) !== stored.slice(-4)) {
    const attempts = (user.resetIdFailedAttempts ?? 0) + 1;
    const locked = attempts >= MAX_ID_ATTEMPTS;
    await userRef.update({
      resetIdFailedAttempts: attempts,
      ...(locked
        ? { resetIdLockedUntil: admin.firestore.Timestamp.fromMillis(nowMs + ID_LOCK_MS) }
        : {}),
    });
    throw new https.HttpsError(
      locked ? "resource-exhausted" : "permission-denied",
      locked ? "Too many wrong answers. Try again later or visit an agent." : "That doesn't match your ID.",
      locked
        ? { reason: "reset_id_locked" }
        : { reason: "reset_id_wrong", attemptsLeft: MAX_ID_ATTEMPTS - attempts }
    );
  }
}
