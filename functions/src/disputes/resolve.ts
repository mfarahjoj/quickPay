/**
 * Resolving disputes — the admin desk, the remedy, and the D8 reserve.
 *
 * Upheld, the raiser gets `amountCents` back through one of two remedies:
 * - `refund`: the full counter payment is reversed exactly (merchant net,
 *   platform fee, customer gross), the same entry as a merchant's own refund;
 * - `adjustment`: anything else — part of a payment, a P2P sent to the wrong
 *   person, cash an agent didn't hand over — moves `amountCents` from the
 *   other party (or Zapp, `payFrom: "platform"`) to the raiser.
 *
 * If the other party can't cover it (D8: wait for funds), the dispute goes to
 * `awaiting_funds`, `owedCents` is reserved in their wallet so they can't
 * spend it, and `disputeHousekeeping` posts the remedy as soon as their
 * balance allows. The customer is never paid from money that isn't there.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { ApiResponse, Transaction } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "../admin/guard";
import { stageAuditEntry } from "../admin/audit";
import { prepareAdjustment } from "../admin/adjustments";
import { prepareRefund } from "../qr-payments/refundCore";
import { getRates } from "../config/rates";
import { notifyUser } from "../utils/notifications";
import { reviewAgentStanding } from "../agents/standing";
import {
  userAccount,
  PLATFORM_FEES,
  InsufficientBalanceError,
  WalletNotFoundError,
} from "../ledger";
import {
  DISPUTES_COLLECTION,
  DisputeDoc,
  DisputeRemedy,
  DisputeResolution,
} from "./types";

type PayFrom = "counterparty" | "platform";

interface Remedy {
  remedy: Exclude<DisputeRemedy, "none">;
  /** What leaves the payer's account: the merchant's net for a refund. */
  payerDebitCents: number;
}

/** Pick the remedy for an upheld dispute. */
export function chooseRemedy(
  d: DisputeDoc,
  tx: Transaction | undefined,
  amountCents: number,
  payFrom: PayFrom
): Remedy {
  const fullRefund =
    payFrom === "counterparty" &&
    d.disputedKind === "shop_payment" &&
    tx !== undefined &&
    !tx.refundedAt &&
    tx.fromUserId === d.raisedBy &&
    amountCents === tx.amount;
  if (fullRefund) {
    return { remedy: "refund", payerDebitCents: tx!.netCents ?? tx!.amount };
  }
  return { remedy: "adjustment", payerDebitCents: amountCents };
}

interface PreparedRemedy {
  journalEntryId: string;
  refundTransactionId?: string;
  write(t: FirebaseFirestore.Transaction): void;
}

/** Reads only; the caller stages `write` after its own reads. */
async function prepareRemedy(
  t: FirebaseFirestore.Transaction,
  disputeId: string,
  d: DisputeDoc,
  remedy: Remedy["remedy"],
  amountCents: number,
  payFrom: PayFrom,
  postedBy: string,
  useReserved: boolean
): Promise<PreparedRemedy> {
  if (remedy === "refund") {
    const refund = await prepareRefund(t, d.transactionId!, {
      postedBy,
      disputeId,
      useReserved,
      allowFrozenDebit: true,
    });
    return {
      journalEntryId: `refund_${d.transactionId}`,
      refundTransactionId: refund.refundTransactionId,
      write: refund.write,
    };
  }
  const adjustment = await prepareAdjustment(t, {
    adjustmentId: `dispute_${disputeId}`,
    debitAccount: payFrom === "platform" ? PLATFORM_FEES : userAccount(d.against!),
    creditAccount: userAccount(d.raisedBy),
    amountCents,
    reason: `Dispute ${disputeId} upheld`,
    postedBy,
    disputeId,
    description: "Dispute settlement",
    useReserved,
  });
  return { journalEntryId: adjustment.journalEntryId, write: adjustment.write };
}

