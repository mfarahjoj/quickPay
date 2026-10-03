import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validatePin } from "../utils/validation";
import { hashPin } from "../utils/encryption";
import { verifyUserPin } from "./validatePin";
import { ApiResponse } from "../types";

interface ChangePinRequest {
  currentPin: string;
  newPin: string;
}

export const changePin = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ChangePinRequest>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const { currentPin, newPin } = request.data;

    if (!validatePin(currentPin) || !validatePin(newPin)) {
      throw new https.HttpsError(
        "invalid-argument",
        "PIN must be exactly 6 digits"
      );
    }

    if (currentPin === newPin) {
      throw new https.HttpsError(
        "invalid-argument",
        "New PIN must be different from current PIN"
      );
    }

    try {
      const db = admin.firestore();

      // Shared lockout-aware verification (throws resource-exhausted when locked)
      const isValid = await verifyUserPin(userId, currentPin);
      if (!isValid) {
        throw new https.HttpsError(
          "permission-denied",
          "Current PIN is incorrect"
        );
      }

      const newPinHash = await hashPin(newPin);

      await db.collection("users").doc(userId).update({
        pinHash: newPinHash,
        updatedAt: admin.firestore.Timestamp.now(),
      });

      return { success: true, message: "PIN changed successfully" };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error changing PIN:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to change PIN"
      );
    }
  }
);
