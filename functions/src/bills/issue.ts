/**
 * Sending a bill (by hand from the merchant app, or from a repeating bill)
 * and the views both apps list. No money moves here.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import { maskPersonName } from "../users/lookupRecipient";
import {
  BILLS,
  BILL_AUTOPAY,
  BILL_LIMITS,
  Bill,
  BillAutopay,
  BillSeries,
  autopayId,
} from "./types";
import { dayForPush } from "./dates";

type Ts = FirebaseFirestore.Timestamp | undefined;
const iso = (t: Ts) => (t && typeof t.toDate === "function" ? t.toDate().toISOString() : undefined);

/** The name a shop goes by: its business name, else the owner's name. */
export async function merchantDisplayName(merchantId: string, fullName?: unknown): Promise<string> {
  const profile = await admin.firestore().collection("merchantProfiles").doc(merchantId).get();
  const businessName = profile.data()?.businessName;
  if (typeof businessName === "string" && businessName.trim()) return businessName.trim();
  return typeof fullName === "string" && fullName.trim() ? fullName.trim() : "Zapp Pay merchant";
}

export { maskPersonName };

/**
 * Tell the customer a bill arrived, and whether auto-pay will pay it. Never
 * throws: the bill is already saved and listed.
 */
export async function notifyBillIssued(billId: string, bill: Bill): Promise<void> {
  try {
    const setting = (
      await admin
        .firestore()
        .collection(BILL_AUTOPAY)
        .doc(autopayId(bill.customerId, bill.merchantId))
        .get()
    ).data() as BillAutopay | undefined;
    const params = {
      merchant: bill.merchantName,
      amount: pushAmount(bill.amount, bill.currency),
      description: bill.description,
      due: dayForPush(bill.dueDate),
    };
    const data = { type: "bill", billId };
    if (setting?.active && setting.currency === bill.currency && bill.amount <= setting.maxAmount) {
      await notifyUser(bill.customerId, "bill", { key: "bill.received_autopay", params }, data);
    } else if (setting?.active) {
      const { merchant, amount, due } = params;
      await notifyUser(bill.customerId, "bill", { key: "bill.over_autopay_limit", params: { merchant, amount, due } }, data);
    } else {
      await notifyUser(bill.customerId, "bill", { key: "bill.received", params }, data);
    }
  } catch (err) {
    console.error(`Couldn't tell the customer about bill ${billId}:`, err);
  }
}

/** A bill as both apps read it. */
export function billView(id: string, bill: Bill) {
  return {
    id,
    merchantId: bill.merchantId,
    merchantName: bill.merchantName,
    customerName: bill.customerName,
    amount: bill.amount,
    currency: bill.currency,
    description: bill.description,
    ...(bill.reference ? { reference: bill.reference } : {}),
    dueDate: bill.dueDate,
    status: bill.status,
    ...(bill.seriesId ? { seriesId: bill.seriesId } : {}),
    createdAt: iso(bill.createdAt),
    ...(bill.resolvedAt ? { resolvedAt: iso(bill.resolvedAt) } : {}),
    ...(bill.paidBy ? { paidBy: bill.paidBy } : {}),
    ...(bill.transactionId ? { transactionId: bill.transactionId } : {}),
    ...(bill.receiptNumber ? { receiptNumber: bill.receiptNumber } : {}),
    ...(bill.autopayTries ? { autopayTries: bill.autopayTries } : {}),
  };
}

export function seriesView(id: string, s: BillSeries) {
  return {
    id,
    merchantId: s.merchantId,
    merchantName: s.merchantName,
    customerName: s.customerName,
    amount: s.amount,
    currency: s.currency,
    description: s.description,
    ...(s.reference ? { reference: s.reference } : {}),
    interval: s.interval,
    nextDueDate: s.nextDueDate,
    active: s.active,
  };
}

export function autopayView(a: BillAutopay) {
  return {
    merchantId: a.merchantId,
    merchantName: a.merchantName,
    maxAmount: a.maxAmount,
    currency: a.currency,
  };
}

export function billsCollection() {
  return admin.firestore().collection(BILLS);
}

export function cleanDescription(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) throw new https.HttpsError("invalid-argument", "Say what the bill is for");
  if (text.length > BILL_LIMITS.descriptionMax) {
    throw new https.HttpsError(
      "invalid-argument",
      `Keep the description to ${BILL_LIMITS.descriptionMax} characters`
    );
  }
  return text;
}
