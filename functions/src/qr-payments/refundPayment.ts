import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
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
import { isValidIdempotencyKey } from "../utils/idempotency";
import { DISPUTES_COLLECTION, DisputeDoc } from "../disputes/types";
import { stageResolvedByRefund } from "../disputes/resolve";
import { parseCurrency, pushAmount } from "../utils/money";
import { requireMerchantActor } from "../staff/access";
import { assertWithinCaps, capCents, refundDayRef, stageRefundDay } from "../staff/refunds";
import { StaffRefundDay } from "../staff/types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface RefundRequest {
  transactionId: string;
  pin: string;
  /** Partial refund (plan 3.3); omit to refund everything left. */
  amountCents?: number;
  /** Required with a partial refund; resend the same one on retry. */
  idempotencyKey?: string;
  /**
   * A staff manager refunding for this shop (STAFF_ACCESS.md), with their own
   * PIN and within the caps the shop set. Omitted by the shop itself.
   */
  merchantId?: string;
}

interface RefundResponse {
  refundTransactionId: string;
  /** Zapp receipt number of the refund. */
  receiptNumber?: string;
  /** Gross amount refunded, in whole units: dollars, or shillings. */
  amount: number;
  /** The payment's currency: "USD" or "SLS". */
  currency: string;
  /** What is still refundable, in the currency's smallest unit. */
  remainingCents: number;
}

/**
 * Callable function for a merchant to refund a payment they received, in full
 * or in part. Reverses the merchant's net, the platform's fee, and returns the
 * gross to the customer, then records a refund transaction.
 *
 * A staff manager may call it for the shop (`merchantId`) with their own PIN.
 * The money still comes from the shop's wallet; the manager is recorded on the
 * entry and the row, and the refund must fit the caps on their grant.
 */
export const refundPayment = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RefundRequest>
  ): Promise<ApiResponse<RefundResponse>> => {
    const actor = await requireMerchantActor(request, request.data?.merchantId, "refund");
    const merchantId = actor.merchantUid;
    const staff = actor.role !== "owner" ? { uid: actor.actorUid, grant: actor.grant! } : null;

    const { transactionId, pin, amountCents } = request.data;
    const partKey = request.data.idempotencyKey;
    if (partKey !== undefined && !isValidIdempotencyKey(partKey)) {
      throw new https.HttpsError("invalid-argument", "idempotencyKey is malformed");
    }

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

      const { refundWindowDays, slsPerUsd } = await getRates();
      const paidAt = (original.completedAt ?? original.createdAt)?.toMillis?.();
      if (!paidAt || Date.now() - paidAt > refundWindowDays * DAY_MS) {
        throw new https.HttpsError(
          "failed-precondition",
          `Payments can be refunded for ${refundWindowDays} days. Contact support for older ones.`,
          { reason: "refund_window_closed", refundWindowDays }
        );
      }

      // Whoever is refunding confirms with their own PIN: a manager never
      // knows or uses the shop's.
      const pinValid = await verifyUserPin(staff?.uid ?? merchantId, pin);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }

      // Outgoing money waits out the pause after a PIN reset: the shop's, and
      // a manager's own (a stolen phone with a reset PIN can't refund either).
      await assertResetCooldownAllows(merchantId, "other", 0);
      if (staff) await assertResetCooldownAllows(staff.uid, "other", 0);

      await requireActiveAccount(merchantId);

      const disputeRef = original.disputeId
        ? db.collection(DISPUTES_COLLECTION).doc(original.disputeId)
        : null;

      const day = staff ? refundDayRef(merchantId, staff.uid, Date.now()) : null;

      const outcome = await db.runTransaction(async (tx) => {
        // Reads first: the manager's day total, the dispute, then the original
        // under lock and the ledger.
        const daySnap = day ? await tx.get(day.ref) : null;
        const disputeSnap = disputeRef ? await tx.get(disputeRef) : null;
        const refund = await prepareRefund(tx, transactionId, {
          postedBy: staff?.uid ?? merchantId,
          ...(staff ? { actorUid: staff.uid } : {}),
          ...(amountCents !== undefined ? { amountCents } : {}),
          ...(partKey ? { partKey } : {}),
        });
        // A manager's refund must fit their caps; a replay was counted the first time.
        if (staff && day && !refund.alreadyPosted) {
          const cents = capCents(refund.gross, refund.currency, slsPerUsd);
          const prev = daySnap?.data() as StaffRefundDay | undefined;
          assertWithinCaps(staff.grant, cents, prev?.usedCents ?? 0);
          stageRefundDay(tx, day.ref, prev, { merchantUid: merchantId, staffUid: staff.uid, day: day.day, cents });
        }
        refund.write(tx);
        // Refunding the whole payment answers an open dispute on it; a
        // partial refund leaves the dispute for the customer to accept.
        const closedDispute =
          refund.completesRefund &&
          disputeRef !== null &&
          stageResolvedByRefund(tx, disputeRef, disputeSnap?.data() as DisputeDoc | undefined, {
            refundTransactionId: refund.refundTransactionId,
            gross: refund.gross,
            merchantId,
            journalEntryId: refund.journalEntryId,
          });
        return { refund, closedDispute };
      });

      const {
        refundTransactionId,
        receiptNumber,
        customerId,
        gross,
        currency,
        remainingCents,
        alreadyPosted,
      } = outcome.refund;

      if (!alreadyPosted) notifyUser(
        customerId,
        "refund_issued",
        { key: "refund.received", params: { amount: pushAmount(gross, currency) } },
        { type: "refund_issued", amount: gross.toString(), currency, merchantId }
      ).catch((err) => console.error("Failed to notify customer:", err));

      // The shop hears about every refund a manager gives from its wallet.
      if (!alreadyPosted && staff) notifyUser(
        merchantId,
        "staff",
        {
          key: "staff.refunded",
          params: { name: staff.grant.staffName || "Your manager", amount: pushAmount(gross, currency) },
        },
        { type: "staff_refund", amount: gross.toString(), currency, refundTransactionId }
      ).catch((err) => console.error("Failed to tell the shop about a staff refund:", err));

      return {
        success: true,
        data: {
          refundTransactionId,
          ...(receiptNumber ? { receiptNumber } : {}),
          // In whole units, as history rows carry it: 12.5 dollars, or 30000
          // shillings (a shilling has no cents).
          amount: parseCurrency(currency) === "SLS" ? gross : gross / 100,
          currency,
          remainingCents,
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
