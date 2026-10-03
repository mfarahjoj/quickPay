/**
 * Merchant-initiated refunds of an API charge, full or partial.
 *
 * Each refund is its own journal entry, `refund_apicharge_{chargeId}_{n}`,
 * where n counts the charge's refunds — read and bumped in the same
 * transaction that posts, so it is deterministic and two refunds can never
 * take the same number. The Idempotency-Key maps a retry back to the refund it
 * already made.
 *
 * The platform returns its fee in proportion, computed on the running total
 * so a charge refunded in pieces hands back exactly the fee a single full
 * refund would. That matches refundPayment, which returns the whole fee.
 *
 * No PIN: the API key is the merchant's credential for this server-to-server
 * call. What a leaked key can do here is bounded — money only goes back to the
 * customer who paid, and never more than they paid.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { Transaction } from "../types";
import { notifyUser } from "../utils/notifications";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
  InsufficientBalanceError,
  FrozenAccountError,
  WalletNotFoundError,
} from "../ledger";
import { ApiCaller } from "./keys";
import { ApiError, badRequest, conflict } from "./http";
import { getOwnCharge, parseAmount } from "./charges";
import {
  idempotencyDocId,
  idempotencyMismatch,
  requestFingerprint,
} from "./requestGuards";
import {
  API_CHARGES_COLLECTION,
  API_IDEMPOTENCY_COLLECTION,
  API_REFUNDS_COLLECTION,
  ApiCharge,
  ApiIdempotencyRecord,
  ApiRefund,
} from "./types";

const MAX_REASON = 200;

export function refundEntryId(chargeId: string, n: number): string {
  return `refund_apicharge_${chargeId}_${n}`;
}

/**
 * Fee handed back when `refunded` of `amount` has been refunded in total.
 * Rounded on the cumulative figure, so the pieces always add up to the fee.
 */
export function cumulativeFeeReturned(fee: number, amount: number, refunded: number): number {
  if (refunded >= amount) return fee;
  return Math.round((fee * refunded) / amount);
}

export function serializeRefund(id: string, refund: ApiRefund) {
  return {
    id,
    object: "refund",
    charge: refund.chargeId,
    amount: refund.amount,
    fee_returned: refund.feeReturned,
    currency: "USD",
    reason: refund.reason ?? null,
    status: "succeeded",
    transaction_id: refund.transactionId,
    created: refund.createdAt.toDate().toISOString(),
  };
}

