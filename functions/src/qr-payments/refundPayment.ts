import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { ApiResponse, Transaction } from "../types";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
  InsufficientBalanceError,
  WalletNotFoundError,
} from "../ledger";

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

      const pinValid = await verifyUserPin(merchantId, pin);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }

      const customerId = original.fromUserId;
      const gross = original.amount;
      const fee = original.feeCents ?? 0;
      const net = original.netCents ?? original.amount;
      const currency = original.currency;

      const refundTransactionId = db.collection("transactions").doc().id;

      await db.runTransaction(async (tx) => {
        // Re-read the original under lock to keep the refund idempotent.
        const lockedOriginal = await tx.get(originalRef);
        const lockedData = lockedOriginal.data() as Transaction;
        if (lockedData.refundedAt) {
          throw new https.HttpsError(
            "failed-precondition",
            "This payment has already been refunded"
          );
        }

        // Exact reversal of the payment entry: merchant returns the net, the
        // platform returns the fee, the customer gets the gross back. Entry ID
        // derives from the original payment, so a payment can refund only once.
        const lines: JournalLine[] = [
          { account: userAccount(merchantId), debit: net, credit: 0 },
          { account: userAccount(customerId), debit: 0, credit: gross },
        ];
        if (fee > 0) {
          lines.push({ account: PLATFORM_FEES, debit: fee, credit: 0 });
        }

        const pending = await prepareJournalEntry(tx, {
          entryId: `refund_${transactionId}`,
          type: "refund",
          currency: currency as "USD" | "SLS",
          lines,
          refs: {
            transactionId: refundTransactionId,
            refundOfEntryId: lockedData.journalEntryId,
          },
          description: "Refund",
          postedBy: merchantId,
        });

        const now = admin.firestore.Timestamp.now();

        pending.write(tx);

        const refundRecord: Transaction = {
          type: "refund",
          fromUserId: merchantId,
          toUserId: customerId,
          participants: [merchantId, customerId],
          amount: gross,
          feeCents: fee,
          netCents: net,
          currency,
          status: "completed",
          description: "Refund",
          reference: original.reference,
          refundOfTransactionId: transactionId,
          journalEntryId: `refund_${transactionId}`,
          createdAt: now,
          completedAt: now,
        };
        tx.set(
          db.collection("transactions").doc(refundTransactionId),
          refundRecord
        );

        tx.update(originalRef, {
          refundedAt: now,
          refundTransactionId,
        });
      });

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
