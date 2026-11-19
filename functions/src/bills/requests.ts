/**
 * Direct payment requests: the customer asks a shop to bill them on a
 * schedule ("$25 every month for my gym membership, member no. 4471"), and
 * the shop approves or declines.
 *
 * Asking moves no money. If the customer wants it paid automatically, the
 * request carries their PIN-given consent, and approving turns on auto-pay
 * for that shop up to the requested amount. Approving starts a repeating bill
 * (billSeries) and sends its first bill; from then on everything runs through
 * the ordinary bill flow (settle.ts, schedule.ts).
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
import { verifyUserPin } from "../auth/validatePin";
import { spendLookup } from "../users/lookupRecipient";
import { notifyUser } from "../utils/notifications";
import { Localized } from "../utils/pushTemplates";
import { ApiResponse, User } from "../types";
import {
  BILLS,
  BILL_AUTOPAY,
  BILL_LIMITS,
  BILL_REQUESTS,
  BILL_SERIES,
  Bill,
  BillAutopay,
  BillRequest,
  BillSeries,
  autopayId,
} from "./types";
import { addDays, daysBetween, dayForPush, hargeisaToday, nextDue, parseDay, startOfDayMs } from "./dates";
import { cleanDescription, maskPersonName, merchantDisplayName } from "./issue";

const PHONE_REGEX = /^\+[0-9]{8,15}$/;
const INTERVALS = ["weekly", "monthly"] as const;

const INTERVAL_WORDS: Record<(typeof INTERVALS)[number], Localized> = {
  weekly: { en: "every week", so: "toddobaad kasta", ar: "كل أسبوع" },
  monthly: { en: "every month", so: "bil kasta", ar: "كل شهر" },
};

const iso = (t?: FirebaseFirestore.Timestamp) => (t ? t.toDate().toISOString() : undefined);

export function requestView(id: string, r: BillRequest) {
  return {
    id,
    merchantId: r.merchantId,
    merchantName: r.merchantName,
    customerName: r.customerName,
    amount: r.amount,
    currency: r.currency,
    description: r.description,
    ...(r.reference ? { reference: r.reference } : {}),
    interval: r.interval,
    firstDueDate: r.firstDueDate,
    autopay: r.autopay,
    status: r.status,
    createdAt: iso(r.createdAt),
    ...(r.resolvedAt ? { resolvedAt: iso(r.resolvedAt) } : {}),
    ...(r.firstBillId ? { firstBillId: r.firstBillId } : {}),
  };
}

interface RequestInput {
  /** The shop's Zapp Pay number, or its account id (a shop that billed you before). */
  merchantPhone?: string;
  merchantId?: string;
  amount: number;
  currency?: string;
  description: string;
  /** The customer's number with the shop: member, meter or student number. */
  reference?: string;
  interval: "weekly" | "monthly";
  firstDueDate: string;
  /** Pay each one automatically on its due date. Needs the PIN. */
  autopay: boolean;
  pin?: string;
  idempotencyKey: string;
}

