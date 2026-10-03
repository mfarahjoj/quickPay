import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireActiveAccount } from "../utils/accountStatus";
import { enforceTransactionLimits } from "../utils/limits";
import { requireAuth, validateAmount } from "../utils/validation";
import { verifyUserPin } from "../auth/validatePin";
import { generateSecureId } from "../utils/encryption";
import { notifyTopupCompleted } from "../utils/notifications";
import { initiateZaadPayment, initiateZaadPayout } from "../integrations/zaad.service";
import { initiateEDahabPayment, initiateEDahabPayout } from "../integrations/edahab.service";
import { ApiResponse, Topup, Transaction } from "../types";
import {
  prepareJournalEntry,
  userAccount,
  mobileMoneyFloat,
  CASHOUT_HOLD,
} from "../ledger";

interface MobileMoneyRequest {
  method: "zaad" | "edahab";
  phoneNumber: string;
  amount: number;
  pin: string;
}

interface TopupResponse {
  topupId: string;
  status: string;
  externalTransactionId?: string;
}

interface CashOutResponse {
  topupId: string;
  status: string;
  externalTransactionId?: string;
}

export const topupFromMobileMoney = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<MobileMoneyRequest>
  ): Promise<ApiResponse<TopupResponse>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const { method, phoneNumber, amount, pin } = request.data;

    if (!method || !["zaad", "edahab"].includes(method)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Method must be 'zaad' or 'edahab'"
      );
    }

    if (!phoneNumber) {
      throw new https.HttpsError(
        "invalid-argument",
        "Phone number is required"
      );
    }

    if (!validateAmount(amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive integer in cents"
      );
    }

    if (!pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }

    try {
      const pinValid = await verifyUserPin(userId, pin);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }

      await requireActiveAccount(userId);

      const db = admin.firestore();
      const reference = generateSecureId(16);
      const topupId = db.collection("topups").doc().id;

      const topupRecord: Topup = {
        userId,
        amount,
        currency: "USD",
        method,
        status: "initiated",
        webhookReceived: false,
        createdAt: admin.firestore.Timestamp.now(),
      };

      await db.collection("topups").doc(topupId).set(topupRecord);

      const paymentRequest = { phoneNumber, amount, reference };
      const result = method === "zaad"
        ? await initiateZaadPayment(paymentRequest)
        : await initiateEDahabPayment(paymentRequest);

      if (result.success) {
        const transactionId = db.collection("transactions").doc().id;

        await db.runTransaction(async (transaction) => {
          // Money arrived in the company's Zaad/eDahab account (float) and the
          // customer's wallet liability grows to match.
          const pending = await prepareJournalEntry(transaction, {
            entryId: `mmtopup_${topupId}`,
            type: "mobile_money_topup",
            currency: "USD",
            lines: [
              { account: mobileMoneyFloat(method), debit: amount, credit: 0 },
              { account: userAccount(userId), debit: 0, credit: amount },
            ],
            refs: { transactionId, topupId },
            description: `Top-up via ${method}`,
            postedBy: userId,
          });

          pending.write(transaction);

          const txRecord: Transaction = {
            type: "topup",
            fromUserId: userId,
            toUserId: userId,
            participants: [userId],
            amount,
            currency: "USD",
            status: "completed",
            description: `Top-up via ${method}`,
            journalEntryId: `mmtopup_${topupId}`,
            createdAt: admin.firestore.Timestamp.now(),
            completedAt: admin.firestore.Timestamp.now(),
          };

          transaction.set(
            db.collection("transactions").doc(transactionId),
            txRecord
          );

          transaction.update(db.collection("topups").doc(topupId), {
            status: "completed",
            externalTransactionId: result.transactionId,
            completedAt: admin.firestore.Timestamp.now(),
          });
        });

        notifyTopupCompleted(userId, amount, "USD", method).catch((err) =>
          console.error("Failed to send topup notification:", err)
        );

        console.log(
          `Mobile money top-up successful: ${topupId}, User: ${userId}, Method: ${method}, Amount: ${amount}`
        );

        return {
          success: true,
          data: {
            topupId,
            status: "completed",
            externalTransactionId: result.transactionId,
          },
        };
      } else {
        await db.collection("topups").doc(topupId).update({
          status: "failed",
          errorMessage: result.error || "Payment failed",
        });

        return {
          success: false,
          data: {
            topupId,
            status: "failed",
          },
          error: result.error || "Payment failed",
        };
      }
    } catch (error: any) {
      console.error("Error processing mobile money top-up:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to process top-up"
      );
    }
  }
);

