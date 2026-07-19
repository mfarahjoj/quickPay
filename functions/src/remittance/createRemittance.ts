import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validateAmount } from "../utils/validation";
import { createPaymentIntent } from "../integrations/stripe.service";
import { generateSecureId } from "../utils/encryption";
import { ApiResponse } from "../types";

interface CreateRemittanceRequest {
  recipientPhone: string;
  amount: number;
  currency: string;
  senderName?: string;
  note?: string;
}

interface CreateRemittanceResponse {
  remittanceId: string;
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  recipientName?: string;
}

export const createRemittance = https.onCall(
  async (
    request: https.CallableRequest<CreateRemittanceRequest>
  ): Promise<ApiResponse<CreateRemittanceResponse>> => {
    requireAuth(request);
    const senderId = request.auth!.uid;

    const { recipientPhone, amount, currency, senderName, note } = request.data;

    if (!recipientPhone || !amount || !currency) {
      throw new https.HttpsError(
        "invalid-argument",
        "recipientPhone, amount, and currency are required"
      );
    }

    if (!validateAmount(amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive integer in cents"
      );
    }

    if (currency !== "USD") {
      throw new https.HttpsError(
        "invalid-argument",
        "Currency must be USD"
      );
    }

    try {
      const db = admin.firestore();

      const recipientQuery = await db
        .collection("users")
        .where("phoneNumber", "==", recipientPhone)
        .limit(1)
        .get();

      let recipientId: string | null = null;
      let recipientName: string | undefined;

      if (!recipientQuery.empty) {
        const recipientDoc = recipientQuery.docs[0];
        recipientId = recipientDoc.id;
        recipientName = recipientDoc.data().fullName;
      }

      const paymentResult = await createPaymentIntent({
        amount,
        currency,
        customerId: senderId,
        description: `Remittance to ${recipientPhone}`,
      });

      if (!paymentResult.success || !paymentResult.clientSecret) {
        throw new https.HttpsError(
          "internal",
          paymentResult.error || "Failed to create payment intent"
        );
      }

      const remittanceId = generateSecureId();

      await db.collection("remittances").doc(remittanceId).set({
        senderId,
        recipientPhone,
        recipientId,
        amount,
        currency,
        status: "pending",
        stripePaymentIntentId: paymentResult.paymentIntentId,
        senderName: senderName || null,
        note: note || null,
        createdAt: admin.firestore.Timestamp.now(),
      });

      console.log(`Remittance created: ${remittanceId}, sender: ${senderId}`);

      return {
        success: true,
        data: {
          remittanceId,
          clientSecret: paymentResult.clientSecret,
          paymentIntentId: paymentResult.paymentIntentId ?? "",
          amount,
          recipientName,
        },
      };
    } catch (error: any) {
      console.error("Error creating remittance:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to create remittance"
      );
    }
  }
);