export const requestDirectPayment = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<RequestInput>): Promise<ApiResponse> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const data = request.data ?? ({} as RequestInput);
    const key = requireIdempotencyKey(data.idempotencyKey);
    const db = admin.firestore();
    const requestId = `${customerId}_${key}`;

    const existing = await db.collection(BILL_REQUESTS).doc(requestId).get();
    if (existing.exists) {
      return { success: true, data: { request: requestView(requestId, existing.data() as BillRequest) } };
    }

    const currency = parseCurrency(data.currency ?? "USD");
    if (!currency) throw new https.HttpsError("invalid-argument", "Currency must be USD or SLS");
    if (!validateAmount(data.amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive whole number in the currency's smallest unit"
      );
    }
    if (!INTERVALS.includes(data.interval as (typeof INTERVALS)[number])) {
      throw new https.HttpsError("invalid-argument", "How often must be weekly or monthly");
    }
    const description = cleanDescription(data.description);
    const reference = cleanReference(data.reference);
    const first = parseDay(data.firstDueDate);
    if (!first) throw new https.HttpsError("invalid-argument", "First payment date must be YYYY-MM-DD");
    const ahead = daysBetween(hargeisaToday(), data.firstDueDate);
    if (ahead < 0 || ahead > BILL_LIMITS.requestMaxDaysAhead) {
      throw new https.HttpsError(
        "invalid-argument",
        `The first payment must be between today and ${BILL_LIMITS.requestMaxDaysAhead} days from now`
      );
    }
    const autopay = data.autopay === true;

    // Auto-pay is consent to money leaving later without asking: it takes the PIN.
    if (autopay) {
      if (!data.pin) throw new https.HttpsError("invalid-argument", "PIN is required for auto-pay");
      if (!(await verifyUserPin(customerId, data.pin))) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }
    }

    const customerSnap = await db.collection("users").doc(customerId).get();
    if (!customerSnap.exists) throw new https.HttpsError("not-found", "User not found");
    const customer = customerSnap.data() as User;
    assertAccountActive(customer);

    await spendLookup(
      customerId,
      Date.now(),
      { perHour: BILL_LIMITS.requestPerHour, perDay: BILL_LIMITS.requestPerDay },
      "billreq_"
    );

    // Find the shop.
    let merchantId: string;
    let merchant: User;
    if (typeof data.merchantId === "string" && data.merchantId && !data.merchantId.includes("/")) {
      const snap = await db.collection("users").doc(data.merchantId).get();
      if (!snap.exists) throw new https.HttpsError("not-found", "Shop not found", { reason: "no_shop" });
      merchantId = snap.id;
      merchant = snap.data() as User;
    } else if (typeof data.merchantPhone === "string" && PHONE_REGEX.test(data.merchantPhone)) {
      const match = await db.collection("users").where("phoneNumber", "==", data.merchantPhone).limit(1).get();
      if (match.empty) throw new https.HttpsError("not-found", "Shop not found", { reason: "no_shop" });
      merchantId = match.docs[0].id;
      merchant = match.docs[0].data() as User;
    } else {
      throw new https.HttpsError("invalid-argument", "Say which shop: its phone number");
    }
    if (merchantId === customerId) {
      throw new https.HttpsError("invalid-argument", "You can't set up a payment to yourself");
    }
    if (!isMerchantRole(merchant.accountType) || !isAccountActive(merchant)) {
      throw new https.HttpsError("failed-precondition", "That number isn't a shop on Zapp Pay", {
        reason: "not_a_shop",
      });
    }

    // A payment over the customer's single-payment limit could never go through.
    await enforcePerTransactionLimit(data.amount, customer, currency);

    const pending = await db
      .collection(BILL_REQUESTS)
      .where("customerId", "==", customerId)
      .where("status", "==", "pending")
      .count()
      .get();
    if (pending.data().count >= BILL_LIMITS.pendingRequests) {
      throw new https.HttpsError(
        "resource-exhausted",
        "You have too many requests waiting for shops. Wait for an answer or cancel one."
      );
    }

    const req: BillRequest = {
      customerId,
      customerName: maskPersonName(customer.fullName),
      merchantId,
      merchantName: await merchantDisplayName(merchantId, merchant.fullName),
      amount: data.amount,
      currency,
      description,
      ...(reference ? { reference } : {}),
      interval: data.interval,
      firstDueDate: data.firstDueDate,
      autopay,
      status: "pending",
      createdAt: admin.firestore.Timestamp.now(),
    };

    const ref = db.collection(BILL_REQUESTS).doc(requestId);
    let replayed: BillRequest | undefined;
    await db.runTransaction(async (tx) => {
      const again = await tx.get(ref);
      if (again.exists) {
        replayed = again.data() as BillRequest;
        return;
      }
      tx.create(ref, req);
    });
    if (replayed) return { success: true, data: { request: requestView(requestId, replayed) } };

    notifyUser(
      merchantId,
      "bill",
      {
        key: "bill.request_received",
        params: {
          customer: req.customerName,
          amount: pushAmount(req.amount, req.currency),
          interval: INTERVAL_WORDS[req.interval],
          description: req.description,
        },
      },
      { type: "bill_request", requestId }
    ).catch((err) => console.error("Failed to tell the shop about a direct payment request:", err));

    return { success: true, data: { request: requestView(requestId, req) } };
  }
);

/** The customer takes back a request the shop hasn't answered. */
export const cancelDirectPaymentRequest = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ requestId: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const requestId = request.data?.requestId;
    if (typeof requestId !== "string" || !requestId || requestId.includes("/")) {
      throw new https.HttpsError("invalid-argument", "requestId is required");
    }
    const db = admin.firestore();
    const ref = db.collection(BILL_REQUESTS).doc(requestId);
    const result = await db.runTransaction(async (tx) => {
      const r = (await tx.get(ref)).data() as BillRequest | undefined;
      if (!r || r.customerId !== customerId) throw new https.HttpsError("not-found", "Request not found");
      if (r.status === "cancelled") return r;
      if (r.status !== "pending") {
        throw new https.HttpsError("failed-precondition", `The shop has already ${r.status} it`);
      }
      const resolvedAt = admin.firestore.Timestamp.now();
      tx.update(ref, { status: "cancelled", resolvedAt });
      return { ...r, status: "cancelled" as const, resolvedAt };
    });
    return { success: true, data: { request: requestView(requestId, result) } };
  }
);

/**
 * The shop answers a request. Approving starts the repeating bill, sends its
 * first bill (due on the requested date, or today if that has passed), and
 * turns on auto-pay if the customer asked for it.
 */
