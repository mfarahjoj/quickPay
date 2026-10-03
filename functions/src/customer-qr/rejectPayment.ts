import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { sendPushNotification } from "../utils/notifications";
import { ApiResponse, MerchantPaymentRequest, User } from "../types";
import { requestExpiryMillis } from "./requestExpiry";

interface RejectPaymentInput {
  requestId: string;
}

export const rejectPaymentRequest = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RejectPaymentInput>
  ): Promise<ApiResponse<{ success: boolean }>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;

    const { requestId } = request.data;
    if (!requestId) {
      throw new https.HttpsError(
        "invalid-argument",
        "Request ID is required"
      );
    }

    const db = admin.firestore();
    const requestRef = db.collection("paymentRequests").doc(requestId);

    // Read and write in one transaction. As separate steps, a decline landing
    // while an approval committed could overwrite "approved" with "rejected"
    // after the money had moved, and the merchant would see a sale that was
    // paid reported as declined.
    const { paymentReq, expired } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "Payment request not found");
      }

      const req = snap.data() as MerchantPaymentRequest;

      if (req.customerId !== customerId) {
        throw new https.HttpsError(
          "permission-denied",
          "This request is not for you"
        );
      }

      if (req.status !== "pending") {
        throw new https.HttpsError(
          "failed-precondition",
          `Request is already ${req.status}`
        );
      }

      const now = admin.firestore.Timestamp.now();
      if (now.toMillis() > requestExpiryMillis(req)) {
        tx.update(requestRef, { status: "expired", resolvedAt: now });
        return { paymentReq: req, expired: true };
      }

      tx.update(requestRef, { status: "rejected", resolvedAt: now });
      return { paymentReq: req, expired: false };
    });

    if (expired) {
      throw new https.HttpsError(
        "failed-precondition",
        "Payment request has expired"
      );
    }

    const customerDoc = await db.collection("users").doc(customerId).get();
    const customer = customerDoc.data() as User;

    sendPushNotification(
      paymentReq.merchantId,
      "Payment Declined",
      `${customer.fullName} declined your payment request`,
      {
        type: "payment_rejected",
        requestId,
      }
    ).catch((err) => console.error("Failed to notify merchant:", err));

    return {
      success: true,
      data: { success: true },
    };
  }
);
