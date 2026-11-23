/**
 * The customer's side of bills: list them, pay one with the PIN, decline one,
 * and turn auto-pay on or off for a shop.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validateAmount } from "../utils/validation";
import { requireActiveAccount } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import { isMerchantRole } from "../utils/roles";
import { parseCurrency, pushAmount } from "../utils/money";
import { notifyPaymentSent, notifyUser } from "../utils/notifications";
import { WalletNotFoundError } from "../ledger";
import { ApiResponse } from "../types";
import {
  BILLS,
  BILL_AUTOPAY,
  BILL_SERIES,
  Bill,
  BillAutopay,
  BillSeries,
  autopayId,
} from "./types";
import { pendingRequestsFor } from "./requests";
import { guardBillPayment, settleBill, SettledBill } from "./settle";
import {
  autopayView,
  billView,
  maskPersonName,
  merchantDisplayName,
  seriesView,
} from "./issue";

function requireId(value: unknown, name: string): string {
  if (typeof value !== "string" || !value || value.includes("/")) {
    throw new https.HttpsError("invalid-argument", `${name} is required`);
  }
  return value;
}

export const listMyBills = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<unknown>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const db = admin.firestore();
    const [bills, series, autopay] = await Promise.all([
      db.collection(BILLS).where("customerId", "==", uid).orderBy("createdAt", "desc").limit(50).get(),
      db.collection(BILL_SERIES).where("customerId", "==", uid).where("active", "==", true).limit(50).get(),
      db.collection(BILL_AUTOPAY).where("customerId", "==", uid).where("active", "==", true).limit(50).get(),
    ]);
    return {
      success: true,
      data: {
        bills: bills.docs.map((d) => billView(d.id, d.data() as Bill)),
        series: series.docs.map((d) => seriesView(d.id, d.data() as BillSeries)),
        autopay: autopay.docs.map((d) => autopayView(d.data() as BillAutopay)),
        requests: await pendingRequestsFor("customerId", uid),
      },
    };
  }
);

/** Tell the shop it was paid. Never throws: the money has moved. */
export function notifyBillPaid(settled: SettledBill, customerId: string, description: string): void {
  admin
    .firestore()
    .collection("users")
    .doc(customerId)
    .get()
    .then((snap) =>
      notifyUser(
        settled.merchantId,
        "bill",
        {
          key: "bill.paid",
          params: {
            customer: maskPersonName(snap.data()?.fullName),
            amount: pushAmount(settled.netCents, settled.currency),
            description,
          },
        },
        { type: "bill_paid", billId: settled.billId, transactionId: settled.transactionId }
      )
    )
    .catch((err) => console.error("Failed to notify shop of bill payment:", err));
}

interface PayBillInput {
  billId: string;
  pin: string;
  /** The amount the customer was shown: they pay that or nothing. */
  expectedAmount?: number;
}