export const cashOutToMobileMoney = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<MobileMoneyRequest>
  ): Promise<ApiResponse<CashOutResponse>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const { method, phoneNumber, amount, pin } = request.data;

    if (!method || !["zaad", "edahab"].includes(method)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Method must be 'zaad' or 'edahab'"
      );
    }

    if (!phoneNumber) {
      throw new https.HttpsError(
        "invalid-argument",
        "Phone number is required"
      );
    }

    if (!validateAmount(amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive integer in cents"
      );
    }

    if (!pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }

    try {
      const pinValid = await verifyUserPin(userId, pin);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }

      const userData = await requireActiveAccount(userId);

      // Cash-out sends value out of the wallet, so the spend caps apply.
      await enforceTransactionLimits(userId, amount, userData);

      const db = admin.firestore();
      const reference = generateSecureId(16);
      const topupId = db.collection("topups").doc().id;

      await db.runTransaction(async (transaction) => {
        // Hold the amount while the external payout is in flight.
        const pending = await prepareJournalEntry(transaction, {
          entryId: `mmcashouthold_${topupId}`,
          type: "mobile_money_cashout",
          currency: "USD",
          lines: [
            { account: userAccount(userId), debit: amount, credit: 0 },
            { account: CASHOUT_HOLD, debit: 0, credit: amount },
          ],
          refs: { topupId },
          description: `Cash-out via ${method} — hold`,
          postedBy: userId,
        });

        pending.write(transaction);

        const topupRecord: Topup = {
          userId,
          amount,
          currency: "USD",
          method,
          status: "pending",
          webhookReceived: false,
          createdAt: admin.firestore.Timestamp.now(),
        };

        transaction.set(db.collection("topups").doc(topupId), topupRecord);
      });

      const payoutRequest = { phoneNumber, amount, reference };
      const result = method === "zaad"
        ? await initiateZaadPayout(payoutRequest)
        : await initiateEDahabPayout(payoutRequest);

      if (result.success) {
        const transactionId = db.collection("transactions").doc().id;

        // Payout left the company's mobile-money float; settle the hold.
        await db.runTransaction(async (transaction) => {
          const pending = await prepareJournalEntry(transaction, {
            entryId: `mmcashout_${topupId}`,
            type: "mobile_money_cashout",
            currency: "USD",
            lines: [
              { account: CASHOUT_HOLD, debit: amount, credit: 0 },
              { account: mobileMoneyFloat(method), debit: 0, credit: amount },
            ],
            refs: { transactionId, topupId },
            description: `Cash-out via ${method}`,
            postedBy: userId,
          });

          pending.write(transaction);

          const txRecord: Transaction = {
            type: "withdrawal",
            fromUserId: userId,
            toUserId: userId,
            participants: [userId],
            amount,
            currency: "USD",
            status: "completed",
            description: `Cash-out via ${method}`,
            journalEntryId: `mmcashout_${topupId}`,
            createdAt: admin.firestore.Timestamp.now(),
            completedAt: admin.firestore.Timestamp.now(),
          };

          transaction.set(db.collection("transactions").doc(transactionId), txRecord);

          transaction.update(db.collection("topups").doc(topupId), {
            status: "completed",
            externalTransactionId: result.transactionId,
            completedAt: admin.firestore.Timestamp.now(),
          });
        });

        console.log(
          `Cash-out successful: ${topupId}, User: ${userId}, Method: ${method}, Amount: ${amount}`
        );

        return {
          success: true,
          data: {
            topupId,
            status: "completed",
            externalTransactionId: result.transactionId,
          },
        };
      } else {
        // Payout failed — release the hold back to the customer.
        await db.runTransaction(async (transaction) => {
          const pending = await prepareJournalEntry(transaction, {
            entryId: `mmcashoutrelease_${topupId}`,
            type: "adjustment",
            currency: "USD",
            lines: [
              { account: CASHOUT_HOLD, debit: amount, credit: 0 },
              { account: userAccount(userId), debit: 0, credit: amount },
            ],
            refs: { topupId },
            description: `Cash-out via ${method} failed — hold returned`,
            postedBy: "system",
          });

          pending.write(transaction);

          transaction.update(db.collection("topups").doc(topupId), {
            status: "failed",
            errorMessage: result.error || "Payout failed",
          });
        });

        return {
          success: false,
          data: {
            topupId,
            status: "failed",
          },
          error: result.error || "Payout failed",
        };
      }
    } catch (error: any) {
      console.error("Error processing cash-out:", error);

      if (error.message === "Insufficient balance") {
        throw new https.HttpsError(
          "failed-precondition",
          "Insufficient balance"
        );
      }

      throw new https.HttpsError(
        "internal",
        error.message || "Failed to process cash-out"
      );
    }
  }
);
