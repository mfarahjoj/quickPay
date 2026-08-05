import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertAccountActive } from "../utils/accountStatus";
import {
  requireAuth,
  validateAmount,
  validateCurrency,
  validateTransactionLimit,
} from "../utils/validation";
import { sendPushNotification } from "../utils/notifications";
import {
  ApiResponse,
  CustomerToken,
  MerchantPaymentRequest,
  User,
} from "../types";

interface CreatePaymentRequestInput {
  tokenId: string;
  amount: number; // In cents
  currency: string;
  reference?: string;
}

export const createPaymentRequest = https.onCall(
  async (
    request: https.CallableRequest<CreatePaymentRequestInput>
  ): Promise<ApiResponse<{ requestId: string }>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const db = admin.firestore();

    const merchantDoc = await db.collection("users").doc(merchantId).get();
    if (!merchantDoc.exists) {
      throw new https.HttpsError("not-found", "Merchant not found");
    }

    const merchant = merchantDoc.data() as User;
    if (merchant.accountType !== "merchant") {
      throw new https.HttpsError(
        "permission-denied",
        "Only merchants can create payment requests"
      );
    }
    // Stop a frozen merchant raising new charges against customers.
    assertAccountActive(merchant);

    const { tokenId, amount, currency, reference } = request.data;

    if (!tokenId) {
      throw new https.HttpsError("invalid-argument", "Token ID is required");
    }
    if (!validateAmount(amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive integer (cents)"
      );
    }
    if (!validateCurrency(currency)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Currency must be USD or SLS"
      );
    }

    const tokenDoc = await db.collection("customerTokens").doc(tokenId).get();
    if (!tokenDoc.exists) {
      throw new https.HttpsError("not-found", "Token not found");
    }

    const token = tokenDoc.data() as CustomerToken;

    if (token.status !== "scanned") {
      throw new https.HttpsError(
        "failed-precondition",
        "Token must be in scanned state"
      );
    }
    if (token.scannedBy !== merchantId) {
      throw new https.HttpsError(
        "permission-denied",
        "Token was scanned by a different merchant"
      );
    }

    // KYC limit check on the customer
    const customerDoc = await db
      .collection("users")
      .doc(token.customerId)
      .get();
    const customer = customerDoc.data() as User;
    const limitCheck = validateTransactionLimit(amount, customer.kycStatus);
    if (!limitCheck.valid) {
      throw new https.HttpsError(
        "permission-denied",
        limitCheck.reason || "Transaction exceeds limit"
      );
    }

    const now = admin.firestore.Timestamp.now();

    const requestRef = db.collection("paymentRequests").doc();
    const paymentRequest: MerchantPaymentRequest = {
      merchantId,
      customerId: token.customerId,
      tokenId,
      amount,
      currency,
      status: "pending",
      ...(reference ? { reference } : {}),
      createdAt: now,
    };

    const batch = db.batch();
    batch.set(requestRef, paymentRequest);
    batch.update(tokenDoc.ref, { status: "used" });
    await batch.commit();

    const amountFormatted = (amount / 100).toFixed(2);
    const notifBody = reference
      ? `${merchant.fullName} is requesting ${currency} ${amountFormatted} — ${reference}`
      : `${merchant.fullName} is requesting ${currency} ${amountFormatted}`;
    sendPushNotification(
      token.customerId,
      "Payment Request",
      notifBody,
      {
        type: "payment_request",
        requestId: requestRef.id,
        merchantName: merchant.fullName,
        amount: amount.toString(),
        currency,
        ...(reference ? { reference } : {}),
      }
    ).catch((err) => console.error("Failed to notify customer:", err));

    return {
      success: true,
      data: { requestId: requestRef.id },
    };
  }
);