export const answerDirectPaymentRequest = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ requestId: string; approve: boolean }>): Promise<ApiResponse> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;
    const requestId = request.data?.requestId;
    const approve = request.data?.approve;
    if (typeof requestId !== "string" || !requestId || requestId.includes("/")) {
      throw new https.HttpsError("invalid-argument", "requestId is required");
    }
    if (typeof approve !== "boolean") throw new https.HttpsError("invalid-argument", "approve must be true or false");

    const db = admin.firestore();
    const merchantSnap = await db.collection("users").doc(merchantId).get();
    const merchant = merchantSnap.data() as User | undefined;
    if (!merchant || !isMerchantRole(merchant.accountType)) {
      throw new https.HttpsError("permission-denied", "Only shops can answer direct payment requests");
    }
    assertAccountActive(merchant);

    const ref = db.collection(BILL_REQUESTS).doc(requestId);
    const now = admin.firestore.Timestamp.now();
    const today = hargeisaToday();

    let answered: BillRequest | undefined;
    let firstBill: Bill | undefined;
    const result = await db.runTransaction(async (tx) => {
      answered = undefined;
      firstBill = undefined;
      const r = (await tx.get(ref)).data() as BillRequest | undefined;
      if (!r || r.merchantId !== merchantId) throw new https.HttpsError("not-found", "Request not found");
      if (r.status === (approve ? "approved" : "declined")) return r; // a retry
      if (r.status !== "pending") {
        throw new https.HttpsError("failed-precondition", `This request is ${r.status}`);
      }

      if (!approve) {
        const declined: BillRequest = { ...r, status: "declined", resolvedAt: now };
        tx.update(ref, { status: "declined", resolvedAt: now });
        answered = declined;
        return declined;
      }

      const seriesId = `s_req_${requestId}`;
      const dueDate = r.firstDueDate < today ? today : r.firstDueDate;
      const billId = `${seriesId}_${dueDate}`;
      const anchorDay = parseDay(dueDate)!.d;
      const following = nextDue(dueDate, r.interval, anchorDay);
      const settingRef = db.collection(BILL_AUTOPAY).doc(autopayId(r.customerId, merchantId));
      const setting = r.autopay ? ((await tx.get(settingRef)).data() as BillAutopay | undefined) : undefined;

      const series: BillSeries = {
        merchantId,
        merchantName: r.merchantName,
        customerId: r.customerId,
        customerName: r.customerName,
        amount: r.amount,
        currency: r.currency,
        description: r.description,
        ...(r.reference ? { reference: r.reference } : {}),
        interval: r.interval,
        anchorDay,
        nextDueDate: following,
        nextIssueAt: admin.firestore.Timestamp.fromMillis(
          startOfDayMs(addDays(following, -BILL_LIMITS.issueDaysBefore))
        ),
        active: true,
        createdAt: now,
      };
      firstBill = {
        merchantId,
        merchantName: r.merchantName,
        customerId: r.customerId,
        customerName: r.customerName,
        amount: r.amount,
        currency: r.currency,
        description: r.description,
        ...(r.reference ? { reference: r.reference } : {}),
        dueDate,
        dueAt: admin.firestore.Timestamp.fromMillis(startOfDayMs(dueDate)),
        status: "open",
        seriesId,
        createdAt: now,
      };

      tx.create(db.collection(BILL_SERIES).doc(seriesId), series);
      tx.create(db.collection(BILLS).doc(billId), firstBill);

      // The customer's consent covers this shop up to this amount. A higher
      // limit they already set stays; one in the other currency is replaced,
      // since a shop's auto-pay holds one currency.
      if (r.autopay) {
        const keepHigher = setting?.active && setting.currency === r.currency && setting.maxAmount > r.amount;
        if (!keepHigher) {
          const next: BillAutopay = {
            customerId: r.customerId,
            merchantId,
            merchantName: r.merchantName,
            maxAmount: r.amount,
            currency: r.currency,
            active: true,
            createdAt: setting?.createdAt ?? now,
            updatedAt: now,
          };
          tx.set(settingRef, next);
        }
      }

      const approved: BillRequest = { ...r, status: "approved", resolvedAt: now, seriesId, firstBillId: billId };
      tx.update(ref, { status: "approved", resolvedAt: now, seriesId, firstBillId: billId });
      answered = approved;
      return approved;
    });

    if (answered?.status === "approved" && firstBill) {
      notifyUser(
        answered.customerId,
        "bill",
        {
          key: "bill.request_approved",
          params: {
            merchant: answered.merchantName,
            amount: pushAmount(answered.amount, answered.currency),
            due: dayForPush(firstBill.dueDate),
          },
        },
        { type: "bill", billId: answered.firstBillId! }
      ).catch((err) => console.error("Failed to tell the customer their request was approved:", err));
    } else if (answered?.status === "declined") {
      notifyUser(
        answered.customerId,
        "bill",
        {
          key: "bill.request_declined",
          params: { merchant: answered.merchantName, description: answered.description },
        },
        { type: "bill_request", requestId }
      ).catch((err) => console.error("Failed to tell the customer their request was declined:", err));
    }

    return { success: true, data: { request: requestView(requestId, result) } };
  }
);

/** Requests a shop hasn't answered yet, newest first. */
export async function pendingRequestsFor(field: "merchantId" | "customerId", uid: string) {
  const snap = await admin
    .firestore()
    .collection(BILL_REQUESTS)
    .where(field, "==", uid)
    .where("status", "==", "pending")
    .limit(50)
    .get();
  return snap.docs
    .map((d) => requestView(d.id, d.data() as BillRequest))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