function notifyBoth(d: DisputeDoc, disputeId: string, raiserBody: string, againstBody: string) {
  const send = (uid: string | null, body: string) =>
    uid &&
    notifyUser(uid, "dispute_resolved", "Dispute decided", body, {
      type: "dispute_resolved",
      disputeId,
    }).catch((err) => console.error("Failed to notify dispute outcome:", err));
  send(d.raisedBy, raiserBody);
  send(d.against, againstBody);
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface ResolveRequest {
  disputeId: string;
  outcome: "upheld" | "rejected";
  reason: string;
  /** Upheld only; defaults to what the raiser claimed. */
  amountCents?: number;
  /** Upheld only; defaults to the other party. Required as "platform" when there is none. */
  payFrom?: PayFrom;
}

interface ResolveResponse {
  status: DisputeDoc["status"];
  remedy: DisputeRemedy;
  journalEntryId?: string;
  owedCents?: number;
  auditId: string;
}

export const adminResolveDispute = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<ResolveRequest>): Promise<ApiResponse<ResolveResponse>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const { disputeId, outcome } = request.data ?? ({} as ResolveRequest);
    if (typeof disputeId !== "string" || !disputeId) {
      throw new https.HttpsError("invalid-argument", "disputeId is required");
    }
    if (outcome !== "upheld" && outcome !== "rejected") {
      throw new https.HttpsError("invalid-argument", "outcome must be 'upheld' or 'rejected'");
    }

    const db = admin.firestore();
    const ref = db.collection(DISPUTES_COLLECTION).doc(disputeId);
    const { floatApprovalThresholdCents } = await getRates();

    // Validation that needs the dispute, outside the money transaction.
    const pre = await ref.get();
    if (!pre.exists) throw new https.HttpsError("not-found", "Dispute not found");
    const preDoc = pre.data() as DisputeDoc;
    const payFrom: PayFrom = request.data?.payFrom ?? "counterparty";
    const amountCents = request.data?.amountCents ?? preDoc.amountCents;
    if (outcome === "upheld") {
      if (payFrom !== "counterparty" && payFrom !== "platform") {
        throw new https.HttpsError("invalid-argument", "payFrom must be 'counterparty' or 'platform'");
      }
      if (payFrom === "counterparty" && !preDoc.against) {
        throw new https.HttpsError(
          "failed-precondition",
          "There is no other party to pay this; uphold it with payFrom 'platform'",
          { reason: "no_counterparty" }
        );
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > preDoc.transactionAmountCents) {
        throw new https.HttpsError("invalid-argument", "amountCents must be between 1 and the transaction amount");
      }
      if (amountCents >= floatApprovalThresholdCents && !actor.roles.includes("super")) {
        throw new https.HttpsError("permission-denied", "Upholding this much needs a senior admin", {
          reason: "needs_super",
        });
      }
    }

    const active = (d: DisputeDoc) => {
      if (d.status !== "open" && d.status !== "under_review") {
        throw new https.HttpsError("failed-precondition", `This dispute is already ${d.status}`, {
          reason: "dispute_closed",
        });
      }
    };

    try {
      const result = await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const d = snap.data() as DisputeDoc;
        active(d);
        const txSnap = d.transactionId ? await t.get(db.collection("transactions").doc(d.transactionId)) : null;
        const tx = txSnap?.exists ? (txSnap.data() as Transaction) : undefined;
        const now = admin.firestore.Timestamp.now();

        if (outcome === "rejected") {
          const resolution: DisputeResolution = {
            outcome,
            amountCents: 0,
            remedy: "none",
            payFrom: null,
            reason,
            decidedBy: actor.uid,
            decidedAt: now,
          };
          t.update(ref, { status: "resolved", resolution, updatedAt: now });
          const auditId = stageAuditEntry(t, {
            actor,
            action: "dispute.reject",
            target: { type: "dispute", id: disputeId },
            reason,
          });
          return { d, status: "resolved" as const, remedy: "none" as const, auditId };
        }

        const { remedy } = chooseRemedy(d, tx, amountCents, payFrom);
        const prepared = await prepareRemedy(t, disputeId, d, remedy, amountCents, payFrom, actor.uid, false);
        prepared.write(t);
        const resolution: DisputeResolution = {
          outcome,
          amountCents,
          remedy,
          payFrom,
          reason,
          decidedBy: actor.uid,
          decidedAt: now,
          settledAt: now,
          journalEntryId: prepared.journalEntryId,
          ...(prepared.refundTransactionId ? { refundTransactionId: prepared.refundTransactionId } : {}),
        };
        t.update(ref, { status: "resolved", resolution, updatedAt: now });
        const auditId = stageAuditEntry(t, {
          actor,
          action: "dispute.uphold",
          target: { type: "dispute", id: disputeId },
          reason,
          after: { amountCents, remedy, payFrom },
          journalEntryId: prepared.journalEntryId,
        });
        return { d, status: "resolved" as const, remedy, journalEntryId: prepared.journalEntryId, auditId };
      });

      if (outcome === "rejected") {
        notifyBoth(result.d, disputeId, "Your dispute was reviewed and not upheld.", "A dispute against you was not upheld.");
      } else {
        notifyBoth(
          result.d,
          disputeId,
          `Your dispute was upheld. ${dollars(amountCents)} is back in your wallet.`,
          `A dispute against you was upheld and ${dollars(amountCents)} was returned to the customer.`
        );
        // Upheld against an agent counts towards their standing (2.6).
        if (payFrom === "counterparty") await reviewAgentStanding(result.d.against);
      }
      return {
        success: true,
        data: {
          status: result.status,
          remedy: result.remedy,
          ...(result.journalEntryId ? { journalEntryId: result.journalEntryId } : {}),
          auditId: result.auditId,
        },
      };
    } catch (error: any) {
      // D8: the other party can't cover it. Reserve what they owe and settle later.
      if (error instanceof InsufficientBalanceError && outcome === "upheld" && payFrom === "counterparty") {
        const parked = await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          const d = snap.data() as DisputeDoc;
          active(d);
          const txSnap = d.transactionId ? await t.get(db.collection("transactions").doc(d.transactionId)) : null;
          const tx = txSnap?.exists ? (txSnap.data() as Transaction) : undefined;
          const { remedy, payerDebitCents } = chooseRemedy(d, tx, amountCents, payFrom);
          const now = admin.firestore.Timestamp.now();
          const resolution: DisputeResolution = {
            outcome,
            amountCents,
            remedy,
            payFrom,
            reason,
            decidedBy: actor.uid,
            decidedAt: now,
          };
          t.update(ref, { status: "awaiting_funds", owedCents: payerDebitCents, resolution, updatedAt: now });
          t.update(db.collection("wallets").doc(d.against!), {
            reservedCents: admin.firestore.FieldValue.increment(payerDebitCents),
          });
          const auditId = stageAuditEntry(t, {
            actor,
            action: "dispute.uphold_awaiting_funds",
            target: { type: "dispute", id: disputeId },
            reason,
            after: { amountCents, remedy, owedCents: payerDebitCents },
          });
          return { d, remedy, payerDebitCents, auditId };
        });
        await reviewAgentStanding(parked.d.against);
        notifyBoth(
          parked.d,
          disputeId,
          `Your dispute was upheld. ${dollars(amountCents)} will reach your wallet as soon as the other party has it.`,
          `A dispute against you was upheld. ${dollars(parked.payerDebitCents)} is owed and will be taken from your next payments.`
        );
        return {
          success: true,
          message: "Upheld; waiting for the other party's funds",
          data: {
            status: "awaiting_funds",
            remedy: parked.remedy,
            owedCents: parked.payerDebitCents,
            auditId: parked.auditId,
          },
        };
      }
      if (error instanceof WalletNotFoundError) {
        throw new https.HttpsError("failed-precondition", `No wallet for ${error.account}`);
      }
      if (error instanceof https.HttpsError) throw error;
      console.error("Dispute resolution failed:", error);
      throw new https.HttpsError("internal", "Could not resolve the dispute");
    }
  }
);

