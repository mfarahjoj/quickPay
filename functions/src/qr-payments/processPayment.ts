import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validateTransactionLimit } from "../utils/validation";
import {
  assertAccountActive,
  requireActiveAccount,
} from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import {
  notifyPaymentReceived,
  notifyPaymentSent,
} from "../utils/notifications";
import {
  ApiResponse,
  QRPaymentRequest,
  PaymentResponse,
  QRCode,
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

/**
 * Callable function to process a QR payment
 */
export const processPayment = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<QRPaymentRequest>
  ): Promise<ApiResponse<PaymentResponse>> => {
    // Validate authentication
    requireAuth(request);
    const customerId = request.auth!.uid;

    const { qrCodeId, pin } = request.data;

    if (!qrCodeId || !pin) {
      throw new https.HttpsError(
        "invalid-argument",
        "QR code ID and PIN are required"
      );
    }

    try {
      const db = admin.firestore();

      // Verify PIN
      const pinValid = await verifyUserPin(customerId, pin);
      if (!pinValid) {
        throw new https.HttpsError(
          "permission-denied",
          "Invalid PIN"
        );
      }

      await enforceVelocity(customerId);

      const qrCodePreCheck = await db.collection("qrCodes").doc(qrCodeId).get();
      if (!qrCodePreCheck.exists) {
        throw new https.HttpsError("not-found", "QR code not found");
      }
      const qrPreData = qrCodePreCheck.data() as QRCode;
      if (qrPreData.merchantId === customerId) {
        throw new https.HttpsError("permission-denied", "Cannot pay yourself");
      }

      // A frozen merchant must not keep taking payments while under review.
      await requireActiveAccount(qrPreData.merchantId, "counterparty");

      // Get customer KYC status for transaction limits
      const customerDoc = await db.collection("users").doc(customerId).get();
      const customerData = customerDoc.data() as User;

      assertAccountActive(customerData);

      const limitCheck = validateTransactionLimit(
        qrPreData.amount,
        customerData.kycStatus
      );
      if (!limitCheck.valid) {
        throw new https.HttpsError(
          "permission-denied",
          limitCheck.reason || "Transaction amount exceeds limit"
        );
      }

      const { paymentFeeRate } = await getRates();

      const transactionId = db.collection("transactions").doc().id;
      let qrAmount: number;
      let qrCurrency: string;
      let merchantId: string;
      let qrReference: string | undefined;
      let feeCents = 0;
      let netCents = 0;

      await db.runTransaction(async (transaction) => {
        const qrCodeRef = db.collection("qrCodes").doc(qrCodeId);
        const qrCodeDoc = await transaction.get(qrCodeRef);

        if (!qrCodeDoc.exists) {
          throw new https.HttpsError("not-found", "QR code not found");
        }

        const qrCode = qrCodeDoc.data() as QRCode;

        if (qrCode.status !== "active") {
          throw new https.HttpsError(
            "failed-precondition",
            `QR code is ${qrCode.status}`
          );
        }

        if (new Date() > qrCode.expiresAt.toDate()) {
          transaction.update(qrCodeRef, { status: "expired" });
          throw new https.HttpsError(
            "failed-precondition",
            "QR code has expired"
          );
        }

        qrAmount = qrCode.amount;
        qrCurrency = qrCode.currency;
        merchantId = qrCode.merchantId;
        qrReference = qrCode.reference;

        // Customer pays the full amount; merchant absorbs the platform fee and
        // receives the net. The fee accrues to the platform:fees account.
        feeCents = computePaymentFee(qrAmount, paymentFeeRate);
        netCents = qrAmount - feeCents;

        const lines: JournalLine[] = [
          { account: userAccount(customerId), debit: qrAmount, credit: 0 },
          { account: userAccount(merchantId), debit: 0, credit: netCents },
        ];
        if (feeCents > 0) {
          lines.push({ account: PLATFORM_FEES, debit: 0, credit: feeCents });
        }

        // Entry ID is derived from the QR code, which is single-use: even if
        // the status check raced, the same QR can never be paid twice.
        const pending = await prepareJournalEntry(transaction, {
          entryId: `qrpay_${qrCodeId}`,
          type: "qr_payment",
          currency: qrCurrency as "USD" | "SLS",
          lines,
          refs: { transactionId, qrCodeId },
          description: "QR payment",
          postedBy: customerId,
        });

        const now = admin.firestore.Timestamp.now();

        pending.write(transaction);

        transaction.update(qrCodeRef, {
          status: "used",
          usedBy: customerId,
          usedAt: now,
        });

        const txRecord: Transaction = {
          type: "payment",
          fromUserId: customerId,
          toUserId: merchantId,
          participants: [customerId, merchantId],
          amount: qrAmount,
          feeCents,
          netCents,
          currency: qrCurrency,
          status: "completed",
          qrCodeId,
          description: "QR payment",
          ...(qrReference ? { reference: qrReference } : {}),
          journalEntryId: `qrpay_${qrCodeId}`,
          createdAt: now,
          completedAt: now,
        };

        transaction.set(db.collection("transactions").doc(transactionId), txRecord);
      });

      notifyPaymentReceived(merchantId!, netCents, qrCurrency!, customerId)
        .catch((err) => console.error("Failed to notify merchant:", err));
      notifyPaymentSent(customerId, qrAmount!, qrCurrency!, merchantId!)
        .catch((err) => console.error("Failed to notify customer:", err));

      return {
        success: true,
        data: {
          transactionId,
          status: "completed",
          amount: qrAmount!,
          merchantId: merchantId!,
        },
      };
    } catch (error: any) {
      console.error("Error processing payment:", error);

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
