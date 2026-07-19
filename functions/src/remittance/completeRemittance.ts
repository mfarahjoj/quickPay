import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { getPaymentIntent } from "../integrations/stripe.service";
import { notifyPaymentReceived } from "../utils/notifications";
import { ApiResponse, Transaction } from "../types";
import { prepareJournalEntry, userAccount, FLOAT_BANK } from "../ledger";

interface CompleteRemittanceRequest {
  remittanceId: string;
  paymentIntentId: string;
}

export const completeRemittance = https.onCall(
  async (
    request: https.CallableRequest<CompleteRemittanceRequest>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const senderId = request.auth!.uid;

    const { remittanceId, paymentIntentId } = request.data;

    if (!remittanceId || !paymentIntentId) {
      throw new https.HttpsError(
        "invalid-argument",
        "remittanceId and paymentIntentId are required"
      );
    }

    try {
      const db = admin.firestore();

      const remittanceRef = db.collection("remittances").doc(remittanceId);
      const remittanceDoc = await remittanceRef.get();

      if (!remittanceDoc.exists) {
        throw new https.HttpsError("not-found", "Remittance not found");
      }

      const remittance = remittanceDoc.data()!;

      if (remittance.senderId !== senderId) {
        throw new https.HttpsError(
          "permission-denied",
          "You are not the sender of this remittance"
        );
      }

      if (remittance.status !== "pending") {
        throw new https.HttpsError(
          "failed-precondition",
          "Remittance is not in pending status"
        );
      }

      const paymentIntent = await getPaymentIntent(paymentIntentId);

      if (!paymentIntent || paymentIntent.status !== "succeeded") {
        throw new https.HttpsError(
          "failed-precondition",
          "Payment has not been completed"
        );
      }

      const recipientId = remittance.recipientId as string | null;
      const transactionId = db.collection("transactions").doc().id;

      if (recipientId) {
        await db.runTransaction(async (transaction) => {
          // Stripe money lands in the company bank account; the recipient's
          // wallet liability grows to match. Entry ID derives from the
          // remittance, which completes exactly once.
          const pending = await prepareJournalEntry(transaction, {
            entryId: `remit_${remittanceId}`,
            type: "remittance",
            currency: remittance.currency as "USD" | "SLS",
            lines: [
              { account: FLOAT_BANK, debit: remittance.amount, credit: 0 },
              { account: userAccount(recipientId), debit: 0, credit: remittance.amount },
            ],
            refs: { transactionId, remittanceId },
            description: `Remittance from ${remittance.senderName || "diaspora"}`,
            postedBy: senderId,
          });

          pending.write(transaction);

          const txRecord: Transaction = {
            type: "topup",
            fromUserId: senderId,
            toUserId: recipientId,
            participants: [senderId, recipientId],
            amount: remittance.amount,
            currency: remittance.currency,
            status: "completed",
            description: `Remittance from ${remittance.senderName || "diaspora"}`,
            journalEntryId: `remit_${remittanceId}`,
            createdAt: admin.firestore.Timestamp.now(),
            completedAt: admin.firestore.Timestamp.now(),
          };

          const transactionRef = db.collection("transactions").doc(transactionId);
          transaction.set(transactionRef, txRecord);

          transaction.update(remittanceRef, {
            status: "completed",
            completedAt: admin.firestore.Timestamp.now(),
            transactionId,
          });
        });

        notifyPaymentReceived(
          recipientId,
          remittance.amount,
          remittance.currency,
          senderId
        ).catch((err) => console.error("Failed to notify recipient:", err));
      } else {
        await remittanceRef.update({
          status: "completed",
          completedAt: admin.firestore.Timestamp.now(),
        });
      }

      console.log(`Remittance completed: ${remittanceId}`);

      return {
        success: true,
        message: "Remittance completed successfully",
      };
    } catch (error: any) {
      console.error("Error completing remittance:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to complete remittance"
      );
    }
  }
);