export const payBill = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<PayBillInput>): Promise<ApiResponse> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const billId = requireId(request.data?.billId, "billId");
    const { pin, expectedAmount } = request.data;
    if (!pin) throw new https.HttpsError("invalid-argument", "PIN is required");
    if (expectedAmount !== undefined && !Number.isInteger(expectedAmount)) {
      throw new https.HttpsError("invalid-argument", "expectedAmount must be a whole number");
    }

    if (!(await verifyUserPin(customerId, pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    const db = admin.firestore();
    const snap = await db.collection(BILLS).doc(billId).get();
    const bill = snap.data() as Bill | undefined;
    if (!bill || bill.customerId !== customerId) {
      throw new https.HttpsError("not-found", "Bill not found");
    }

    const answer = (s: SettledBill) => ({
      success: true,
      data: {
        billId,
        transactionId: s.transactionId,
        ...(s.receiptNumber ? { receiptNumber: s.receiptNumber } : {}),
        amount: s.amount,
        currency: s.currency,
      },
    });

    // A retry after the reply was lost is answered before velocity and
    // limits, which already count this payment and would refuse its retry.
    if (bill.status === "paid") {
      return answer({
        billId,
        transactionId: bill.transactionId ?? "",
        receiptNumber: bill.receiptNumber,
        amount: bill.amount,
        netCents: 0,
        currency: bill.currency,
        merchantId: bill.merchantId,
        merchantName: bill.merchantName,
        alreadyPaid: true,
      });
    }
    if (bill.status !== "open") {
      throw new https.HttpsError("failed-precondition", `This bill is ${bill.status}`);
    }

    await guardBillPayment(customerId, bill);
    await enforceVelocity(customerId);

    let settled: SettledBill;
    try {
      settled = await settleBill(billId, customerId, "customer", expectedAmount);
    } catch (error: any) {
      if (error?.message === "Insufficient balance") {
        throw new https.HttpsError("failed-precondition", "Insufficient balance");
      }
      if (error instanceof WalletNotFoundError) {
        throw new https.HttpsError("failed-precondition", "Wallet not found");
      }
      throw error;
    }

    if (!settled.alreadyPaid) {
      notifyBillPaid(settled, customerId, bill.description);
      notifyPaymentSent(customerId, settled.amount, settled.currency, settled.merchantId).catch((err) =>
        console.error("Failed to notify customer:", err)
      );
    }
    return answer(settled);
  }
);

export const declineBill = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ billId: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const billId = requireId(request.data?.billId, "billId");
    const db = admin.firestore();
    const ref = db.collection(BILLS).doc(billId);
    let declined: Bill | undefined;
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const bill = snap.data() as Bill | undefined;
      if (!bill || bill.customerId !== customerId) {
        throw new https.HttpsError("not-found", "Bill not found");
      }
      if (bill.status === "declined") return bill;
      if (bill.status !== "open") {
        throw new https.HttpsError("failed-precondition", `This bill is ${bill.status}`);
      }
      const resolvedAt = admin.firestore.Timestamp.now();
      tx.update(ref, { status: "declined", resolvedAt });
      declined = { ...bill, status: "declined", resolvedAt };
      return declined;
    });

    if (declined) {
      const customer = await db.collection("users").doc(customerId).get();
      notifyUser(
        declined.merchantId,
        "bill",
        {
          key: "bill.declined",
          params: {
            customer: maskPersonName(customer.data()?.fullName),
            amount: pushAmount(declined.amount, declined.currency),
          },
        },
        { type: "bill_declined", billId }
      ).catch((err) => console.error("Failed to notify shop:", err));
    }
    return { success: true, data: { bill: billView(billId, result) } };
  }
);

interface SetAutopayInput {
  merchantId: string;
  /** Bills up to this much are paid on their due date without asking. */
  maxAmount: number;
  currency?: string;
  pin: string;
}

/**
 * Turn on (or change) auto-pay for one shop. It needs the PIN: from now on
 * that shop's bills up to `maxAmount` leave the wallet without another one.
 * Only a shop that has billed this customer can be chosen.
 */
export const setBillAutopay = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<SetAutopayInput>): Promise<ApiResponse> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const merchantId = requireId(request.data?.merchantId, "merchantId");
    const { maxAmount, pin } = request.data;
    const currency = parseCurrency(request.data.currency ?? "USD");
    if (!currency) throw new https.HttpsError("invalid-argument", "Currency must be USD or SLS");
    if (!validateAmount(maxAmount)) {
      throw new https.HttpsError("invalid-argument", "The limit must be a positive whole number");
    }
    if (!pin) throw new https.HttpsError("invalid-argument", "PIN is required");
    if (!(await verifyUserPin(customerId, pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }
    await requireActiveAccount(customerId);

    const db = admin.firestore();
    const merchant = await requireActiveAccount(merchantId, "counterparty");
    if (!isMerchantRole(merchant.accountType)) {
      throw new https.HttpsError("failed-precondition", "Auto-pay is only for shops that bill you");
    }
    const billed = await db
      .collection(BILLS)
      .where("customerId", "==", customerId)
      .where("merchantId", "==", merchantId)
      .limit(1)
      .get();
    if (billed.empty) {
      throw new https.HttpsError("failed-precondition", "Auto-pay is only for shops that bill you");
    }

    const ref = db.collection(BILL_AUTOPAY).doc(autopayId(customerId, merchantId));
    const now = admin.firestore.Timestamp.now();
    const before = (await ref.get()).data() as BillAutopay | undefined;
    const setting: BillAutopay = {
      customerId,
      merchantId,
      merchantName: await merchantDisplayName(merchantId, merchant.fullName),
      maxAmount,
      currency,
      active: true,
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    };
    await ref.set(setting);
    return { success: true, data: { autopay: autopayView(setting) } };
  }
);

/** Turning auto-pay off takes no PIN: it only stops money leaving. */
export const disableBillAutopay = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ merchantId: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const merchantId = requireId(request.data?.merchantId, "merchantId");
    const ref = admin.firestore().collection(BILL_AUTOPAY).doc(autopayId(customerId, merchantId));
    const snap = await ref.get();
    if (snap.exists && snap.data()?.active) {
      await ref.update({ active: false, updatedAt: admin.firestore.Timestamp.now() });
    }
    return { success: true, data: { merchantId, active: false } };
  }
);
