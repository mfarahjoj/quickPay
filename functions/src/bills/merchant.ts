/**
 * The shop's side of bills: send one (once, or repeating weekly or monthly),
 * withdraw one, list them, and stop a repeating bill.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validateAmount } from "../utils/validation";
import { assertAccountActive, isAccountActive } from "../utils/accountStatus";
import { isMerchantRole } from "../utils/roles";
import { enforcePerTransactionLimit } from "../utils/limits";
import { parseCurrency, pushAmount } from "../utils/money";
import { cleanReference } from "../utils/paidReferences";
import { requireIdempotencyKey } from "../utils/idempotency";
import { spendLookup } from "../users/lookupRecipient";
import { notifyUser } from "../utils/notifications";
import { ApiResponse, User } from "../types";
import {
  BILLS,
  BILL_LIMITS,
  BILL_SERIES,
  Bill,
  BillRepeat,
  BillSeries,
} from "./types";
import { pendingRequestsFor } from "./requests";
import { addDays, daysBetween, hargeisaToday, nextDue, parseDay, startOfDayMs } from "./dates";
import {
  billView,
  cleanDescription,
  maskPersonName,
  merchantDisplayName,
  notifyBillIssued,
  seriesView,
} from "./issue";

const PHONE_REGEX = /^\+[0-9]{8,15}$/;
const REPEATS: readonly BillRepeat[] = ["none", "weekly", "monthly"];

/** The caller, if they are an active shop. */
async function requireMerchant(uid: string): Promise<User> {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists) throw new https.HttpsError("not-found", "Merchant not found");
  const user = snap.data() as User;
  if (!isMerchantRole(user.accountType)) {
    throw new https.HttpsError("permission-denied", "Only shops can send bills");
  }
  assertAccountActive(user);
  return user;
}


interface CreateBillInput {
  customerPhone: string;
  /** In the currency's smallest unit: cents, or whole shillings. */
  amount: number;
  currency?: string;
  description: string;
  /** The customer's number with the shop: meter, member or student number. */
  reference?: string;
  /** "YYYY-MM-DD", today or later. */
  dueDate: string;
  repeat?: BillRepeat;
  /** Minted once per bill by the app and resent on retry. */
  idempotencyKey: string;
}

export const createBill = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<CreateBillInput>): Promise<ApiResponse> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;
    const data = request.data ?? ({} as CreateBillInput);
    const key = requireIdempotencyKey(data.idempotencyKey);
    const db = admin.firestore();
    const billId = `${merchantId}_${key}`;

    // A retry of a bill already sent gets that bill back, before any budget is spent.
    const existing = await db.collection(BILLS).doc(billId).get();
    if (existing.exists) {
      return { success: true, data: { bill: billView(billId, existing.data() as Bill) } };
    }

    const currency = parseCurrency(data.currency ?? "USD");
    if (!currency) throw new https.HttpsError("invalid-argument", "Currency must be USD or SLS");
    if (!validateAmount(data.amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive whole number in the currency's smallest unit"
      );
    }
    if (typeof data.customerPhone !== "string" || !PHONE_REGEX.test(data.customerPhone)) {
      throw new https.HttpsError("invalid-argument", "A phone number like +252631234567 is required");
    }
    const description = cleanDescription(data.description);
    const reference = cleanReference(data.reference);
    const repeat = data.repeat ?? "none";
    if (!REPEATS.includes(repeat)) {
      throw new https.HttpsError("invalid-argument", "Repeat must be none, weekly or monthly");
    }
    const due = parseDay(data.dueDate);
    const today = hargeisaToday();
    if (!due) throw new https.HttpsError("invalid-argument", "Due date must be YYYY-MM-DD");
    const ahead = daysBetween(today, data.dueDate);
    if (ahead < 0 || ahead > BILL_LIMITS.maxDaysAhead) {
      throw new https.HttpsError(
        "invalid-argument",
        `The due date must be between today and ${BILL_LIMITS.maxDaysAhead} days from now`
      );
    }

    const merchant = await requireMerchant(merchantId);

    // Every bill resolves a phone number, so it counts like a number lookup.
    await spendLookup(
      merchantId,
      Date.now(),
      { perHour: BILL_LIMITS.sendPerHour, perDay: BILL_LIMITS.sendPerDay },
      "bill_"
    );

    const match = await db
      .collection("users")
      .where("phoneNumber", "==", data.customerPhone)
      .limit(1)
      .get();
    if (match.empty || !isAccountActive(match.docs[0].data())) {
      throw new https.HttpsError("not-found", "No Zapp Pay account uses this number", {
        reason: "no_account",
      });
    }
    const customerId = match.docs[0].id;
    const customer = match.docs[0].data() as User;
    if (customerId === merchantId) {
      throw new https.HttpsError("invalid-argument", "You can't bill yourself");
    }

    // A bill over the customer's single-payment limit could never be paid.
    await enforcePerTransactionLimit(data.amount, customer, currency);

    const open = await db
      .collection(BILLS)
      .where("merchantId", "==", merchantId)
      .where("customerId", "==", customerId)
      .where("status", "==", "open")
      .count()
      .get();
    if (open.data().count >= BILL_LIMITS.openPerCustomer) {
      throw new https.HttpsError(
        "resource-exhausted",
        "This customer already has too many unpaid bills from you"
      );
    }

    const merchantName = await merchantDisplayName(merchantId, merchant.fullName);
    const customerName = maskPersonName(customer.fullName);
    const now = admin.firestore.Timestamp.now();
    const seriesId = repeat === "none" ? undefined : `s_${billId}`;

    const bill: Bill = {
      merchantId,
      merchantName,
      customerId,
      customerName,
      amount: data.amount,
      currency,
      description,
      ...(reference ? { reference } : {}),
      dueDate: data.dueDate,
      dueAt: admin.firestore.Timestamp.fromMillis(startOfDayMs(data.dueDate)),
      status: "open",
      ...(seriesId ? { seriesId } : {}),
      createdAt: now,
    };

    let series: BillSeries | undefined;
    if (seriesId && repeat !== "none") {
      const nextDueDate = nextDue(data.dueDate, repeat, due.d);
      series = {
        merchantId,
        merchantName,
        customerId,
        customerName,
        amount: data.amount,
        currency,
        description,
        ...(reference ? { reference } : {}),
        interval: repeat,
        anchorDay: due.d,
        nextDueDate,
        nextIssueAt: admin.firestore.Timestamp.fromMillis(
          startOfDayMs(addDays(nextDueDate, -BILL_LIMITS.issueDaysBefore))
        ),
        active: true,
        createdAt: now,
      };
    }

    let replayed: Bill | undefined;
    await db.runTransaction(async (tx) => {
      const ref = db.collection(BILLS).doc(billId);
      const again = await tx.get(ref);
      if (again.exists) {
        replayed = again.data() as Bill;
        return;
      }
      tx.create(ref, bill);
      if (series && seriesId) tx.create(db.collection(BILL_SERIES).doc(seriesId), series);
    });
    if (replayed) return { success: true, data: { bill: billView(billId, replayed) } };

    await notifyBillIssued(billId, bill);

    return {
      success: true,
      data: {
        bill: billView(billId, bill),
        ...(series && seriesId ? { series: seriesView(seriesId, series) } : {}),
      },
    };
  }
);

