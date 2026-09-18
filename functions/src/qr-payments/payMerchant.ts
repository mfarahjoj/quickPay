import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validateAmount, validateCurrency } from "../utils/validation";
import { enforceTransactionLimits } from "../utils/limits";
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
  JournalEntryDoc,
  JOURNAL_COLLECTION,
  PLATFORM_FEES,
  WalletNotFoundError,
} from "../ledger";
import {
  isValidIdempotencyKey,
  scopedEntryId,
} from "../utils/idempotency";

interface PayMerchantRequest {
  merchantId: string;
  amount: number; // In cents
  currency: string;
  pin: string;
  /**
   * Minted once per payment attempt by the client and resent unchanged on
   * every retry. Optional only because app builds older than 2026-09-18 don't
   * send one; those calls keep the previous behaviour, where a retry after a
   * dropped connection charges the customer twice.
   */
  idempotencyKey?: string;
}

/**
 * Answer a retry from what was already posted.
 *
 * The journal entry is the record that matters — it is written in the same
 * transaction as the `transactions` row, so if the entry exists the payment
 * happened. `refs.transactionId` points back at the receipt the first attempt
 * created, which is what the customer's app is waiting for.
 */
async function findPostedPayment(
  db: FirebaseFirestore.Firestore,
  customerId: string,
  idempotencyKey: string
): Promise<PaymentResponse | null> {
  const entryId = scopedEntryId("paymerchant", customerId, idempotencyKey);
  const entrySnap = await db.collection(JOURNAL_COLLECTION).doc(entryId).get();
  if (!entrySnap.exists) return null;

  const entry = entrySnap.data() as JournalEntryDoc;
  const postedTransactionId = entry.refs?.transactionId;
  if (!postedTransactionId) return null;

  const txSnap = await db
    .collection("transactions")
    .doc(postedTransactionId)
    .get();
  if (!txSnap.exists) return null;

  const tx = txSnap.data() as Transaction;
  return {
    transactionId: postedTransactionId,
    status: "completed",
    amount: tx.amount,
    merchantId: tx.toUserId as string,
  };
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
    const { merchantId, amount, currency, pin, idempotencyKey } = request.data;

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

      // A retry is answered from the journal before any limit or velocity
      // check runs. Those checks count the payment the first attempt already
      // posted, so running them first would reject the retry of a payment that
      // succeeded — the customer would be told they are over their daily limit
      // for money they have already spent.
      if (isValidIdempotencyKey(idempotencyKey)) {
        const replay = await findPostedPayment(db, customerId, idempotencyKey);
        if (replay) {
          console.log(
            `payMerchant replay for ${customerId} key ${idempotencyKey} → ${replay.transactionId}`
          );
          return { success: true, data: replay };
        }
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
      await enforceTransactionLimits(customerId, amount, customerData);

      const { paymentFeeRate } = await getRates();
      const feeCents = computePaymentFee(amount, paymentFeeRate);
      const netCents = amount - feeCents;

      const transactionId = db.collection("transactions").doc().id;

      // With a key from the client the entry ID is stable across retries, so a
      // second attempt hits the ledger's own idempotency instead of posting
      // again. Without one it falls back to the server-generated transaction
      // ID, which is unique per call and therefore protects nobody — that is
      // the old-client path, not a design choice.
      const journalEntryId = isValidIdempotencyKey(idempotencyKey)
        ? scopedEntryId("paymerchant", customerId, idempotencyKey)
        : `paymerchant_${transactionId}`;

      let alreadyPosted = false;

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

        // Two taps in flight at once: the first commits, the second finds the
        // entry already posted. Writing the transaction row anyway would leave
        // a second receipt for a payment that happened once.
        if (pending.alreadyPosted) {
          alreadyPosted = true;
          return;
        }

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

      if (alreadyPosted) {
        // The other attempt did the work, including the notifications.
        const replay = await findPostedPayment(
          db,
          customerId,
          idempotencyKey as string
        );
        if (replay) {
          return { success: true, data: replay };
        }
        throw new https.HttpsError(
          "aborted",
          "This payment is already being processed. Check your history before retrying."
        );
      }

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
