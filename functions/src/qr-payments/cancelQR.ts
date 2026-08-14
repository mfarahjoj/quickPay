import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { ApiResponse, QRCode } from "../types";

interface CancelQRRequest {
  qrCodeId: string;
}

/**
 * Void an unpaid payment code.
 *
 * Without this, a merchant who abandons a sale leaves a live code behind for
 * the rest of its 10-minute window — a customer scanning the stale screen (or
 * a photo of it) would still be able to pay. Moves value nowhere: it only
 * closes an unused code, and refuses once one has been paid.
 */
export const cancelQRCode = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<CancelQRRequest>
  ): Promise<ApiResponse<{ cancelled: boolean }>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const { qrCodeId } = request.data;
    if (!qrCodeId) {
      throw new https.HttpsError("invalid-argument", "QR code ID is required");
    }

    const db = admin.firestore();
    const ref = db.collection("qrCodes").doc(qrCodeId);

    try {
      const cancelled = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        if (!doc.exists) {
          throw new https.HttpsError("not-found", "QR code not found");
        }

        const qrCode = doc.data() as QRCode;
        if (qrCode.merchantId !== merchantId) {
          throw new https.HttpsError(
            "permission-denied",
            "Not your QR code"
          );
        }

        // A paid code is settled — cancelling it would misrepresent a real
        // transaction. Report the no-op instead of failing the caller.
        if (qrCode.status !== "active") {
          return false;
        }

        transaction.update(ref, {
          status: "expired",
          cancelledAt: admin.firestore.Timestamp.now(),
        });
        return true;
      });

      return { success: true, data: { cancelled } };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error cancelling QR code:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to cancel QR code"
      );
    }
  }
);
