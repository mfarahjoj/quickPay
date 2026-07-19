import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import {
  notifyPaymentReceived,
  notifyPaymentSent,
} from "../utils/notifications";
import {
  ApiResponse,
  MerchantPaymentRequest,
  Transaction,
} from "../types";
import { getRates, computePaymentFee } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
} from "../ledger";

const REQUEST_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ApprovePaymentInput {
  requestId: string;
  pin: string;
}

interface ApprovePaymentResponse {
  transactionId: string;
  amount: number;
}

export const approvePaymentRequest = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ApprovePaymentInput>
  ): Promise<ApiResponse<ApprovePaymentResponse>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;

    const { requestId, pin } = request.data;

    if (!requestId || !pin) {
      throw new https.HttpsError(
        "invalid-argument",
        "Request ID and PIN are required"
      );
    }

    const db = admin.firestore();

    const pinValid = await verifyUserPin(customerId, pin);
    if (!pinValid) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    await enforceVelocity(customerId);

    const { paymentFeeRate } = await getRates();

    const transactionId = db.collection("transactions").doc().id;
    let approvedAmount: number;
    let approvedCurrency: string;
    let approvedMerchantId: string;
    let approvedReference: string | undefined;
    let feeCents = 0;
    let netCents = 0;

    const requestRef = db.collection("paymentRequests").doc(requestId);

    await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) {
        throw new https.HttpsError("not-found", "Payment request not found");
      }

      const paymentReq = requestSnap.data() as MerchantPaymentRequest;

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

      const ageMs = Date.now() - paymentReq.createdAt.toMillis();
      if (ageMs > REQUEST_TTL_MS) {
        tx.update(requestRef, {
          status: "expired",
          resolvedAt: admin.firestore.Timestamp.now(),
        });
        throw new https.HttpsError(
          "failed-precondition",
          "Payment request has expired"
        );
      }

      approvedAmount = paymentReq.amount;
      approvedCurrency = paymentReq.currency;
      approvedMerchantId = paymentReq.merchantId;
      approvedReference = paymentReq.reference;

      // Merchant absorbs the platform fee and receives the net.
      feeCents = computePaymentFee(approvedAmount, paymentFeeRate);
      netCents = approvedAmount - feeCents;

      const lines: JournalLine[] = [
        { account: userAccount(customerId), debit: approvedAmount, credit: 0 },
        { account: userAccount(approvedMerchantId), debit: 0, credit: netCents },
      ];
      if (feeCents > 0) {
        lines.push({ account: PLATFORM_FEES, debit: 0, credit: feeCents });
      }

      // Entry ID derives from the payment request, which resolves exactly once.
      const pending = await prepareJournalEntry(tx, {
        entryId: `custqr_${requestId}`,
        type: "customer_qr_payment",
        currency: approvedCurrency as "USD" | "SLS",
        lines,
        refs: { transactionId },
        description: "QR Payment (Customer Token)",
        postedBy: customerId,
      });

      const now = admin.firestore.Timestamp.now();

      pending.write(tx);

      const txRecord: Transaction = {
        type: "payment",
        fromUserId: customerId,
        toUserId: approvedMerchantId,
        participants: [customerId, approvedMerchantId],
        amount: approvedAmount,
        feeCents,
        netCents,
        currency: approvedCurrency,
        status: "completed",
        description: "QR Payment (Customer Token)",
        ...(approvedReference ? { reference: approvedReference } : {}),
        journalEntryId: `custqr_${requestId}`,
        createdAt: now,
        completedAt: now,
      };

      tx.set(db.collection("transactions").doc(transactionId), txRecord);

      tx.update(requestRef, {
        status: "approved",
        resolvedAt: now,
      });
    });

    notifyPaymentReceived(
      approvedMerchantId!,
      netCents,
      approvedCurrency!,
      customerId
    ).catch((err) => console.error("Failed to notify merchant:", err));

    notifyPaymentSent(
      customerId,
      approvedAmount!,
      approvedCurrency!,
      approvedMerchantId!
    ).catch((err) => console.error("Failed to notify customer:", err));

    return {
      success: true,
      data: {
        transactionId,
        amount: approvedAmount!,
      },
    };
  }
);
