import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validateTransactionLimit } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import {
  notifyPaymentReceived,
  notifyPaymentSent,
} from "../utils/notifications";
import { ApiResponse, Transaction, User } from "../types";
import {
  prepareJournalEntry,
  userAccount,
  WalletNotFoundError,
} from "../ledger";

interface SendP2PRequest {
  recipientPhone: string;
  amount: number;
  currency: string;
  pin: string;
  note?: string;
}

interface SendP2PResponse {
  transactionId: string;
  status: string;
  amount: number;
  recipientId: string;
}

export const sendP2P = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<SendP2PRequest>
  ): Promise<ApiResponse<SendP2PResponse>> => {
    requireAuth(request);
    const senderId = request.auth!.uid;

    const { recipientPhone, amount, currency, pin, note } = request.data;

    if (!recipientPhone || !amount || !currency || !pin) {
      throw new https.HttpsError(
        "invalid-argument",
        "recipientPhone, amount, currency, and pin are required"
      );
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive integer in cents"
      );
    }

    if (!["USD", "SLS"].includes(currency)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Currency must be USD or SLS"
      );
    }

    try {
      const db = admin.firestore();

      const pinValid = await verifyUserPin(senderId, pin);
      if (!pinValid) {
        throw new https.HttpsError(
          "permission-denied",
          "Invalid PIN"
        );
      }

      await enforceVelocity(senderId);

      // Look up recipient by phone number
      const recipientQuery = await db
        .collection("users")
        .where("phoneNumber", "==", recipientPhone)
        .limit(1)
        .get();

      if (recipientQuery.empty) {
        throw new https.HttpsError(
          "not-found",
          "Recipient not found"
        );
      }

      const recipientDoc = recipientQuery.docs[0];
      const recipientId = recipientDoc.id;
      const recipientData = recipientDoc.data() as User;

      assertAccountActive(recipientData, "counterparty");

      if (recipientId === senderId) {
        throw new https.HttpsError(
          "permission-denied",
          "Cannot send money to yourself"
        );
      }

      // Get sender KYC status for transaction limits
      const senderDoc = await db.collection("users").doc(senderId).get();
      const senderData = senderDoc.data() as User;

      assertAccountActive(senderData);

      const limitCheck = validateTransactionLimit(amount, senderData.kycStatus);
      if (!limitCheck.valid) {
        throw new https.HttpsError(
          "permission-denied",
          limitCheck.reason || "Transaction amount exceeds limit"
        );
      }

      const transactionId = db.collection("transactions").doc().id;

      const journalEntryId = `p2p_${transactionId}`;

      await db.runTransaction(async (transaction) => {
        // All money movement goes through the ledger: wallet balance checks,
        // overdraft protection, and projection updates happen in prepare/write.
        const pending = await prepareJournalEntry(transaction, {
          entryId: journalEntryId,
          type: "p2p",
          currency: currency as "USD" | "SLS",
          lines: [
            { account: userAccount(senderId), debit: amount, credit: 0 },
            { account: userAccount(recipientId), debit: 0, credit: amount },
          ],
          refs: { transactionId },
          description: note || "P2P Transfer",
          postedBy: senderId,
        });

        pending.write(transaction);

        const txRecord: Transaction = {
          type: "payment",
          fromUserId: senderId,
          toUserId: recipientId,
          participants: [senderId, recipientId],
          amount,
          currency,
          status: "completed",
          description: note || "P2P Transfer",
          journalEntryId,
          createdAt: admin.firestore.Timestamp.now(),
          completedAt: admin.firestore.Timestamp.now(),
        };

        const transactionRef = db.collection("transactions").doc(transactionId);
        transaction.set(transactionRef, txRecord);
      });

      notifyPaymentReceived(
        recipientId,
        amount,
        currency,
        senderId
      ).catch((err) => console.error("Failed to notify recipient:", err));

      notifyPaymentSent(
        senderId,
        amount,
        currency,
        recipientId
      ).catch((err) => console.error("Failed to notify sender:", err));

      console.log(`P2P transfer successful: ${transactionId}`);

      return {
        success: true,
        data: {
          transactionId,
          status: "completed",
          amount,
          recipientId,
        },
      };
    } catch (error: any) {
      console.error("Error processing P2P transfer:", error);

      if (error.message === "Insufficient balance") {
        throw new https.HttpsError(
          "failed-precondition",
          "Insufficient balance"
        );
      }

      if (error instanceof WalletNotFoundError) {
        throw new https.HttpsError("failed-precondition", "Wallet not found");
      }

      if (error instanceof https.HttpsError) throw error;

      throw new https.HttpsError(
        "internal",
        error.message || "Failed to process transfer"
      );
    }
  }
);
