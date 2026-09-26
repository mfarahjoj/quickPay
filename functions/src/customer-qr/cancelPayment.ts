import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import {
  ApiResponse,
  MerchantPaymentRequest,
  PaymentRequestStatus,
} from "../types";
import { requestExpiryMillis } from "./requestExpiry";

interface CancelPaymentInput {
  requestId: string;
}

/**
 * The merchant withdraws a charge the customer has not approved yet.
 *
 * Without this, a merchant who stopped waiting — and took cash instead — left
 * a charge the customer could still approve, paying twice. Nothing moves: a
 * pending request has posted no journal entry, and `approvePaymentRequest`
 * refuses anything that is not pending.
 *
 * The reply is the request's final status, not a yes/no. When the customer's
 * approval wins the race, the merchant must see "paid", not a cancellation
 * that never happened. Any request that is no longer pending is reported
 * unchanged, so a repeated cancel is harmless.
 */
export const cancelPaymentRequest = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<CancelPaymentInput>
  ): Promise<ApiResponse<{ status: PaymentRequestStatus }>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const { requestId } = request.data ?? {};
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) {
      throw new https.HttpsError("invalid-argument", "Request ID is required");
    }

    const db = admin.firestore();
    const requestRef = db.collection("paymentRequests").doc(requestId);

    const status = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "Payment request not found");
      }

      const paymentReq = snap.data() as MerchantPaymentRequest;
      if (paymentReq.merchantId !== merchantId) {
        throw new https.HttpsError(
          "permission-denied",
          "This request was raised by a different merchant"
        );
      }

      if (paymentReq.status !== "pending") {
        return paymentReq.status;
      }

      const now = admin.firestore.Timestamp.now();
      const next: PaymentRequestStatus =
        now.toMillis() > requestExpiryMillis(paymentReq) ? "expired" : "cancelled";
      tx.update(requestRef, { status: next, resolvedAt: now });
      return next;
    });

    return { success: true, data: { status } };
  }
);