export async function createRefund(
  caller: ApiCaller,
  chargeId: string,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<{ id: string; refund: ApiRefund; replayed: boolean }> {
  // 404 for an unknown or someone else's charge, before anything else.
  await getOwnCharge(caller.merchantId, chargeId);

  const requested = body.amount === undefined || body.amount === null ? undefined : parseAmount(body.amount);
  const reason = body.reason;
  if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > MAX_REASON)) {
    throw badRequest("parameter_invalid", `reason must be a string of at most ${MAX_REASON} characters`, "reason");
  }
  const trimmedReason = typeof reason === "string" && reason.trim() ? reason.trim() : undefined;

  const db = admin.firestore();
  const chargeRef = db.collection(API_CHARGES_COLLECTION).doc(chargeId);
  const idemRef = db
    .collection(API_IDEMPOTENCY_COLLECTION)
    .doc(idempotencyDocId(caller.merchantId, "refund", idempotencyKey));
  const requestHash = requestFingerprint({ chargeId, amount: requested ?? null, reason: trimmedReason ?? null });
  const refundRef = db.collection(API_REFUNDS_COLLECTION).doc(`re_${crypto.randomBytes(18).toString("base64url")}`);
  const refundTxId = db.collection("transactions").doc().id;

  type Outcome =
    | { replayOf: string }
    | { refund: ApiRefund; charge: ApiCharge };

  let outcome: Outcome;
  try {
    outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) {
        const record = idemSnap.data() as ApiIdempotencyRecord;
        if (record.requestHash !== requestHash) throw idempotencyMismatch();
        return { replayOf: record.objectId };
      }

      const charge = (await tx.get(chargeRef)).data() as ApiCharge;
      if (charge.status !== "succeeded" || !charge.paidBy || !charge.transactionId) {
        throw conflict("charge_not_succeeded", "Only a charge that has been paid can be refunded");
      }

      // The payment's own row, for the in-app refund marker: a payment refunded
      // some other way must not be refunded again here.
      const paymentRef = db.collection("transactions").doc(charge.transactionId);
      const payment = (await tx.get(paymentRef)).data() as Transaction | undefined;
      const refundedSoFar = charge.amountRefunded ?? 0;
      if (payment?.refundedAt && !payment.apiChargeId) {
        throw conflict("charge_already_refunded", "This charge has already been refunded");
      }

      const remaining = charge.amount - refundedSoFar;
      if (remaining <= 0) {
        throw conflict("charge_already_refunded", "This charge has already been fully refunded");
      }
      const amount = requested ?? remaining;
      if (amount > remaining) {
        throw badRequest(
          "amount_too_large",
          `amount exceeds the ${remaining} cents left to refund on this charge`,
          "amount"
        );
      }

      const fee = charge.feeCents ?? 0;
      const feeRefundedSoFar = charge.feeRefunded ?? 0;
      const newTotal = refundedSoFar + amount;
      const feeReturned = Math.min(
        amount,
        Math.max(0, cumulativeFeeReturned(fee, charge.amount, newTotal) - feeRefundedSoFar)
      );
      const fromMerchant = amount - feeReturned;

      // Merchant hands back what they netted on this share, the platform its
      // fee on it; the customer gets the whole share back.
      const lines: JournalLine[] = [
        { account: userAccount(charge.paidBy), debit: 0, credit: amount },
      ];
      if (fromMerchant > 0) {
        lines.push({ account: userAccount(charge.merchantId), debit: fromMerchant, credit: 0 });
      }
      if (feeReturned > 0) {
        lines.push({ account: PLATFORM_FEES, debit: feeReturned, credit: 0 });
      }

      const n = (charge.refundCount ?? 0) + 1;
      const journalEntryId = refundEntryId(chargeId, n);
      const pending = await prepareJournalEntry(tx, {
        entryId: journalEntryId,
        type: "refund",
        currency: charge.currency,
        lines,
        refs: {
          transactionId: refundTxId,
          refundOfEntryId: charge.journalEntryId,
          apiChargeId: chargeId,
          apiRefundId: refundRef.id,
        },
        description: "Refund",
        postedBy: caller.merchantId,
      });
      if (pending.alreadyPosted) {
        // refundCount is bumped in the same transaction as the entry, so the
        // next number is always free. If it is not, something wrote around us.
        throw conflict("refund_conflict", "Could not number this refund. Retry the request.");
      }

      const now = admin.firestore.Timestamp.now();
      pending.write(tx);

      const refund: ApiRefund = {
        chargeId,
        merchantId: charge.merchantId,
        customerId: charge.paidBy,
        amount,
        feeReturned,
        ...(trimmedReason ? { reason: trimmedReason } : {}),
        journalEntryId,
        transactionId: refundTxId,
        keyId: caller.keyId,
        createdAt: now,
      };
      tx.create(refundRef, refund);

      const refundRecord: Transaction = {
        type: "refund",
        fromUserId: charge.merchantId,
        toUserId: charge.paidBy,
        participants: [charge.merchantId, charge.paidBy],
        amount,
        feeCents: feeReturned,
        netCents: fromMerchant,
        currency: charge.currency,
        status: "completed",
        description: "Refund",
        ...(charge.reference ? { reference: charge.reference } : {}),
        refundOfTransactionId: charge.transactionId,
        journalEntryId,
        apiChargeId: chargeId,
        createdAt: now,
        completedAt: now,
      };
      tx.set(db.collection("transactions").doc(refundTxId), refundRecord);

      tx.update(chargeRef, {
        amountRefunded: newTotal,
        feeRefunded: feeRefundedSoFar + feeReturned,
        refundCount: n,
      });

      // Apps show a payment as refunded from its own row.
      tx.update(paymentRef, {
        amountRefunded: newTotal,
        ...(newTotal >= charge.amount ? { refundedAt: now, refundTransactionId: refundTxId } : {}),
      });

      const record: ApiIdempotencyRecord = {
        merchantId: caller.merchantId,
        scope: "refund",
        requestHash,
        objectId: refundRef.id,
        createdAt: now,
      };
      tx.create(idemRef, record);

      return { refund, charge };
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      throw conflict("insufficient_balance", "Your Zapp balance is too low to make this refund");
    }
    if (err instanceof FrozenAccountError) {
      throw new ApiError(403, "permission_error", "account_inactive", "This merchant account is frozen");
    }
    if (err instanceof WalletNotFoundError) {
      throw conflict("wallet_missing", "A wallet for this refund is missing. Contact Zapp support.");
    }
    throw err;
  }

  if ("replayOf" in outcome) {
    const snap = await db.collection(API_REFUNDS_COLLECTION).doc(outcome.replayOf).get();
    return { id: snap.id, refund: snap.data() as ApiRefund, replayed: true };
  }

  const { refund } = outcome;
  notifyUser(
    refund.customerId,
    "refund_issued",
    "Refund Received",
    `You were refunded USD ${(refund.amount / 100).toFixed(2)}`,
    { type: "refund_issued", amount: refund.amount.toString(), currency: "USD", merchantId: refund.merchantId }
  ).catch((err) => console.error("Failed to notify customer of refund:", err));

  return { id: refundRef.id, refund, replayed: false };
}