/**
 * Post the remedy of every awaiting_funds dispute whose payer can now cover
 * it, oldest first, releasing its reserve in the same transaction.
 */
export async function collectAwaitingDisputes(limit = 50): Promise<number> {
  const db = admin.firestore();
  const waiting = await db
    .collection(DISPUTES_COLLECTION)
    .where("status", "==", "awaiting_funds")
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();

  let settled = 0;
  for (const doc of waiting.docs) {
    try {
      const done = await db.runTransaction(async (t) => {
        const snap = await t.get(doc.ref);
        const d = snap.data() as DisputeDoc;
        if (d.status !== "awaiting_funds" || !d.resolution || !d.against || !d.owedCents) return null;
        const walletRef = db.collection("wallets").doc(d.against);
        const wallet = (await t.get(walletRef)).data();
        if (!wallet || wallet.balance < d.owedCents) return null;

        const remedy = d.resolution.remedy === "refund" ? "refund" : "adjustment";
        const prepared = await prepareRemedy(
          t,
          doc.id,
          d,
          remedy,
          d.resolution.amountCents,
          "counterparty",
          "system",
          true
        );
        prepared.write(t);
        const now = admin.firestore.Timestamp.now();
        t.update(walletRef, { reservedCents: admin.firestore.FieldValue.increment(-d.owedCents) });
        const resolution: DisputeResolution = {
          ...d.resolution,
          settledAt: now,
          journalEntryId: prepared.journalEntryId,
          ...(prepared.refundTransactionId ? { refundTransactionId: prepared.refundTransactionId } : {}),
        };
        t.update(doc.ref, {
          status: "resolved",
          owedCents: admin.firestore.FieldValue.delete(),
          resolution,
          updatedAt: now,
        });
        return d;
      });
      if (done) {
        settled++;
        notifyBoth(
          done,
          doc.id,
          `${dollars(done.resolution!.amountCents)} from your upheld dispute is now in your wallet.`,
          `${dollars(done.owedCents!)} owed on a dispute has now been paid.`
        );
      }
    } catch (err) {
      // One stuck dispute must not stop the rest; the next run retries it.
      console.error(`Collecting dispute ${doc.id} failed:`, err);
    }
  }
  return settled;
}

