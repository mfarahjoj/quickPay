import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "./validatePin";
import { ApiResponse } from "../types";

interface DeleteAccountRequest {
  pin: string;
  reason?: string;
}

export const requestAccountDeletion = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<DeleteAccountRequest>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const { pin, reason } = request.data;

    if (!pin || pin.length !== 6) {
      throw new https.HttpsError(
        "invalid-argument",
        "PIN is required to delete account"
      );
    }

    try {
      const db = admin.firestore();

      // Shared lockout-aware verification (throws resource-exhausted when locked)
      const isValid = await verifyUserPin(userId, pin);
      if (!isValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }

      const walletDoc = await db.collection("wallets").doc(userId).get();
      if (walletDoc.exists) {
        const balance = walletDoc.data()?.balance ?? 0;
        if (balance > 0) {
          throw new https.HttpsError(
            "failed-precondition",
            "Please withdraw your remaining balance before deleting your account"
          );
        }
      }

      await db.collection("users").doc(userId).update({
        isActive: false,
        deletionRequestedAt: admin.firestore.Timestamp.now(),
        deletionReason: reason || null,
        updatedAt: admin.firestore.Timestamp.now(),
      });

      console.log(`Account deletion requested for user ${userId}`);
      return {
        success: true,
        message:
          "Account deletion requested. Your account will be permanently deleted within 30 days.",
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error requesting account deletion:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to request account deletion"
      );
    }
  }
);
