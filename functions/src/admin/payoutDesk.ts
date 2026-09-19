/**
 * Payout desk — settling merchant takings.
 *
 * The merchant's wallet was already debited into `platform:settlement_hold`
 * when they asked (`payouts/requestPayout.ts`). What happens here is the other
 * half: ops sends the money on whatever rail the merchant uses, then records
 * it, and the value leaves the matching float account.
 *
 * The order matters and is deliberately the unforgiving way round: an admin
 * marks a payout paid *after* sending it, quoting the bank or Zaad reference.
 * Recording it first would leave the books claiming money had gone out while
 * it still sat in the account, which is exactly the drift the reconciliation
 * work exists to catch.
 *
 * Journal:
 *   settle — debit platform:settlement_hold, credit float:{route}
 *   reject — debit platform:settlement_hold, credit user:{merchant}
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { notifyUser } from "../utils/notifications";
import {
  prepareJournalEntry,
  userAccount,
  floatAccountForRoute,
  SETTLEMENT_HOLD,
  type FloatRoute,
} from "../ledger";
import { ApiResponse, PayoutRequest, PayoutStatus, Transaction } from "../types";
import { PAYOUT_REQUESTS_COLLECTION } from "../payouts/requestPayout";

interface ListPayoutsInput {
  status?: PayoutStatus;
  limit?: number;
}

export const adminListPayouts = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ListPayoutsInput>
  ): Promise<ApiResponse<{ payouts: Array<PayoutRequest & { id: string }> }>> => {
    requireAdmin(request, ["ops", "super"]);

    const status = request.data?.status ?? "requested";
    const limit = Math.min(Math.max(request.data?.limit ?? 50, 1), 200);

    const snap = await admin
      .firestore()
      .collection(PAYOUT_REQUESTS_COLLECTION)
      .where("status", "==", status)
      // Oldest first for the queue: a merchant who has waited longest is the
      // one most likely to be on the phone about it.
      .orderBy("createdAt", status === "requested" ? "asc" : "desc")
      .limit(limit)
      .get();

    return {
      success: true,
      data: {
        payouts: snap.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as PayoutRequest),
        })),
      },
    };
  }
);

interface SettlePayoutInput {
  payoutId: string;
  externalReference: string;
  reason: string;
}

export const adminSettlePayout = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<SettlePayoutInput>
  ): Promise<
    ApiResponse<{ payoutId: string; journalEntryId: string }>
  > => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);

    const { payoutId, externalReference } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof payoutId !== "string" || !payoutId.trim()) {
      throw new https.HttpsError("invalid-argument", "payoutId is required");
    }

    const reference =
      typeof externalReference === "string" ? externalReference.trim() : "";
    if (reference.length < 3) {
      throw new https.HttpsError(
        "invalid-argument",
        "Record the transfer reference — without it this payout cannot be reconciled against a statement"
      );
    }

    const db = admin.firestore();
    const payoutRef = db.collection(PAYOUT_REQUESTS_COLLECTION).doc(payoutId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(payoutRef);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "Payout not found");
      }

      const payout = snap.data() as PayoutRequest;
      if (payout.status !== "requested") {
        throw new https.HttpsError(
          "failed-precondition",
          `This payout was already ${payout.status}`
        );
      }

      // Large payouts need a senior admin. Unlike the float desk there is no
      // second admin in the chain to play checker — the maker is the merchant
      // — so seniority is what stands in for the second pair of eyes.
      if (payout.requiresSeniorApproval && !actor.roles.includes("super")) {
        throw new https.HttpsError(
          "permission-denied",
          "This amount needs a senior admin to settle it"
        );
      }

      const journalEntryId = `payout_settled_${payoutId}`;
      const floatAccount = floatAccountForRoute(payout.route as FloatRoute);

      const prepared = await prepareJournalEntry(tx, {
        entryId: journalEntryId,
        type: "payout_settled",
        currency: "USD",
        lines: [
          { account: SETTLEMENT_HOLD, debit: payout.amountCents, credit: 0 },
          { account: floatAccount, debit: 0, credit: payout.amountCents },
        ],
        refs: { payoutId, transactionId: payout.holdEntryId },
        description: `Payout sent via ${payout.route}`,
        postedBy: actor.uid,
      });

      // A retry whose response was lost must not post a second transfer.
      if (!prepared.alreadyPosted) {
        prepared.write(tx);
      }

      const now = admin.firestore.Timestamp.now();

      // The merchant's pending withdrawal row becomes the completed one, so
      // their history shows one payout rather than a request and a payment.
      tx.update(db.collection("transactions").doc(payout.holdEntryId), {
        status: "completed",
        completedAt: now,
        reference,
        description: `Payout sent (${payout.route})`,
      });

      tx.update(payoutRef, {
        status: "paid" as PayoutStatus,
        decidedBy: actor.uid,
        decidedByEmail: actor.email,
        decidedAt: now,
        decisionReason: reason,
        externalReference: reference,
        settlementEntryId: journalEntryId,
      });

      stageAuditEntry(tx, {
        actor,
        action: "payout.settle",
        target: { type: "payout", id: payoutId },
        reason,
        before: { status: "requested" },
        after: {
          status: "paid",
          merchantId: payout.merchantId,
          amountCents: payout.amountCents,
          route: payout.route,
          externalReference: reference,
        },
        journalEntryId,
      });

      return {
        journalEntryId,
        merchantId: payout.merchantId,
        amountCents: payout.amountCents,
        route: payout.route,
      };
    });

    notifyUser(
      result.merchantId,
      "payout_sent",
      "Payout sent",
      `$${(result.amountCents / 100).toFixed(2)} is on its way via ${result.route}.`
    ).catch((err) => console.error("Failed to notify merchant:", err));

    return {
      success: true,
      message: "Recorded as paid",
      data: { payoutId, journalEntryId: result.journalEntryId },
    };
  }
);

interface RejectPayoutInput {
  payoutId: string;
  reason: string;
}

export const adminRejectPayout = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RejectPayoutInput>
  ): Promise<ApiResponse<{ payoutId: string }>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);

    const { payoutId } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof payoutId !== "string" || !payoutId.trim()) {
      throw new https.HttpsError("invalid-argument", "payoutId is required");
    }

    const db = admin.firestore();
    const payoutRef = db.collection(PAYOUT_REQUESTS_COLLECTION).doc(payoutId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(payoutRef);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "Payout not found");
      }

      const payout = snap.data() as PayoutRequest;
      if (payout.status !== "requested") {
        throw new https.HttpsError(
          "failed-precondition",
          `This payout was already ${payout.status}`
        );
      }

      const journalEntryId = `payout_cancelled_${payoutId}`;

      const prepared = await prepareJournalEntry(tx, {
        entryId: journalEntryId,
        type: "payout_cancelled",
        currency: "USD",
        lines: [
          { account: SETTLEMENT_HOLD, debit: payout.amountCents, credit: 0 },
          {
            account: userAccount(payout.merchantId),
            debit: 0,
            credit: payout.amountCents,
          },
        ],
        refs: { payoutId },
        description: "Payout returned to merchant",
        postedBy: actor.uid,
      });

      if (!prepared.alreadyPosted) {
        prepared.write(tx);
      }

      const now = admin.firestore.Timestamp.now();

      tx.update(db.collection("transactions").doc(payout.holdEntryId), {
        status: "failed",
        completedAt: now,
        description: "Payout declined — returned to your balance",
      });

      tx.update(payoutRef, {
        status: "rejected" as PayoutStatus,
        decidedBy: actor.uid,
        decidedByEmail: actor.email,
        decidedAt: now,
        decisionReason: reason,
      });

      stageAuditEntry(tx, {
        actor,
        action: "payout.reject",
        target: { type: "payout", id: payoutId },
        reason,
        before: { status: "requested" },
        after: {
          status: "rejected",
          merchantId: payout.merchantId,
          amountCents: payout.amountCents,
        },
        journalEntryId,
      });

      return { merchantId: payout.merchantId, amountCents: payout.amountCents };
    });

    notifyUser(
      result.merchantId,
      "payout_rejected",
      "Payout declined",
      `$${(result.amountCents / 100).toFixed(2)} is back in your balance. ${reason}`
    ).catch((err) => console.error("Failed to notify merchant:", err));

    return { success: true, message: "Returned to the merchant", data: { payoutId } };
  }
);
