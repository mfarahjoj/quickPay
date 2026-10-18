/**
 * Raising and following a dispute — the callables both apps use.
 *
 * `openDispute` checks that the caller was part of the movement, that it is
 * recent enough (disputeWindowDays, D6), that the claim fits the movement,
 * and that the caller hasn't already disputed it. The other party gets
 * `disputeResponseHours` to reply (D7) before it goes to ops anyway.
 *
 * Both parties read their disputes straight from Firestore (rules: members
 * of `participants` only); every write goes through here or the admin desk.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, Transaction } from "../types";
import { requireAuth, sanitizeString } from "../utils/validation";
import { getRates } from "../config/rates";
import { notifyUser } from "../utils/notifications";
import { JOURNAL_COLLECTION, JournalEntryType } from "../ledger";
import { REFUNDABLE_ENTRY_TYPES } from "../qr-payments/refundCore";
import {
  ACTIVE_STATUSES,
  DISPUTES_COLLECTION,
  DISPUTE_KINDS,
  DisputeDoc,
  DisputeKind,
  DisputedKind,
  DisputeMessage,
  allowedKinds,
  isFinal,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Open disputes one person may have at once; stops a flood of claims. */
export const MAX_ACTIVE_DISPUTES = 5;
const MAX_TEXT = 1000;

/** What a transaction row plus its journal entry say was moved. */
export function classifyTransaction(
  tx: Transaction,
  entryType: JournalEntryType | undefined
): DisputedKind {
  switch (tx.type) {
    case "payment":
      if (tx.apiChargeId || entryType === "online_payment") return "online_payment";
      if (entryType && REFUNDABLE_ENTRY_TYPES.includes(entryType)) return "shop_payment";
      if (entryType === "p2p") return "p2p";
      if (entryType === "payroll") return "payroll";
      return "other";
    case "topup":
      return "cash_in";
    case "withdrawal":
      // Agent cash-outs carry their hold entry; merchant payouts don't.
      return tx.holdEntryId || entryType === "agent_cashout" ? "cash_out" : "other";
    default:
      return "other";
  }
}

function requireText(value: unknown, field: string): string {
  const text = typeof value === "string" ? sanitizeString(value) : "";
  if (text.length < 3 || text.length > MAX_TEXT) {
    throw new https.HttpsError("invalid-argument", `${field} must be 3 to ${MAX_TEXT} characters`);
  }
  return text;
}

function notifyQuietly(
  userId: string | null,
  type: "dispute_opened" | "dispute_updated" | "dispute_resolved",
  title: string,
  body: string,
  disputeId: string
): void {
  if (!userId) return;
  notifyUser(userId, type, title, body, { type, disputeId }).catch((err) =>
    console.error(`Failed to notify ${userId} about dispute ${disputeId}:`, err)
  );
}

interface OpenDisputeRequest {
  transactionId?: string;
  agentTopupRequestId?: string;
  kind: DisputeKind;
  note: string;
  /** Defaults to the whole amount. */
  amountCents?: number;
}

