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
  /** Allow the merchant's debit to use money reserved for disputes they lost. */
  useReserved?: boolean;
  /** Dispute this refund settles, recorded on the rows. */
  disputeId?: string;
  /** Disputes may take a lost claim from a frozen merchant, like adjustments. */
  allowFrozenDebit?: boolean;
}

export interface PreparedRefund {
  refundTransactionId: string;
  merchantId: string;
  customerId: string;
  gross: number;
  currency: string;
  write(tx: FirebaseFirestore.Transaction): void;
}

/**
 * Reads only: the original under the transaction's lock, then the ledger.
 * Throws if it was already refunded. Callers check eligibility first.
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
  if (original.refundedAt) {
    throw new https.HttpsError("failed-precondition", "This payment has already been refunded");
  }

  const merchantId = original.toUserId;
  const customerId = original.fromUserId;
  const gross = original.amount;
  const fee = original.feeCents ?? 0;
  const net = original.netCents ?? original.amount;
  const currency = original.currency;
  const refundTransactionId = db.collection("transactions").doc().id;
  const entryId = `refund_${transactionId}`;

  const lines: JournalLine[] = [
    { account: userAccount(merchantId), debit: net, credit: 0 },
    { account: userAccount(customerId), debit: 0, credit: gross },
  ];
  if (fee > 0) {
    lines.push({ account: PLATFORM_FEES, debit: fee, credit: 0 });
  }

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
    description: "Refund",
    postedBy: opts.postedBy,
    ...(opts.useReserved ? { useReserved: true } : {}),
    ...(opts.allowFrozenDebit ? { allowFrozenDebit: true } : {}),
  });

  return {
    refundTransactionId,
    merchantId,
    customerId,
    gross,
    currency,
    write(t) {
      const now = admin.firestore.Timestamp.now();
      pending.write(t);
      const refundRecord: Transaction = {
        type: "refund",
        kind: "refund",
        fromUserId: merchantId,
        toUserId: customerId,
        participants: [merchantId, customerId],
        amount: gross,
        feeCents: fee,
        netCents: net,
        currency,
        status: "completed",
        description: "Refund",
        ...(original.reference ? { reference: original.reference } : {}),
        refundOfTransactionId: transactionId,
        journalEntryId: entryId,
        ...(opts.disputeId ? { disputeId: opts.disputeId } : {}),
        createdAt: now,
        completedAt: now,
      };
      t.set(db.collection("transactions").doc(refundTransactionId), refundRecord);
      t.update(originalRef, { refundedAt: now, refundTransactionId });
    },
  };
}
