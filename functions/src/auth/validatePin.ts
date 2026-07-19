import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { verifyPin } from "../utils/encryption";
import { validatePin, requireAuth } from "../utils/validation";
import { ApiResponse } from "../types";

interface ValidatePinRequest {
  pin: string;
}

// Lockout policy shared by every PIN surface (app unlock, payments, changePin,
// account deletion): 5 straight failures lock for 60s, doubling per additional
// failure, capped at 15 minutes. Counter resets on any successful check.
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const BASE_LOCK_SECONDS = 60;
const MAX_LOCK_SECONDS = 15 * 60;

/**
 * Callable function to validate user PIN
 * Used before sensitive operations
 */
export const validateUserPin = https.onCall(
  async (request: https.CallableRequest<ValidatePinRequest>):
    Promise<ApiResponse<{ valid: boolean }>> => {
    // Validate authentication
    requireAuth(request);
    const userId = request.auth!.uid;

    const { pin } = request.data;

    // Validate input
    if (!validatePin(pin)) {
      throw new https.HttpsError(
        "invalid-argument",
        "PIN must be exactly 6 digits"
      );
    }

    try {
      const isValid = await verifyUserPin(userId, pin);

      return {
        success: true,
        data: { valid: isValid },
      };
    } catch (error: any) {
      console.error("Error validating PIN:", error);
      if (error instanceof https.HttpsError) throw error;
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to validate PIN"
      );
    }
  }
);

/**
 * Verify a user's PIN with shared attempt limiting.
 *
 * Throws `resource-exhausted` (with `secondsLeft` in details) while the PIN is
 * locked out, `not-found` when the user doc is missing, and
 * `failed-precondition` when no PIN has been set up yet.
 */
export async function verifyUserPin(
  userId: string,
  pin: string
): Promise<boolean> {
  const db = admin.firestore();
  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new https.HttpsError("not-found", "User not found");
  }

  const userData = userDoc.data()!;
  const pinHash = userData.pinHash;

  if (!pinHash) {
    throw new https.HttpsError(
      "failed-precondition",
      "PIN not set up. Please set up your PIN first."
    );
  }

  const now = admin.firestore.Timestamp.now();
  const lockedUntil = userData.pinLockedUntil as
    | admin.firestore.Timestamp
    | null
    | undefined;

  if (lockedUntil && lockedUntil.toMillis() > now.toMillis()) {
    const secondsLeft = Math.ceil(
      (lockedUntil.toMillis() - now.toMillis()) / 1000
    );
    throw new https.HttpsError(
      "resource-exhausted",
      `Too many incorrect PIN attempts. Try again in ${secondsLeft} seconds.`,
      { secondsLeft }
    );
  }

  const isValid = await verifyPin(pin, pinHash);

  if (isValid) {
    if ((userData.pinFailedAttempts ?? 0) > 0 || lockedUntil) {
      await userRef.update({ pinFailedAttempts: 0, pinLockedUntil: null });
    }
    return true;
  }

  const failedAttempts = (userData.pinFailedAttempts ?? 0) + 1;
  const updates: Record<string, unknown> = {
    pinFailedAttempts: admin.firestore.FieldValue.increment(1),
  };
  if (failedAttempts >= MAX_ATTEMPTS_BEFORE_LOCK) {
    const lockSeconds = Math.min(
      BASE_LOCK_SECONDS * 2 ** (failedAttempts - MAX_ATTEMPTS_BEFORE_LOCK),
      MAX_LOCK_SECONDS
    );
    updates.pinLockedUntil = admin.firestore.Timestamp.fromMillis(
      now.toMillis() + lockSeconds * 1000
    );
  }
  await userRef.update(updates);
  return false;
}
