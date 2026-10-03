/**
 * Customer side of an API charge: look it up, then approve it.
 *
 * approveApiCharge is the only place money moves for a charge. It is
 * payMerchant with the amount and merchant taken from the charge instead of
 * the client, and the charge doc as the idempotency anchor: the journal entry
 * is `apicharge_{chargeId}`, and a charge resolves exactly once.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { requireAuth } from "../utils/validation";
import { assertAccountActive, requireActiveAccount } from "../utils/accountStatus";
import { enforceTransactionLimits } from "../utils/limits";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import { notifyPaymentReceived, notifyPaymentSent } from "../utils/notifications";
import { ApiResponse, Transaction, User } from "../types";
import { getRates, computePaymentFee } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  JOURNAL_COLLECTION,
  PLATFORM_FEES,
  InsufficientBalanceError,
  FrozenAccountError,
  WalletNotFoundError,
} from "../ledger";
import { CHARGE_ID_PATTERN, effectiveStatus, isLapsed } from "./charges";
import { isMerchantAccount } from "./keys";
import { API_CHARGES_COLLECTION, ApiCharge, ApiChargeStatus } from "./types";

export function apiChargeEntryId(chargeId: string): string {
  return `apicharge_${chargeId}`;
}

function requireChargeId(chargeId: unknown): string {
  if (typeof chargeId !== "string" || !CHARGE_ID_PATTERN.test(chargeId)) {
    throw new https.HttpsError("invalid-argument", "A valid charge ID is required");
  }
  return chargeId;
}

/** Matches approvePaymentRequest's wording, which the app already recognises. */
function alreadyResolved(status: ApiChargeStatus): string {
  return `Request is already ${status === "succeeded" ? "paid" : status === "canceled" ? "cancelled" : status}`;
}

/** A charge addressed to one customer is refused to everyone else. */
function assertPayableBy(charge: ApiCharge, customerId: string): void {
  if (charge.customerId && charge.customerId !== customerId) {
    throw new https.HttpsError(
      "permission-denied",
      "This payment request is for a different customer"
    );
  }
  if (charge.merchantId === customerId) {
    throw new https.HttpsError("permission-denied", "Cannot pay yourself");
  }
}

interface GetApiChargeResponse {
  chargeId: string;
  merchantName: string;
  amount: number;
  currency: string;
  reference?: string;
  status: ApiChargeStatus;
  /** True when this customer already paid it (a reopened link or a replay). */
  paidByYou: boolean;
  transactionId?: string;
  expiresAt: string;
  /** Seconds left at the time of the reply, for a countdown immune to clock skew. */
  expiresInSeconds: number;
}

/**
 * What the approval screen shows before the PIN. Holding the charge ID is the
 * capability, as with the hosted checkout; the reply carries nothing the
 * checkout page does not already show.
 */
export const getApiCharge = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ chargeId: string }>
  ): Promise<ApiResponse<GetApiChargeResponse>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const chargeId = requireChargeId(request.data?.chargeId);

    const snap = await admin.firestore().collection(API_CHARGES_COLLECTION).doc(chargeId).get();
    if (!snap.exists) {
      throw new https.HttpsError("not-found", "Payment request not found");
    }
    const charge = snap.data() as ApiCharge;
    const paidByYou = charge.status === "succeeded" && charge.paidBy === customerId;
    if (!paidByYou) assertPayableBy(charge, customerId);

    const now = Date.now();
    const expiresMs = charge.expiresAt.toMillis();
    return {
      success: true,
      data: {
        chargeId,
        merchantName: charge.merchantName,
        amount: charge.amount,
        currency: charge.currency,
        ...(charge.reference ? { reference: charge.reference } : {}),
        status: effectiveStatus(charge, now),
        paidByYou,
        ...(paidByYou && charge.transactionId ? { transactionId: charge.transactionId } : {}),
        expiresAt: new Date(expiresMs).toISOString(),
        expiresInSeconds: Math.max(0, Math.round((expiresMs - now) / 1000)),
      },
    };
  }
);