export const cancelBill = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ billId: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;
    const billId = request.data?.billId;
    if (typeof billId !== "string" || !billId) {
      throw new https.HttpsError("invalid-argument", "billId is required");
    }
    const db = admin.firestore();
    const ref = db.collection(BILLS).doc(billId);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const bill = snap.data() as Bill | undefined;
      if (!bill || bill.merchantId !== merchantId) {
        throw new https.HttpsError("not-found", "Bill not found");
      }
      if (bill.status === "cancelled") return bill;
      if (bill.status !== "open") {
        throw new https.HttpsError("failed-precondition", `This bill is ${bill.status}`);
      }
      const resolvedAt = admin.firestore.Timestamp.now();
      tx.update(ref, { status: "cancelled", resolvedAt });
      return { ...bill, status: "cancelled" as const, resolvedAt };
    });
    return { success: true, data: { bill: billView(billId, result) } };
  }
);

export const merchantListBills = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<unknown>): Promise<ApiResponse> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;
    await requireMerchant(merchantId);
    const db = admin.firestore();
    const [bills, series] = await Promise.all([
      db
        .collection(BILLS)
        .where("merchantId", "==", merchantId)
        .orderBy("createdAt", "desc")
        .limit(100)
        .get(),
      db
        .collection(BILL_SERIES)
        .where("merchantId", "==", merchantId)
        .where("active", "==", true)
        .limit(100)
        .get(),
    ]);
    return {
      success: true,
      data: {
        bills: bills.docs.map((d) => billView(d.id, d.data() as Bill)),
        series: series.docs.map((d) => seriesView(d.id, d.data() as BillSeries)),
        requests: await pendingRequestsFor("merchantId", merchantId),
      },
    };
  }
);

/**
 * Stop a repeating bill. Either side may: the shop ending a membership, or
 * the customer who no longer wants to be billed. Bills already sent stay as
 * they are; the shop can cancel them, the customer decline them.
 */
export const stopBillSeries = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ seriesId: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const seriesId = request.data?.seriesId;
    if (typeof seriesId !== "string" || !seriesId) {
      throw new https.HttpsError("invalid-argument", "seriesId is required");
    }
    const db = admin.firestore();
    const ref = db.collection(BILL_SERIES).doc(seriesId);
    let stoppedBy: "merchant" | "customer" | undefined;
    let series: BillSeries | undefined;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      series = snap.data() as BillSeries | undefined;
      if (!series || (series.merchantId !== uid && series.customerId !== uid)) {
        throw new https.HttpsError("not-found", "Repeating bill not found");
      }
      if (!series.active) return;
      stoppedBy = series.merchantId === uid ? "merchant" : "customer";
      tx.update(ref, { active: false, stoppedAt: admin.firestore.Timestamp.now(), stoppedBy });
    });

    if (stoppedBy === "customer" && series) {
      const customer = (await db.collection("users").doc(series.customerId).get()).data();
      notifyUser(
        series.merchantId,
        "bill",
        {
          key: "bill.series_stopped",
          params: { customer: maskPersonName(customer?.fullName), description: series.description },
        },
        { type: "bill_series", seriesId }
      ).catch((err) => console.error("Failed to notify shop:", err));
    }
    return { success: true, data: { seriesId, active: false } };
  }
);

/** For pushes: an amount as pushes write it. */
export const billPushAmount = (bill: Pick<Bill, "amount" | "currency">) =>
  pushAmount(bill.amount, bill.currency);

export { cleanDescription };
