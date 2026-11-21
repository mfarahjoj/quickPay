/**
 * Manager refunds (STAFF_ACCESS.md).
 *
 * A manager refunds the shop's counter payments through `refundPayment` with
 * the shop's uid as `merchantId` and their own PIN. The owner turns this on per
 * manager by setting two caps on the grant (US cents; shillings count at
 * `slsPerUsd`): the most one refund may give back, and the most that manager's
 * refunds may give back in a Hargeisa day. The day's running total lives in
 * `staffRefundDays/{grantId}_{day}`, read and written in the refund's own
 * transaction, so two refunds at once can't both slip under the cap.
 *
 * `staffListPayments` is how a manager finds the payment: the shop's recent
 * counter payments, with customer names only if the owner ticked "Show customers".
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { https } from "firebase-functions/v2";
import { getRates } from "../config/rates";
import { localParts } from "../merchantStats/time";
import { partyNames } from "../portal/data";
import { Transaction } from "../types";
import { requireMerchantActor, staffDenied } from "./access";
import { grantId, refundsEnabled, STAFF_REFUND_DAYS, StaffGrant, StaffRefundDay } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A refund's size in US cents for the caps: shillings at `slsPerUsd`, rounded up. */
export function capCents(gross: number, currency: string, slsPerUsd: number): number {
  if (currency !== "SLS") return gross;
  if (!(slsPerUsd > 0)) throw new https.HttpsError("internal", "Shilling rate is not set");
  return Math.ceil((gross * 100) / slsPerUsd);
}

export function refundDayRef(merchantUid: string, staffUid: string, nowMs: number) {
  const day = localParts(nowMs).day;
  return {
    day,
    ref: admin.firestore().collection(STAFF_REFUND_DAYS).doc(`${grantId(merchantUid, staffUid)}_${day}`),
  };
}

/**
 * Throws unless a refund of `cents` (US cents) fits this grant's caps, given
 * what the manager has already refunded today.
 */
export function assertWithinCaps(grant: StaffGrant, cents: number, usedToday: number): void {
  if (!refundsEnabled(grant)) {
    throw staffDenied("The shop hasn't turned on refunds for you.");
  }
  const each = grant.refundCapCents!;
  const day = grant.refundDayCapCents!;
  if (cents > each) {
    throw new https.HttpsError("permission-denied", "This refund is over your limit. Ask the shop's owner.", {
      reason: "staff_refund_over_cap",
      capCents: each,
    });
  }
  if (usedToday + cents > day) {
    throw new https.HttpsError("permission-denied", "This would take you over today's refund limit. Ask the shop's owner.", {
      reason: "staff_refund_day_cap",
      dayCapCents: day,
      usedCents: usedToday,
    });
  }
}

/** Stages the day's new total. Call after assertWithinCaps, in the same transaction. */
export function stageRefundDay(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  prev: StaffRefundDay | undefined,
  fields: { merchantUid: string; staffUid: string; day: string; cents: number }
): void {
  const next: StaffRefundDay = {
    merchantUid: fields.merchantUid,
    staffUid: fields.staffUid,
    day: fields.day,
    usedCents: (prev?.usedCents ?? 0) + fields.cents,
    count: (prev?.count ?? 0) + 1,
    updatedAt: Timestamp.now(),
  };
  tx.set(ref, next);
}

const LIST_LIMIT = 50;

/**
 * A manager's view of the shop's recent counter payments, to refund from.
 * Newest first, only those still inside the refund window, without names
 * unless the grant has "Show customers".
 */
export const staffListPayments = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ merchantId?: unknown }>) => {
    const actor = await requireMerchantActor(request, request.data?.merchantId, "refund");
    if (actor.role === "owner" || !actor.grant) {
      // The shop has its own Transactions screen; this list is for staff.
      throw staffDenied();
    }
    const grant = actor.grant;
    const shop = actor.merchantUid;
    const db = admin.firestore();
    const { refundWindowDays, slsPerUsd } = await getRates();
    const now = Date.now();
    const since = now - refundWindowDays * DAY_MS;

    const { ref: dayRef } = refundDayRef(shop, actor.actorUid, now);
    const [snap, daySnap] = await Promise.all([
      db
        .collection("transactions")
        .where("toUserId", "==", shop)
        .where("status", "==", "completed")
        .orderBy("createdAt", "desc")
        .limit(LIST_LIMIT * 2)
        .get(),
      dayRef.get(),
    ]);

    const rows = snap.docs
      .map((d) => ({ id: d.id, t: d.data() as Transaction }))
      .filter(({ t }) => {
        const paidAt = (t.completedAt ?? t.createdAt)?.toMillis?.() ?? 0;
        // Online (API) payments are refunded by the system that took them.
        return t.type === "payment" && !t.apiChargeId && paidAt >= since;
      })
      .slice(0, LIST_LIMIT);

    const names = grant.showCustomers
      ? await partyNames(db, rows.map(({ t }) => t.fromUserId))
      : new Map<string, string | null>();

    const payments = rows.map(({ id, t }) => {
      const refunded = t.refundedCents ?? 0;
      return {
        id,
        currency: t.currency === "SLS" ? "SLS" : "USD",
        /** In the currency's smallest unit: cents, or whole shillings. */
        amount: t.amount,
        refunded,
        remaining: Math.max(t.amount - refunded, 0),
        customerName: grant.showCustomers ? names.get(t.fromUserId) ?? null : null,
        reference: t.reference ?? null,
        receiptNumber: t.receiptNumber ?? null,
        raisedBy: t.raisedBy ?? null,
        createdAtMs: t.createdAt.toMillis(),
      };
    });

    const used = (daySnap.data() as StaffRefundDay | undefined)?.usedCents ?? 0;
    return {
      success: true,
      data: {
        payments,
        refunds: {
          enabled: refundsEnabled(grant),
          capCents: grant.refundCapCents ?? 0,
          dayCapCents: grant.refundDayCapCents ?? 0,
          usedTodayCents: used,
          slsPerUsd,
          refundWindowDays,
        },
      },
    };
  }
);
