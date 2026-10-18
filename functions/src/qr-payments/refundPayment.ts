import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { requireAuth } from "../utils/validation";
import { requireActiveAccount } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { ApiResponse, Transaction } from "../types";
import { getRates } from "../config/rates";
import {
  JournalEntryType,
  JOURNAL_COLLECTION,
  InsufficientBalanceError,
  WalletNotFoundError,
} from "../ledger";
import { prepareRefund, REFUNDABLE_ENTRY_TYPES } from "./refundCore";
import { DISPUTES_COLLECTION, DisputeDoc } from "../disputes/types";
import { stageResolvedByRefund } from "../disputes/resolve";

const DAY_MS = 24 * 60 * 60 * 1000;

interface RefundRequest {
  transactionId: string;
  pin: string;
}

interface RefundResponse {
  refundTransactionId: string;
  amount: number; // Gross amount refunded, in dollars
}

/**
 * Callable function for a merchant to fully refund a payment they received.
 * Reverses the merchant's net, the platform's fee, and returns the gross to
 * the customer, then records a refund transaction.
 */
export const refundPayment = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RefundRequest>
  ): Promise<ApiResponse<RefundResponse>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const { transactionId, pin } = request.data;

    if (!transactionId || !pin) {
      throw new https.HttpsError(
        "invalid-argument",
        "Transaction ID and PIN are required"
      );
    }

    try {
      const db = admin.firestore();

      const originalRef = db.collection("transactions").doc(transactionId);
      const originalSnap = await originalRef.get();
      if (!originalSnap.exists) {
        throw new https.HttpsError("not-found", "Transaction not found");
      }
      const original = originalSnap.data() as Transaction;

      // Only the receiving merchant may refund a completed payment.
      if (original.type !== "payment") {
        throw new https.HttpsError(
          "failed-precondition",
          "Only payments can be refunded"
        );
      }
      if (original.toUserId !== merchantId) {
        throw new https.HttpsError(
          "permission-denied",
          "Only the merchant who received this payment can refund it"
        );
      }
      if (original.status !== "completed") {
        throw new https.HttpsError(
          "failed-precondition",
          "Only completed payments can be refunded"
        );
      }
      if (original.refundedAt) {
        throw new https.HttpsError(
          "failed-precondition",
          "This payment has already been refunded"
        );
      }
      // An API payment can be refunded in parts, and the parts are tracked on
      // its charge. Refunding it here as well would return money twice.
      if (original.apiChargeId) {
        throw new https.HttpsError(
          "failed-precondition",
          "This payment was taken online. Refund it from the system that took it."
        );
      }

      // Only a payment taken at the counter is the merchant's to give back.
      const entrySnap = original.journalEntryId
        ? await db.collection(JOURNAL_COLLECTION).doc(original.journalEntryId).get()
        : null;
      const entryType = entrySnap?.data()?.type as JournalEntryType | undefined;
      if (!entryType || !REFUNDABLE_ENTRY_TYPES.includes(entryType)) {
        throw new https.HttpsError(
          "failed-precondition",
          "Only payments taken at your counter can be refunded here",
          { reason: "not_refundable" }
        );
      }

      const { refundWindowDays } = await getRates();
      const paidAt = (original.completedAt ?? original.createdAt)?.toMillis?.();
      if (!paidAt || Date.now() - paidAt > refundWindowDays * DAY_MS) {
        throw new https.HttpsError(
          "failed-precondition",
          `Payments can be refunded for ${refundWindowDays} days. Contact support for older ones.`,
          { reason: "refund_window_closed", refundWindowDays }
        );
      }

      const pinValid = await verifyUserPin(merchantId, pin);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }

      // Outgoing money waits out the pause after a PIN reset.
      await assertResetCooldownAllows(merchantId, "other", 0);

      await requireActiveAccount(merchantId);

      const disputeRef = original.disputeId
        ? db.collection(DISPUTES_COLLECTION).doc(original.disputeId)
        : null;

      const outcome = await db.runTransaction(async (tx) => {
        // Reads first: the dispute, then the original under lock and the ledger.
        const disputeSnap = disputeRef ? await tx.get(disputeRef) : null;
        const refund = await prepareRefund(tx, transactionId, { postedBy: merchantId });
        refund.write(tx);
        // Refunding answers an open dispute on this payment.
        const closedDispute =
          disputeRef !== null &&
          stageResolvedByRefund(tx, disputeRef, disputeSnap?.data() as DisputeDoc | undefined, {
            refundTransactionId: refund.refundTransactionId,
            gross: refund.gross,
            merchantId,
            journalEntryId: `refund_${transactionId}`,
          });
        return { refund, closedDispute };
      });

      const { refundTransactionId, customerId, gross, currency } = outcome.refund;

      const amountFormatted = (gross / 100).toFixed(2);
      notifyUser(
        customerId,
        "refund_issued",
        "Refund Received",
        `You were refunded ${currency} ${amountFormatted}`,
        { type: "refund_issued", amount: gross.toString(), currency, merchantId }
      ).catch((err) => console.error("Failed to notify customer:", err));

      return {
        success: true,
        data: {
          refundTransactionId,
          amount: gross / 100,
        },
      };
    } catch (error: any) {
      console.error("Error refunding payment:", error);

      if (error instanceof InsufficientBalanceError) {
        throw new https.HttpsError(
          "failed-precondition",
          "Insufficient balance to refund"
        );
      }
      if (error instanceof WalletNotFoundError) {
        throw new https.HttpsError("failed-precondition", "Wallet not found");
      }
      if (error instanceof https.HttpsError) throw error;

      throw new https.HttpsError(
        "internal",
        error.message || "Failed to refund payment"
      );
    }
  }
);