/** Open disputes the other party didn't answer in time go to ops. */
export async function escalateUnansweredDisputes(now = admin.firestore.Timestamp.now(), limit = 100) {
  const db = admin.firestore();
  const due = await db
    .collection(DISPUTES_COLLECTION)
    .where("status", "==", "open")
    .where("respondBy", "<=", now)
    .limit(limit)
    .get();
  const batch = db.batch();
  due.docs.forEach((d) => batch.update(d.ref, { status: "under_review", updatedAt: now }));
  if (!due.empty) await batch.commit();
  return due.size;
}

/** Every 30 minutes: escalate unanswered disputes, collect owed remedies. */
export const disputeHousekeeping = onSchedule("every 30 minutes", async () => {
  const escalated = await escalateUnansweredDisputes();
  const settled = await collectAwaitingDisputes();
  console.log(`disputeHousekeeping: escalated ${escalated}, settled ${settled}`);
});

/**
 * A merchant refunded a payment that had an open dispute against them: that
 * answers the claim, so close it as upheld in the refund's transaction.
 * Disputes already decided by ops are left alone.
 */
export function stageResolvedByRefund(
  t: FirebaseFirestore.Transaction,
  disputeRef: FirebaseFirestore.DocumentReference,
  d: DisputeDoc | undefined,
  refund: { refundTransactionId: string; gross: number; merchantId: string; journalEntryId: string }
): boolean {
  if (!d || (d.status !== "open" && d.status !== "under_review")) return false;
  if (d.against !== refund.merchantId) return false;
  const now = admin.firestore.Timestamp.now();
  const resolution: DisputeResolution = {
    outcome: "upheld",
    amountCents: refund.gross,
    remedy: "refund",
    payFrom: "counterparty",
    reason: "Refunded by the merchant",
    decidedBy: refund.merchantId,
    decidedAt: now,
    settledAt: now,
    journalEntryId: refund.journalEntryId,
    refundTransactionId: refund.refundTransactionId,
  };
  t.update(disputeRef, { status: "resolved", resolution, updatedAt: now });
  return true;
}

// ── Desk reads ──

function serialise(id: string, d: DisputeDoc) {
  const ms = (ts?: FirebaseFirestore.Timestamp) => ts?.toMillis?.() ?? null;
  return {
    id,
    ...d,
    createdAt: ms(d.createdAt),
    updatedAt: ms(d.updatedAt),
    respondBy: ms(d.respondBy),
    resolveBy: ms(d.resolveBy),
    messages: d.messages.map((m) => ({ ...m, at: ms(m.at) })),
    ...(d.resolution
      ? {
          resolution: {
            ...d.resolution,
            decidedAt: ms(d.resolution.decidedAt),
            settledAt: ms(d.resolution.settledAt),
          },
        }
      : {}),
  };
}

export const adminListDisputes = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ status?: DisputeDoc["status"]; limit?: number }>) => {
    requireAdmin(request, ["ops", "super", "compliance"]);
    const limit = Math.min(Math.max(Number(request.data?.limit) || 50, 1), 200);
    let q: FirebaseFirestore.Query = admin.firestore().collection(DISPUTES_COLLECTION);
    if (request.data?.status) q = q.where("status", "==", request.data.status);
    const snap = await q.orderBy("createdAt", "desc").limit(limit).get();
    return {
      success: true,
      data: { disputes: snap.docs.map((d) => serialise(d.id, d.data() as DisputeDoc)) },
    };
  }
);

/** One dispute with what ops need to decide it: the movement and both wallets. */
export const adminGetDispute = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ disputeId: string }>) => {
    requireAdmin(request, ["ops", "super", "compliance"]);
    const disputeId = request.data?.disputeId;
    if (typeof disputeId !== "string" || !disputeId) {
      throw new https.HttpsError("invalid-argument", "disputeId is required");
    }
    const db = admin.firestore();
    const snap = await db.collection(DISPUTES_COLLECTION).doc(disputeId).get();
    if (!snap.exists) throw new https.HttpsError("not-found", "Dispute not found");
    const d = snap.data() as DisputeDoc;

    const party = async (uid: string | null) => {
      if (!uid) return null;
      const [u, w] = await Promise.all([
        db.collection("users").doc(uid).get(),
        db.collection("wallets").doc(uid).get(),
      ]);
      return {
        uid,
        fullName: u.data()?.fullName ?? null,
        phoneNumber: u.data()?.phoneNumber ?? null,
        accountType: u.data()?.accountType ?? null,
        balanceCents: w.data()?.balance ?? null,
        reservedCents: w.data()?.reservedCents ?? 0,
      };
    };
    const tx = d.transactionId ? (await db.collection("transactions").doc(d.transactionId).get()).data() : null;

    return {
      success: true,
      data: {
        dispute: serialise(snap.id, d),
        transaction: tx
          ? { ...tx, createdAt: tx.createdAt?.toMillis?.() ?? null, completedAt: tx.completedAt?.toMillis?.() ?? null }
          : null,
        raiser: await party(d.raisedBy),
        against: await party(d.against),
      },
    };
  }
);
