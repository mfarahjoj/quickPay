import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { endSessions } from "./sessions";
import { notifyUser } from "../utils/notifications";
import { assertStrongPin } from "../utils/weakPin";
import { requireAuth, validatePin } from "../utils/validation";
import { hashPin } from "../utils/encryption";
import { verifyUserPin } from "./validatePin";
import { writeAuth } from "./pinStore";
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
    assertStrongPin(newPin);

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

      const batch = db.batch();
      writeAuth(batch, userId, { pinHash: newPinHash }, { hasPin: true });
      batch.update(db.collection("users").doc(userId), { updatedAt: admin.firestore.Timestamp.now() });
      await batch.commit();

      // Every other phone signs in again; this one carries on (review A5).
      const sessionToken = await endSessions(userId, { keepCaller: true });
      notifyUser(
        userId,
        "pin_changed",
        { key: "security.pin_changed" },
        { type: "pin_changed" }
      ).catch((err) => console.error("Failed to notify PIN change:", err));

      return { success: true, message: "PIN changed successfully", data: { sessionToken } };
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
