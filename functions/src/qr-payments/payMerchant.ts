import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validateAmount, validateCurrency, validateTransactionLimit } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import {
  notifyPaymentReceived,
  notifyPaymentSent,
} from "../utils/notifications";
import {
  ApiResponse,
  PaymentResponse,
  Transaction,
  User,
} from "../types";
import { getRates, computePaymentFee } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
  WalletNotFoundError,
} from "../ledger";

interface PayMerchantRequest {
  merchantId: string;
  amount: number; // In cents
  currency: string;
  pin: string;
}

/**
 * Direct merchant payment — used when a customer scans a permanent
 * merchant sticker QR (no pre-generated qrCodes document).
 */
export const payMerchant = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<PayMerchantRequest>
  ): Promise<ApiResponse<PaymentResponse>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const { merchantId, amount, currency, pin } = request.data;

    if (!merchantId || !pin) {
      throw new https.HttpsError(
        "invalid-argument",
        "Merchant ID and PIN are required"
      );
    }

    if (!validateAmount(amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive integer (in cents)"
      );
    }

    if (!validateCurrency(currency)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Invalid currency. Supported: USD, SLS"
      );
    }

    if (merchantId === customerId) {
      throw new https.HttpsError("permission-denied", "Cannot pay yourself");
    }

    try {
      const db = admin.firestore();

      const pinValid = await verifyUserPin(customerId, pin);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }

      await enforceVelocity(customerId);

      // Verify merchant exists and is actually a merchant
      const merchantDoc = await db.collection("users").doc(merchantId).get();
      if (!merchantDoc.exists) {
        throw new https.HttpsError("not-found", "Merchant not found");
      }
      const merchantData = merchantDoc.data() as User;
      if (merchantData.accountType !== "merchant" && merchantData.accountType !== "agent_merchant") {
        throw new https.HttpsError(
          "failed-precondition",
          "Recipient is not a merchant account"
        );
      }
      assertAccountActive(merchantData, "counterparty");

      // Check customer transaction limits
      const customerDoc = await db.collection("users").doc(customerId).get();
      const customerData = customerDoc.data() as User;
      assertAccountActive(customerData);
      const limitCheck = validateTransactionLimit(amount, customerData.kycStatus);
      if (!limitCheck.valid) {
        throw new https.HttpsError(
          "permission-denied",
          limitCheck.reason || "Transaction amount exceeds limit"
        );
      }

      const { paymentFeeRate } = await getRates();
      const feeCents = computePaymentFee(amount, paymentFeeRate);
      const netCents = amount - feeCents;

      const transactionId = db.collection("transactions").doc().id;

      const journalEntryId = `paymerchant_${transactionId}`;

      await db.runTransaction(async (transaction) => {
        const lines: JournalLine[] = [
          { account: userAccount(customerId), debit: amount, credit: 0 },
          { account: userAccount(merchantId), debit: 0, credit: netCents },
        ];
        if (feeCents > 0) {
          lines.push({ account: PLATFORM_FEES, debit: 0, credit: feeCents });
        }

        const pending = await prepareJournalEntry(transaction, {
          entryId: journalEntryId,
          type: "qr_payment",
          currency: currency as "USD" | "SLS",
          lines,
          refs: { transactionId },
          description: `Payment to ${merchantData.fullName}`,
          postedBy: customerId,
        });

        pending.write(transaction);

        const txRecord: Transaction = {
          type: "payment",
          fromUserId: customerId,
          toUserId: merchantId,
          participants: [customerId, merchantId],
          amount,
          feeCents,
          netCents,
          currency,
          status: "completed",
          description: `Payment to ${merchantData.fullName}`,
          journalEntryId,
          createdAt: admin.firestore.Timestamp.now(),
          completedAt: admin.firestore.Timestamp.now(),
        };

        transaction.set(
          db.collection("transactions").doc(transactionId),
          txRecord
        );
      });

      notifyPaymentReceived(merchantId, netCents, currency, customerId).catch(
        (err) => console.error("Failed to notify merchant:", err)
      );
      notifyPaymentSent(customerId, amount, currency, merchantId).catch(
        (err) => console.error("Failed to notify customer:", err)
      );

      console.log(`Merchant payment successful: ${transactionId}`);

      return {
        success: true,
        data: {
          transactionId,
          status: "completed",
          amount,
          merchantId,
        },
      };
    } catch (error: any) {
      console.error("Error processing merchant payment:", error);

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
        error.message || "Failed to process payment"
      );
    }
  }
);
