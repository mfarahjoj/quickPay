import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { hashPin } from "../utils/encryption";
import { requireAuth, validatePin } from "../utils/validation";
import { ApiResponse } from "../types";

interface ResetPinRequest {
  newPin: string;
}

// The caller must have completed phone verification this recently, on a
// session that was actually established by phone. The client re-runs OTP
// (reauthenticateWithCredential) right before calling, which refreshes
// auth_time — possession of the phone number is the reset factor.
const MAX_AUTH_AGE_SECONDS = 5 * 60;

/**
 * Callable function to reset a forgotten PIN.
 *
 * Unlike changePin this does not require the current PIN; instead it requires
 * a fresh phone (OTP) verification, proven via the ID token's auth_time.
 */
export const resetPin = https.onCall(
  async (
    request: https.CallableRequest<ResetPinRequest>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const { newPin } = request.data;

    if (!validatePin(newPin)) {
      throw new https.HttpsError(
        "invalid-argument",
        "PIN must be exactly 6 digits"
      );
    }

    // Recency alone is NOT enough: a trusted-device PIN login signs in with a
    // custom token, which also mints a fresh auth_time despite involving no
    // phone verification at all. Requiring the phone provider keeps "forgot my
    // PIN" behind an actual OTP, which is the whole point of this endpoint.
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

    try {
      const db = admin.firestore();
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }

      const pinHash = await hashPin(newPin);
      const now = admin.firestore.Timestamp.now();

      await userRef.update({
        pinHash,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        pinResetAt: now,
        updatedAt: now,
      });

      console.log(`PIN reset for user ${userId}`);
      return { success: true, message: "PIN reset successfully" };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error resetting PIN:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to reset PIN"
      );
    }
  }
);
