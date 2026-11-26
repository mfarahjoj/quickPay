/**
 * Paying a bill: the one place money moves for bills, used by the customer's
 * Pay (payBill, after their PIN) and by auto-pay (schedule.ts, under the
 * customer's auto-pay setting for that shop).
 *
 * Ledger: the same shape as a shop payment. The customer is debited the bill,
 * the shop credited the amount less the payment fee, the fee to platform:fees.
 * The entry ID is `bill_{billId}`: a bill can be paid once, whoever tries.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertAccountActive } from "../utils/accountStatus";
import { enforceTransactionLimits } from "../utils/limits";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { getRates, computePaymentFee } from "../config/rates";
import { toLimitCents } from "../utils/money";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
} from "../ledger";
import { claimReceiptNumber, reserveReceiptNumber } from "../utils/receiptNumber";
import { Transaction, User } from "../types";
import {
  BILLS,
  BILL_AUTOPAY,
  Bill,
  BillAutopay,
  autopayId,
  billEntryId,
} from "./types";

export interface SettledBill {
  billId: string;
  transactionId: string;
  receiptNumber?: string;
  amount: number;
  netCents: number;
  currency: string;
  merchantId: string;
  merchantName: string;
  /** True when it had been paid already: nothing moved on this call. */
  alreadyPaid: boolean;
}

/** Why auto-pay may not pay a bill; the bill then waits for the customer. */
export class AutopayNotAllowed extends Error {
  constructor(readonly reason: "off" | "over_limit" | "currency") {
    super(`Auto-pay not allowed: ${reason}`);
  }
}

function settledFrom(billId: string, bill: Bill, alreadyPaid: boolean, netCents = 0): SettledBill {
  return {
    billId,
    transactionId: bill.transactionId ?? "",
    ...(bill.receiptNumber ? { receiptNumber: bill.receiptNumber } : {}),
    amount: bill.amount,
    netCents,
    currency: bill.currency,
    merchantId: bill.merchantId,
    merchantName: bill.merchantName,
    alreadyPaid,
  };
}

/**
 * Checks that read outside the posting transaction, as every payment flow
 * runs them: both accounts active, the pause after a PIN reset, and the
 * customer's per-payment, daily and monthly limits.
 */
export async function guardBillPayment(customerId: string, bill: Bill): Promise<void> {
  const db = admin.firestore();
  const [customerSnap, merchantSnap] = await Promise.all([
    db.collection("users").doc(customerId).get(),
    db.collection("users").doc(bill.merchantId).get(),
  ]);
  if (!customerSnap.exists) throw new https.HttpsError("not-found", "User not found");
  if (!merchantSnap.exists) throw new https.HttpsError("not-found", "Merchant not found");
  const customer = customerSnap.data() as User;
  assertAccountActive(customer);
  assertAccountActive(merchantSnap.data(), "counterparty");

  const { slsPerUsd } = await getRates();
  await assertResetCooldownAllows(
    customerId,
    "shop_payment",
    toLimitCents(bill.amount, bill.currency, slsPerUsd)
  );
  await enforceTransactionLimits(customerId, bill.amount, customer, undefined, bill.currency);
}

/**
 * Pay `billId` from `customerId`'s wallet. The caller has run the guards
 * (guardBillPayment, and the PIN for a customer's own Pay).
 *
 * `expectedAmount`: the customer pays what they were shown or nothing.
 * `mode: "autopay"` re-reads the auto-pay setting inside the transaction, so
 * turning it off a moment before the run still stops the payment.
 */
