import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { sendPushNotification } from "../utils/notifications";
import { ApiResponse, MerchantPaymentRequest, User } from "../types";

interface RejectPaymentInput {
  requestId: string;
}

export const rejectPaymentRequest = https.onCall(
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

    const requestDoc = await db
      .collection("paymentRequests")
      .doc(requestId)
      .get();

    if (!requestDoc.exists) {
      throw new https.HttpsError("not-found", "Payment request not found");
    }

    const paymentReq = requestDoc.data() as MerchantPaymentRequest;

    if (paymentReq.customerId !== customerId) {
      throw new https.HttpsError(
        "permission-denied",
        "This request is not for you"
      );
    }

    if (paymentReq.status !== "pending") {
      throw new https.HttpsError(
        "failed-precondition",
        `Request is already ${paymentReq.status}`
      );
    }

    await requestDoc.ref.update({
      status: "rejected",
      resolvedAt: admin.firestore.Timestamp.now(),
    });

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
