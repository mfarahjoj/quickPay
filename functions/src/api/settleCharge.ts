/**
 * Paying an API charge: the one place it happens.
 *
 * Two ways reach it: the customer approving in Zapp with their PIN
 * (approveApiCharge), and the customer approving in a partner's app on their
 * phone under an agreement (agreements.ts). Both run the same guards and post
 * the same journal entry, so the two can never drift apart.
 */

import * as admin from "firebase-admin";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { requireActiveAccount } from "../utils/accountStatus";
import { enforceTransactionLimits } from "../utils/limits";
import { enforceVelocity } from "../utils/velocity";
import { Transaction } from "../types";
import { computePaymentFee, getRates } from "../config/rates";
import { prepareJournalEntry, userAccount, JournalLine, JOURNAL_COLLECTION, PLATFORM_FEES } from "../ledger";
import { ApiCharge } from "./types";
import { toLimitCents } from "../utils/money";

export function apiChargeEntryId(chargeId: string): string {
  return `apicharge_${chargeId}`;
}

/**
 * The checks that come before any payment from a customer's wallet: the
 * pause after a PIN reset, an active account, velocity, and the KYC limits.
 * Throws HttpsError, as each guard does.
 */
export async function assertCustomerMaySpend(customerId: string, charge: Pick<ApiCharge, "amount" | "currency">): Promise<void> {
  // Outgoing money waits out the pause after a PIN reset. A merchant's
  // online checkout or till counts as a shop.
  // The allowance and the limits are in dollars; shillings count at the rate.
  const { slsPerUsd } = await getRates();
  await assertResetCooldownAllows(
    customerId,
    "shop_payment",
    toLimitCents(charge.amount, charge.currency ?? "USD", slsPerUsd)
  );

  const customerData = await requireActiveAccount(customerId);
  await enforceVelocity(customerId);
  await enforceTransactionLimits(customerId, charge.amount, customerData, undefined, charge.currency ?? "USD");
}

export type SettleOutcome =
  | { kind: "paid"; charge: ApiCharge; feeCents: number; netCents: number }
  | { kind: "replay"; charge: ApiCharge; transactionId: string };

/**
 * Inside the caller's transaction, after the caller has re-read [charge] and
 * checked it may be paid by [customerId] now: post the entry, write the
 * transaction row, mark the charge succeeded. [extra] adds fields to the
 * charge update ([extra.charge]) and to the transaction row ([extra.row]).
 */
export async function settleChargeInTx(
  tx: FirebaseFirestore.Transaction,
  args: {
    chargeRef: FirebaseFirestore.DocumentReference;
    chargeId: string;
    charge: ApiCharge;
    customerId: string;
    feeRate: number;
    transactionId: string;
    now: FirebaseFirestore.Timestamp;
    extra?: { charge?: Record<string, unknown>; row?: Partial<Transaction> };
  }
): Promise<SettleOutcome> {
  const { chargeRef, chargeId, charge, customerId, feeRate, transactionId, now } = args;
  const db = admin.firestore();
  const journalEntryId = apiChargeEntryId(chargeId);

  // Merchant absorbs the platform fee and receives the net.
  const feeCents = computePaymentFee(charge.amount, feeRate);
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
      ...(args.extra?.charge ?? {}),
    });
    return { kind: "replay", charge, transactionId: postedTxId };
  }

  pending.write(tx);

  const txRecord: Transaction = {
    type: "payment",
    kind: "online_payment",
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
    ...(args.extra?.row ?? {}),
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
    ...(args.extra?.charge ?? {}),
  });

  return { kind: "paid", charge, feeCents, netCents };
}
