/**
 * The two ways a held Zaad top-up ends: paid to the customer, or returned to
 * the agent. Every caller (the agent's confirm, the customer's cancel, the
 * sweep, ops) goes through here, so each can only ever happen once, and never
 * both: the entry ids are keyed by the request, and each path checks the
 * request is still in a held status inside the same transaction.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { prepareJournalEntry } from "../ledger";
import { Transaction, User } from "../types";
import { getRates, computeCommission } from "../config/rates";
import { assertCashInRecipient } from "../utils/agentGuards";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import { maybeUnlockReferral } from "../referral/referralBonus";
import { creditEntry, creditEntryId, releaseEntry, releaseEntryId } from "./core";
import {
  HELD_STATUSES,
  ReleaseReason,
  ZAAD_AGENTS,
  ZAAD_AGENT_TOPUPS,
  ZaadAgentDoc,
  ZaadAgentTopup,
  ZaadTopupStatus,
} from "./types";

const STATUS_AFTER_RELEASE: Record<ReleaseReason, ZaadTopupStatus> = {
  cancelled: "cancelled",
  expired: "expired",
  declined: "released",
  ops_for_agent: "released",
};

/** Free the agent for new offers if this request is the one holding them. */
function freeAgent(
  tx: FirebaseFirestore.Transaction,
  agentRef: FirebaseFirestore.DocumentReference,
  agentSnap: FirebaseFirestore.DocumentSnapshot,
  requestId: string
): void {
  if (agentSnap.exists && (agentSnap.data() as ZaadAgentDoc).openRequestId === requestId) {
    tx.update(agentRef, { openRequestId: null });
  }
}

/**
 * Extra writes to make in the same transaction as the money, such as ops'
 * ruling and its audit entry. Writes only: every read has happened by then.
 */
export type StageWrites = (
  tx: FirebaseFirestore.Transaction,
  req: ZaadAgentTopup,
  now: FirebaseFirestore.Timestamp
) => void;

/**
 * Return a held request's float to its agent. Resolves true if this call did
 * it; false if the request had moved on (already paid, already returned, or
 * not in one of [from]).
 */
export async function releaseZaadHold(
  requestId: string,
  reason: ReleaseReason,
  postedBy: string,
  from: readonly ZaadTopupStatus[],
  stage?: StageWrites
): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(requestId);
  let released: ZaadAgentTopup | null = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const req = snap.data() as ZaadAgentTopup;
    if (!from.includes(req.status) || !HELD_STATUSES.includes(req.status) || !req.agentId) return;
    const agentRef = db.collection(ZAAD_AGENTS).doc(req.agentId);
    const agentSnap = await tx.get(agentRef);

    const prepared = await prepareJournalEntry(tx, releaseEntry(requestId, req.agentId, req.amount, reason, postedBy));
    if (prepared.alreadyPosted) return;
    prepared.write(tx);

    const now = admin.firestore.Timestamp.now();
    tx.update(ref, {
      status: STATUS_AFTER_RELEASE[reason],
      releaseReason: reason,
      releaseEntryId: releaseEntryId(requestId),
      releasedAt: now,
      deadlineAt: null,
      updatedAt: now,
    });
    freeAgent(tx, agentRef, agentSnap, requestId);
    stage?.(tx, req, now);
    released = req;
  });

  const done = released as ZaadAgentTopup | null;
  if (!done) return false;
  const amount = pushAmount(done.amount, done.currency);
  const quietly = (p: Promise<void>) => p.catch((err) => console.error("zaadAgent notify failed:", err));
  quietly(
    notifyUser(done.agentId!, "zaad_agent_topup", { key: "zaadAgent.float_returned", params: { amount } }, {
      type: "zaad_agent_topup",
      requestId,
    })
  );
  if (reason === "expired") {
    quietly(
      notifyUser(done.customerId, "zaad_agent_topup", { key: "zaadAgent.expired", params: { amount } }, {
        type: "zaad_agent_topup",
        requestId,
      })
    );
  } else if (reason === "ops_for_agent") {
    quietly(
      notifyUser(done.customerId, "zaad_agent_topup", { key: "zaadAgent.resolved_agent", params: { amount } }, {
        type: "zaad_agent_topup",
        requestId,
      })
    );
  }
  return true;
}

export interface CreditResult {
  transactionId: string;
  commissionCents: number;
  /** False when another call had already paid it. */
  credited: boolean;
}

/**
 * Pay a held request to the customer.
 *
 * [by.kind] "agent": the agent confirmed they received the Zaad, and earns
 * commission. "ops": ops decided a dispute for the customer; no commission,
 * since the agent didn't confirm.
 */