export const openDispute = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<OpenDisputeRequest>
  ): Promise<ApiResponse<{ disputeId: string; status: DisputeDoc["status"] }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const { transactionId, agentTopupRequestId, kind } = request.data ?? ({} as OpenDisputeRequest);
    const note = requireText(request.data?.note, "note");

    if (!DISPUTE_KINDS.includes(kind)) {
      throw new https.HttpsError("invalid-argument", "Unknown dispute kind");
    }
    if (!!transactionId === !!agentTopupRequestId) {
      throw new https.HttpsError(
        "invalid-argument",
        "Name the transaction, or for an uncredited cash-in the top-up request"
      );
    }

    const db = admin.firestore();
    const rates = await getRates();

    // ── What is being disputed, and by whom ──
    let disputedKind: DisputedKind;
    let side: "payer" | "payee";
    let against: string | null;
    let transactionAmountCents: number;
    let happenedAt: number | undefined;
    let disputeId: string;

    if (transactionId) {
      const txSnap = await db.collection("transactions").doc(transactionId).get();
      if (!txSnap.exists) throw new https.HttpsError("not-found", "Transaction not found");
      const tx = txSnap.data() as Transaction;
      const parties = tx.participants ?? [tx.fromUserId, tx.toUserId];
      if (!parties.includes(uid)) {
        throw new https.HttpsError("permission-denied", "You weren't part of this transaction");
      }
      const entryType = tx.journalEntryId
        ? ((await db.collection(JOURNAL_COLLECTION).doc(tx.journalEntryId).get()).data()?.type as
            | JournalEntryType
            | undefined)
        : undefined;
      disputedKind = classifyTransaction(tx, entryType);
      side = tx.fromUserId === uid ? "payer" : "payee";
      const other = side === "payer" ? tx.toUserId : tx.fromUserId;
      against = other && other !== "system" && other !== uid ? other : null;
      transactionAmountCents = tx.amount;
      happenedAt = (tx.completedAt ?? tx.createdAt)?.toMillis?.();
      disputeId = `${transactionId}_${uid}`;
    } else {
      const reqSnap = await db.collection("agentTopupRequests").doc(agentTopupRequestId!).get();
      if (!reqSnap.exists) throw new https.HttpsError("not-found", "Top-up request not found");
      const req = reqSnap.data()!;
      if (req.customerId !== uid) {
        throw new https.HttpsError("permission-denied", "This isn't your top-up request");
      }
      // Completed requests were credited: that's a normal transaction to dispute.
      const lapsed =
        req.status === "expired" ||
        req.status === "cancelled" ||
        (req.status === "pending" && req.expiresAt?.toMillis?.() < Date.now());
      if (!lapsed) {
        throw new https.HttpsError(
          "failed-precondition",
          "This top-up is still open or was credited",
          { reason: "not_uncredited" }
        );
      }
      disputedKind = "uncredited_cash_in";
      side = "payee";
      // Nobody confirmed it, so there is no known agent to answer.
      against = null;
      transactionAmountCents = req.amount;
      happenedAt = req.createdAt?.toMillis?.();
      disputeId = `atr_${agentTopupRequestId}_${uid}`;
    }

    if (!allowedKinds(disputedKind, side).includes(kind)) {
      throw new https.HttpsError(
        "invalid-argument",
        "That kind of claim doesn't fit this transaction",
        { reason: "kind_not_allowed", allowed: allowedKinds(disputedKind, side) }
      );
    }

    if (!happenedAt || Date.now() - happenedAt > rates.disputeWindowDays * DAY_MS) {
      throw new https.HttpsError(
        "failed-precondition",
        `Disputes can be opened for ${rates.disputeWindowDays} days. Contact support for older ones.`,
        { reason: "dispute_window_closed", disputeWindowDays: rates.disputeWindowDays }
      );
    }

    const amountCents = request.data?.amountCents ?? transactionAmountCents;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > transactionAmountCents) {
      throw new https.HttpsError(
        "invalid-argument",
        "The amount must be more than zero and no more than the transaction"
      );
    }

    const active = await db
      .collection(DISPUTES_COLLECTION)
      .where("raisedBy", "==", uid)
      .where("status", "in", [...ACTIVE_STATUSES])
      .limit(MAX_ACTIVE_DISPUTES)
      .get();
    if (active.size >= MAX_ACTIVE_DISPUTES) {
      throw new https.HttpsError(
        "resource-exhausted",
        "You have several disputes open. We'll finish those first.",
        { reason: "too_many_disputes" }
      );
    }

    const ref = db.collection(DISPUTES_COLLECTION).doc(disputeId);
    const nowMs = Date.now();
    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    const doc: DisputeDoc = {
      ...(transactionId ? { transactionId } : { agentTopupRequestId }),
      disputedKind,
      kind,
      // With nobody to answer, it goes straight to ops.
      status: against ? "open" : "under_review",
      raisedBy: uid,
      against,
      participants: against ? [uid, against] : [uid],
      amountCents,
      transactionAmountCents,
      currency: "USD",
      messages: [{ by: uid, role: "raiser", text: note, at: now }],
      createdAt: now,
      updatedAt: now,
      respondBy: admin.firestore.Timestamp.fromMillis(nowMs + rates.disputeResponseHours * HOUR_MS),
      resolveBy: admin.firestore.Timestamp.fromMillis(nowMs + rates.disputeResolutionHours * HOUR_MS),
    };

    await db.runTransaction(async (t) => {
      // One dispute per transaction per person, ever: a second claim goes on
      // the first one's thread, or to support once it's closed.
      if ((await t.get(ref)).exists) {
        throw new https.HttpsError("already-exists", "You've already disputed this", {
          reason: "already_disputed",
          disputeId,
        });
      }
      t.create(ref, doc);
      if (transactionId) {
        t.update(db.collection("transactions").doc(transactionId), { disputeId });
      }
    });

    notifyQuietly(
      against,
      "dispute_opened",
      "A payment was disputed",
      `A customer disputed a payment of $${(amountCents / 100).toFixed(2)}. Reply within ${Math.round(
        rates.disputeResponseHours / 24
      )} days.`,
      disputeId
    );

    return { success: true, data: { disputeId, status: doc.status } };
  }
);