interface ApproveApiChargeInput {
  chargeId: string;
  pin: string;
  /**
   * The amount the customer was shown, in cents. The approval is refused
   * unless it matches the charge — the customer pays what they saw or nothing.
   */
  expectedAmount: number;
}

interface ApproveApiChargeResponse {
  transactionId: string;
  amount: number;
  merchantName: string;
}

export const approveApiCharge = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ApproveApiChargeInput>
  ): Promise<ApiResponse<ApproveApiChargeResponse>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const { pin, expectedAmount } = request.data ?? ({} as ApproveApiChargeInput);
    const chargeId = requireChargeId(request.data?.chargeId);

    if (!pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }
    if (typeof expectedAmount !== "number" || !Number.isInteger(expectedAmount)) {
      throw new https.HttpsError("invalid-argument", "expectedAmount must be whole cents");
    }

    const db = admin.firestore();
    const chargeRef = db.collection(API_CHARGES_COLLECTION).doc(chargeId);
    const journalEntryId = apiChargeEntryId(chargeId);

    try {
      const pinValid = await verifyUserPin(customerId, pin);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }

      const preSnap = await chargeRef.get();
      if (!preSnap.exists) {
        throw new https.HttpsError("not-found", "Payment request not found");
      }
      const preCharge = preSnap.data() as ApiCharge;

      // A retry after the first approval's reply was lost. Answered before
      // velocity and limits, which already count this payment and would refuse
      // the retry of a payment that went through.
      if (preCharge.status === "succeeded" && preCharge.paidBy === customerId) {
        return {
          success: true,
          data: {
            transactionId: preCharge.transactionId ?? "",
            amount: preCharge.amount,
            merchantName: preCharge.merchantName,
          },
        };
      }

      if (preCharge.status !== "pending") {
        throw new https.HttpsError("failed-precondition", alreadyResolved(preCharge.status));
      }
      assertPayableBy(preCharge, customerId);
      if (expectedAmount !== preCharge.amount) {
        throw new https.HttpsError(
          "failed-precondition",
          "The amount of this request does not match what was shown"
        );
      }

      // Outgoing money waits out the pause after a PIN reset. A merchant's
      // online checkout or till counts as a shop.
      await assertResetCooldownAllows(customerId, "shop_payment", preCharge.amount);

      const customerData = await requireActiveAccount(customerId);
      await enforceVelocity(customerId);
      await enforceTransactionLimits(customerId, preCharge.amount, customerData);

      // Roles and status can change between the charge and the approval.
      const merchantSnap = await db.collection("users").doc(preCharge.merchantId).get();
      const merchant = merchantSnap.data() as User | undefined;
      if (!merchantSnap.exists || !isMerchantAccount(merchant)) {
        throw new https.HttpsError(
          "failed-precondition",
          "This merchant can no longer take payments"
        );
      }
      assertAccountActive(merchant, "counterparty");

      const { onlinePaymentFeeRate } = await getRates();
      const transactionId = db.collection("transactions").doc().id;

      type Outcome =
        | { kind: "paid"; charge: ApiCharge; feeCents: number; netCents: number }
        | { kind: "replay"; charge: ApiCharge; transactionId: string }
        | { kind: "lapsed" };

      const outcome: Outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
        const snap = await tx.get(chargeRef);
        const charge = snap.data() as ApiCharge;

        if (charge.status === "succeeded" && charge.paidBy === customerId) {
          return { kind: "replay", charge, transactionId: charge.transactionId ?? "" };
        }
        if (charge.status !== "pending") {
          throw new https.HttpsError("failed-precondition", alreadyResolved(charge.status));
        }
        const now = admin.firestore.Timestamp.now();
        if (isLapsed(charge, now.toMillis())) {
          // Record the expiry, then refuse once the transaction has committed:
          // throwing in here would roll the write back.
          tx.update(chargeRef, { status: "expired", expiredAt: now });
          return { kind: "lapsed" };
        }
        // Re-checked on the authoritative copy.
        assertPayableBy(charge, customerId);
        if (charge.amount !== expectedAmount) {
          throw new https.HttpsError(
            "failed-precondition",
            "The amount of this request does not match what was shown"
          );
        }

        // Merchant absorbs the platform fee and receives the net.
        const feeCents = computePaymentFee(charge.amount, onlinePaymentFeeRate);
        const netCents = charge.amount - feeCents;

        const lines: JournalLine[] = [
          { account: userAccount(customerId), debit: charge.amount, credit: 0 },
          { account: userAccount(charge.merchantId), debit: 0, credit: netCents },
        ];
        if (feeCents > 0) {
          lines.push({ account: PLATFORM_FEES, debit: 0, credit: feeCents });
        }

        const description = `Payment to ${charge.merchantName}`;
        const pending = await prepareJournalEntry(tx, {
          entryId: journalEntryId,
          type: "online_payment",
          currency: charge.currency,
          lines,
          refs: { transactionId, apiChargeId: chargeId },
          description,
          postedBy: customerId,
        });

        if (pending.alreadyPosted) {
          // The entry and the charge update are written together, so this
          // should not happen. Settle the charge on the transaction the entry
          // names rather than write a second receipt.
          const entrySnap = await tx.get(db.collection(JOURNAL_COLLECTION).doc(journalEntryId));
          const postedTxId = (entrySnap.data()?.refs?.transactionId as string | undefined) ?? "";
          tx.update(chargeRef, {
            status: "succeeded",
            succeededAt: now,
            paidBy: customerId,
            journalEntryId,
            ...(postedTxId ? { transactionId: postedTxId } : {}),
          });
          return { kind: "replay", charge, transactionId: postedTxId };
        }

        pending.write(tx);

        const txRecord: Transaction = {
          type: "payment",
          fromUserId: customerId,
          toUserId: charge.merchantId,
          participants: [customerId, charge.merchantId],
          amount: charge.amount,
          feeCents,
          netCents,
          currency: charge.currency,
          status: "completed",
          description,
          ...(charge.reference ? { reference: charge.reference } : {}),
          journalEntryId,
          apiChargeId: chargeId,
          createdAt: now,
          completedAt: now,
        };
        tx.set(db.collection("transactions").doc(transactionId), txRecord);

        tx.update(chargeRef, {
          status: "succeeded",
          succeededAt: now,
          paidBy: customerId,
          transactionId,
          journalEntryId,
          feeCents,
          netCents,
        });

        return { kind: "paid", charge, feeCents, netCents };
      });

      if (outcome.kind === "lapsed") {
        throw new https.HttpsError("failed-precondition", "Payment request has expired");
      }
      if (outcome.kind === "replay") {
        return {
          success: true,
          data: {
            transactionId: outcome.transactionId,
            amount: outcome.charge.amount,
            merchantName: outcome.charge.merchantName,
          },
        };
      }

      const { charge, netCents } = outcome;
      notifyPaymentReceived(charge.merchantId, netCents, charge.currency, customerId).catch(
        (err) => console.error("Failed to notify merchant:", err)
      );
      notifyPaymentSent(customerId, charge.amount, charge.currency, charge.merchantId).catch(
        (err) => console.error("Failed to notify customer:", err)
      );

      console.log(`API charge ${chargeId} paid: ${transactionId}`);
      return {
        success: true,
        data: { transactionId, amount: charge.amount, merchantName: charge.merchantName },
      };
    } catch (error: unknown) {
      if (error instanceof https.HttpsError) throw error;
      if (error instanceof InsufficientBalanceError) {
        throw new https.HttpsError("failed-precondition", "Insufficient balance");
      }
      if (error instanceof FrozenAccountError) {
        throw new https.HttpsError("permission-denied", "Account is frozen");
      }
      if (error instanceof WalletNotFoundError) {
        throw new https.HttpsError("failed-precondition", "Wallet not found");
      }
      console.error("Error approving API charge:", error);
      throw new https.HttpsError("internal", "Failed to process payment");
    }
  }
);