export async function creditZaadTopup(
  requestId: string,
  by: { uid: string; kind: "agent" | "ops" },
  from: readonly ZaadTopupStatus[],
  stage?: StageWrites
): Promise<CreditResult> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(requestId);
  const rates = await getRates();
  const transactionId = `zaadagent_${requestId}`;
  let credited: ZaadAgentTopup | null = null;
  let commissionCents = 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new https.HttpsError("not-found", "Top-up not found");
    const req = snap.data() as ZaadAgentTopup;
    if (req.status === "completed") return;
    if (!from.includes(req.status) || !req.agentId) {
      throw new https.HttpsError("failed-precondition", "This top-up can't be credited now", {
        reason: "wrong_status",
        status: req.status,
      });
    }
    if (by.kind === "agent" && req.agentId !== by.uid) {
      throw new https.HttpsError("permission-denied", "This isn't your top-up");
    }
    const agentRef = db.collection(ZAAD_AGENTS).doc(req.agentId);
    const [agentSnap, customerSnap, walletSnap] = await Promise.all([
      tx.get(agentRef),
      tx.get(db.collection("users").doc(req.customerId)),
      tx.get(db.collection("wallets").doc(req.customerId)),
    ]);
    if (!walletSnap.exists) throw new https.HttpsError("not-found", "Customer wallet not found");
    assertCashInRecipient(req.agentId, req.customerId, customerSnap.data() as User | undefined);

    commissionCents = by.kind === "agent" ? computeCommission(req.amount, rates.zaadAgentTopupCommissionRate) : 0;
    const prepared = await prepareJournalEntry(
      tx,
      creditEntry(requestId, req.agentId, req.customerId, req.amount, commissionCents, transactionId, by.uid)
    );
    if (prepared.alreadyPosted) return;
    prepared.write(tx);

    const now = admin.firestore.Timestamp.now();
    const agentName = req.agentName ?? "Zapp Pay agent";
    const description = `Top-up from ${agentName} (Zaad)`;
    const row: Transaction = {
      agentName,
      paidBy: "zaad",
      meeting: req.meeting ?? "remote",
      type: "topup",
      kind: "cash_in",
      fromUserId: req.agentId,
      toUserId: req.customerId,
      participants: [req.agentId, req.customerId],
      amount: req.amount,
      commissionCents,
      currency: req.currency,
      status: "completed",
      description,
      reference: req.customerZaadTxnId ?? requestId,
      journalEntryId: creditEntryId(requestId),
      holdEntryId: req.holdEntryId,
      createdAt: now,
      completedAt: now,
    } as Transaction;
    tx.set(db.collection("transactions").doc(transactionId), row);
    // The agent's existing Top-Up History reads manualTopups.
    tx.set(db.collection("manualTopups").doc(transactionId), {
      userId: req.customerId,
      agentId: req.agentId,
      amount: req.amount,
      amountDollars: req.amount / 100,
      commissionCents,
      commissionDollars: commissionCents / 100,
      currency: req.currency,
      paymentMethod: "zaad",
      reference: req.customerZaadTxnId ?? "",
      notes: by.kind === "ops" ? "Credited by Zapp after a dispute" : "",
      status: "completed",
      transactionId,
      zaadAgentTopupId: requestId,
      createdAt: now,
      completedAt: now,
    });
    tx.update(ref, {
      status: "completed",
      transactionId,
      creditEntryId: creditEntryId(requestId),
      commissionCents,
      completedAt: now,
      deadlineAt: null,
      updatedAt: now,
    });
    freeAgent(tx, agentRef, agentSnap, requestId);
    stage?.(tx, req, now);
    credited = req;
  });

  const done = credited as ZaadAgentTopup | null;
  if (done) {
    const amount = pushAmount(done.amount, done.currency);
    const message =
      by.kind === "agent"
        ? { key: "topup.by_agent" as const, params: { agent: done.agentName ?? "Your agent", amount } }
        : { key: "zaadAgent.resolved_customer" as const, params: { amount } };
    notifyUser(done.customerId, "topup_completed", message, {
      type: "topup_completed",
      amount: String(done.amount),
      currency: done.currency,
      confirmationId: transactionId,
    }).catch((err) => console.error("zaadAgent notify failed:", err));
    await maybeUnlockReferral(done.customerId, { kind: "cash_in", amountCents: done.amount });
  }
  return { transactionId, commissionCents, credited: done !== null };
}