interface PostMessageRequest {
  disputeId: string;
  text: string;
}

/**
 * Add to the thread. The other party's first reply hands the dispute to ops
 * without waiting for respondBy.
 */
export const postDisputeMessage = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<PostMessageRequest>
  ): Promise<ApiResponse<{ status: DisputeDoc["status"] }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const text = requireText(request.data?.text, "text");
    const disputeId = request.data?.disputeId;
    if (typeof disputeId !== "string" || !disputeId) {
      throw new https.HttpsError("invalid-argument", "disputeId is required");
    }

    const db = admin.firestore();
    const ref = db.collection(DISPUTES_COLLECTION).doc(disputeId);

    const result = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new https.HttpsError("not-found", "Dispute not found");
      const d = snap.data() as DisputeDoc;
      const role = d.raisedBy === uid ? "raiser" : d.against === uid ? "counterparty" : null;
      if (!role) throw new https.HttpsError("permission-denied", "This isn't your dispute");
      if (isFinal(d.status)) {
        throw new https.HttpsError("failed-precondition", "This dispute is closed", {
          reason: "dispute_closed",
        });
      }
      if (d.messages.length >= 50) {
        throw new https.HttpsError("resource-exhausted", "This thread is full; support will follow up");
      }
      const now = admin.firestore.Timestamp.now();
      const message: DisputeMessage = { by: uid, role, text, at: now };
      const status = d.status === "open" && role === "counterparty" ? "under_review" : d.status;
      t.update(ref, { messages: [...d.messages, message], status, updatedAt: now });
      return { status, notify: role === "raiser" ? d.against : d.raisedBy };
    });

    notifyQuietly(result.notify, "dispute_updated", "Dispute update", "There's a new reply on a dispute.", disputeId);
    return { success: true, data: { status: result.status } };
  }
);

/** The raiser drops their claim. Not possible once ops have upheld it. */
export const withdrawDispute = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ disputeId: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const disputeId = request.data?.disputeId;
    if (typeof disputeId !== "string" || !disputeId) {
      throw new https.HttpsError("invalid-argument", "disputeId is required");
    }
    const db = admin.firestore();
    const ref = db.collection(DISPUTES_COLLECTION).doc(disputeId);

    const against = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new https.HttpsError("not-found", "Dispute not found");
      const d = snap.data() as DisputeDoc;
      if (d.raisedBy !== uid) {
        throw new https.HttpsError("permission-denied", "Only the person who raised it can withdraw it");
      }
      if (d.status !== "open" && d.status !== "under_review") {
        throw new https.HttpsError("failed-precondition", "This dispute can no longer be withdrawn", {
          reason: "dispute_closed",
        });
      }
      const now = admin.firestore.Timestamp.now();
      t.update(ref, { status: "withdrawn", withdrawnAt: now, updatedAt: now });
      return d.against;
    });

    notifyQuietly(against, "dispute_resolved", "Dispute withdrawn", "A dispute against you was withdrawn.", disputeId);
    return { success: true, message: "Dispute withdrawn" };
  }
);
