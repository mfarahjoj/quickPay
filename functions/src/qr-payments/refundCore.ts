/**
 * The full reversal of a counter payment, shared by the merchant's own
 * refund (`refundPayment`) and by a dispute ops uphold.
 *
 * Exact reversal of the payment entry: the merchant returns the net, the
 * platform returns its fee, the customer gets the gross back. The entry ID
 * derives from the original payment, so a payment can refund only once,
 * whichever path asks first.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { Transaction } from "../types";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  JournalEntryType,
  PLATFORM_FEES,
} from "../ledger";

/**
 * The entries a merchant may refund from the app: payments a customer made
 * at their counter. P2P and payroll rows are typed `payment` too, so the row
 * type can't tell them apart; the journal entry behind the row can. Online
 * payments are refunded through the API instead.
 */
export const REFUNDABLE_ENTRY_TYPES: readonly JournalEntryType[] = [
  "qr_payment",
  "customer_qr_payment",
];

export interface RefundOptions {
  /** uid of the merchant, or the admin settling a dispute. */
  postedBy: string;
  /**
   * Cents to give back; defaults to everything not yet refunded. Less than
   * that is a partial refund (plan 3.3), which needs `partKey`.
   */
  amountCents?: number;
  /**
   * Idempotency key for one partial refund, minted by the merchant app per
   * attempt and resent on retry, so a dropped response can't refund twice.
   */
  partKey?: string;
  /** Allow the merchant's debit to use money reserved for disputes they lost. */
  useReserved?: boolean;
  /** Dispute this refund settles, recorded on the rows. */
  disputeId?: string;
  /** Disputes may take a lost claim from a frozen merchant, like adjustments. */
  allowFrozenDebit?: boolean;
}

export interface PreparedRefund {
  /** True if this exact partial refund was already posted; write() is a no-op. */
  alreadyPosted: boolean;
  refundTransactionId: string;
  journalEntryId: string;
  merchantId: string;
  customerId: string;
  /** Cents refunded by this call. */
  gross: number;
  /** Cents of the payment still refundable after this call. */
  remainingCents: number;
  /** True when this call refunds the last of the payment. */
  completesRefund: boolean;
  currency: string;
  write(tx: FirebaseFirestore.Transaction): void;
}

/**
 * Reads only: the original under the transaction's lock, then the ledger.
 * Throws if nothing is left to refund. Callers check eligibility first.
 *
 * A partial refund returns the platform fee in proportion. The refund that
 * finishes the payment returns exactly what's left of the fee, so rounding
 * across several partial refunds can't leave the platform a cent up or down.
 */
export async function prepareRefund(
  tx: FirebaseFirestore.Transaction,
  transactionId: string,
  opts: RefundOptions
): Promise<PreparedRefund> {
  const db = admin.firestore();
  const originalRef = db.collection("transactions").doc(transactionId);
  const snap = await tx.get(originalRef);
  if (!snap.exists) {
    throw new https.HttpsError("not-found", "Transaction not found");
  }
  const original = snap.data() as Transaction;
  const gross = original.amount;
  const fee = original.feeCents ?? 0;
  const refundedSoFar = original.refundedCents ?? (original.refundedAt ? gross : 0);
  const feeRefundedSoFar = original.refundedFeeCents ?? (original.refundedAt ? fee : 0);
  const remaining = gross - refundedSoFar;
  if (original.refundedAt || remaining <= 0) {
    throw new https.HttpsError("failed-precondition", "This payment has already been refunded");
  }

  const amount = opts.amountCents ?? remaining;
  if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) {
    throw new https.HttpsError(
      "invalid-argument",
      `You can refund between $0.01 and $${(remaining / 100).toFixed(2)}`,
      { reason: "refund_amount", remainingCents: remaining }
    );
  }
  const completes = amount === remaining;
  const whole = completes && refundedSoFar === 0;
  if (!whole && !opts.partKey) {
    throw new https.HttpsError("invalid-argument", "A partial refund needs an idempotency key");
  }

  const feeLeft = fee - feeRefundedSoFar;
  const feePart = completes ? feeLeft : Math.min(feeLeft, Math.round((fee * amount) / gross));
  const netPart = amount - feePart;

  const merchantId = original.toUserId;
  const customerId = original.fromUserId;
  const currency = original.currency;
  // A whole refund keeps the original id, so a payment refunds in full once
  // whichever path asks first. Partial refunds are keyed per attempt.
  const entryId = whole ? `refund_${transactionId}` : `refund_${transactionId}_${opts.partKey}`;
  const refundTransactionId = whole ? db.collection("transactions").doc().id : entryId;

  const lines: JournalLine[] = [
    { account: userAccount(customerId), debit: 0, credit: amount },
  ];
  if (netPart > 0) lines.push({ account: userAccount(merchantId), debit: netPart, credit: 0 });
  if (feePart > 0) lines.push({ account: PLATFORM_FEES, debit: feePart, credit: 0 });

  const pending = await prepareJournalEntry(tx, {
    entryId,
    type: "refund",
    currency: currency as "USD" | "SLS",
    lines,
    refs: {
      transactionId: refundTransactionId,
      refundOfEntryId: original.journalEntryId,
      ...(opts.disputeId ? { disputeId: opts.disputeId } : {}),
    },
    description: completes && !whole ? "Final refund" : whole ? "Refund" : "Partial refund",
    postedBy: opts.postedBy,
    ...(opts.useReserved ? { useReserved: true } : {}),
    ...(opts.allowFrozenDebit ? { allowFrozenDebit: true } : {}),
  });

  return {
    alreadyPosted: pending.alreadyPosted,
    refundTransactionId,
    journalEntryId: entryId,
    merchantId,
    customerId,
    gross: amount,
    remainingCents: pending.alreadyPosted ? remaining : remaining - amount,
    completesRefund: completes && !pending.alreadyPosted,
    currency,
    write(t) {
      if (pending.alreadyPosted) return;
      const now = admin.firestore.Timestamp.now();
      pending.write(t);
      const refundRecord: Transaction = {
        type: "refund",
        kind: "refund",
        fromUserId: merchantId,
        toUserId: customerId,
        participants: [merchantId, customerId],
        amount,
        feeCents: feePart,
        netCents: netPart,
        currency,
        status: "completed",
        description: whole ? "Refund" : "Partial refund",
        ...(original.reference ? { reference: original.reference } : {}),
        refundOfTransactionId: transactionId,
        journalEntryId: entryId,
        ...(opts.disputeId ? { disputeId: opts.disputeId } : {}),
        createdAt: now,
        completedAt: now,
      };
      t.set(db.collection("transactions").doc(refundTransactionId), refundRecord);
      t.update(originalRef, {
        refundedCents: refundedSoFar + amount,
        refundedFeeCents: feeRefundedSoFar + feePart,
        refundCount: (original.refundCount ?? (refundedSoFar > 0 ? 1 : 0)) + 1,
        lastRefundTransactionId: refundTransactionId,
        ...(completes ? { refundedAt: now, refundTransactionId } : {}),
      });
    },
  };
}