export async function settleBill(
  billId: string,
  customerId: string,
  mode: "customer" | "autopay",
  expectedAmount?: number
): Promise<SettledBill> {
  const db = admin.firestore();
  const { paymentFeeRate } = await getRates();
  const billRef = db.collection(BILLS).doc(billId);
  const entryId = billEntryId(billId);
  const transactionId = db.collection("transactions").doc().id;

  return db.runTransaction(async (tx) => {
    // Reads first: the receipt number, the bill, the auto-pay setting.
    const receiptNumber = await claimReceiptNumber(tx, db);
    const snap = await tx.get(billRef);
    if (!snap.exists) throw new https.HttpsError("not-found", "Bill not found");
    const bill = snap.data() as Bill;

    if (bill.customerId !== customerId) {
      throw new https.HttpsError("permission-denied", "This bill is not for you");
    }
    // A retry after the reply was lost: answer with the payment.
    if (bill.status === "paid") return settledFrom(billId, bill, true);
    if (bill.status !== "open") {
      throw new https.HttpsError("failed-precondition", `This bill is ${bill.status}`);
    }
    if (expectedAmount !== undefined && expectedAmount !== bill.amount) {
      throw new https.HttpsError(
        "failed-precondition",
        "The amount of this bill does not match what was shown"
      );
    }

    if (mode === "autopay") {
      const settingSnap = await tx.get(
        db.collection(BILL_AUTOPAY).doc(autopayId(customerId, bill.merchantId))
      );
      const setting = settingSnap.data() as BillAutopay | undefined;
      if (!setting?.active) throw new AutopayNotAllowed("off");
      if (setting.currency !== bill.currency) throw new AutopayNotAllowed("currency");
      if (bill.amount > setting.maxAmount) throw new AutopayNotAllowed("over_limit");
    }

    const feeCents = computePaymentFee(bill.amount, paymentFeeRate);
    const netCents = bill.amount - feeCents;
    const lines: JournalLine[] = [
      { account: userAccount(customerId), debit: bill.amount, credit: 0 },
      { account: userAccount(bill.merchantId), debit: 0, credit: netCents },
    ];
    if (feeCents > 0) lines.push({ account: PLATFORM_FEES, debit: 0, credit: feeCents });

    const description = `Bill: ${bill.description}`;
    const pending = await prepareJournalEntry(tx, {
      entryId,
      type: "bill_payment",
      currency: bill.currency,
      lines,
      refs: { transactionId, receiptNumber, billId },
      description,
      postedBy: mode === "autopay" ? "system" : customerId,
    });

    const now = admin.firestore.Timestamp.now();

    if (pending.alreadyPosted) {
      // The entry and the bill are written together, so this should not
      // happen. Settle the bill on the payment the entry names rather than
      // writing a second receipt.
      const entry = (await tx.get(db.collection("journal_entries").doc(entryId))).data();
      const paid: Partial<Bill> = {
        status: "paid",
        resolvedAt: now,
        journalEntryId: entryId,
        ...(entry?.refs?.transactionId ? { transactionId: entry.refs.transactionId } : {}),
        ...(entry?.refs?.receiptNumber ? { receiptNumber: entry.refs.receiptNumber } : {}),
      };
      tx.update(billRef, paid);
      return settledFrom(billId, { ...bill, ...paid } as Bill, true, netCents);
    }

    pending.write(tx);

    const row: Transaction = {
      type: "payment",
      kind: "merchant_payment",
      fromUserId: customerId,
      toUserId: bill.merchantId,
      participants: [customerId, bill.merchantId],
      amount: bill.amount,
      feeCents,
      netCents,
      currency: bill.currency,
      status: "completed",
      description,
      ...(bill.reference ? { reference: bill.reference } : {}),
      receiptNumber,
      journalEntryId: entryId,
      billId,
      ...(mode === "autopay" ? { autopay: true } : {}),
      createdAt: now,
      completedAt: now,
    };
    tx.set(db.collection("transactions").doc(transactionId), row);

    reserveReceiptNumber(tx, db, receiptNumber, {
      transactionId,
      type: "payment",
      participants: [customerId, bill.merchantId],
      amount: bill.amount,
      currency: bill.currency,
    });

    tx.update(billRef, {
      status: "paid",
      resolvedAt: now,
      paidBy: mode,
      transactionId,
      receiptNumber,
      journalEntryId: entryId,
    });

    return {
      billId,
      transactionId,
      receiptNumber,
      amount: bill.amount,
      netCents,
      currency: bill.currency,
      merchantId: bill.merchantId,
      merchantName: bill.merchantName,
      alreadyPaid: false,
    };
  });
}
