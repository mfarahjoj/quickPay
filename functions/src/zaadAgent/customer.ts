/**
 * The customer's side of a Zaad top-up through an agent: ask, cancel, say
 * it's sent, dispute.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { getRates } from "../config/rates";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import { ApiResponse } from "../types";
import { firstName, normaliseTxnId, withoutOpen } from "./core";
import { offerNext } from "./dispatch";
import { assertNoActiveZaad, assertZaadAgentOpen, assertZaadAmount, checkZaadCustomer } from "./limits";
import { claimTopupReference, pickTopupReference } from "./reference";
import { releaseZaadHold } from "./settle";
import {
  ZAAD_AGENTS,
  ZAAD_AGENT_TOPUPS,
  ZAAD_AGENT_TXN_IDS,
  ZaadAgentDoc,
  ZaadAgentTopup,
  ZaadTopupStatus,
} from "./types";

/** How long before an unanswered request goes to review the agent is reminded (D32). */
export const REMINDER_MS = 5 * 60_000;

function requestId(data: unknown): string {
  const id = (data as { requestId?: unknown } | undefined)?.requestId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new https.HttpsError("invalid-argument", "requestId required");
  }
  return id;
}

/** The request, if it is the caller's. */
async function ownRequest(uid: string, id: string): Promise<ZaadAgentTopup> {
  const snap = await admin.firestore().collection(ZAAD_AGENT_TOPUPS).doc(id).get();
  const req = snap.data() as ZaadAgentTopup | undefined;
  if (!req || req.customerId !== uid) throw new https.HttpsError("not-found", "Top-up not found");
  return req;
}

/**
 * Ask for a Zaad top-up through an agent. In: `{ amount }` in US cents.
 * Out: the request id and Zapp's reference; the app follows `zaadAgentTopups/{id}` from there.
 */
export const customerRequestZaadAgentTopup = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ requestId: string; status: ZaadTopupStatus; reference: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const rates = await getRates();
    assertZaadAgentOpen(rates);
    const currency = request.data?.currency ?? "USD";
    if (currency !== "USD") {
      throw new https.HttpsError("invalid-argument", "Zaad top-ups through agents are in dollars for now", {
        reason: "currency",
      });
    }
    const amount = request.data?.amount;
    assertZaadAmount(amount, rates);

    const db = admin.firestore();
    const nowMs = Date.now();
    const { user, customerRef } = await checkZaadCustomer(uid, amount, rates, nowMs);

    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc();
    let reference = "";
    await db.runTransaction(async (tx) => {
      await assertNoActiveZaad(tx, customerRef);
      reference = await pickTopupReference(tx);
      const now = admin.firestore.Timestamp.fromMillis(nowMs);
      const record: ZaadAgentTopup = {
        customerId: uid,
        reference,
        customerFirstName: firstName(user.fullName),
        amount,
        currency: "USD",
        status: "offered",
        createdAt: now,
        updatedAt: now,
        deadlineAt: now,
        offers: [],
        offeredTo: null,
        offerExpiresAt: null,
        agentId: null,
        meeting: "remote",
      };
      claimTopupReference(tx, reference, ref.id, uid, now);
      tx.set(ref, record);
      tx.set(customerRef, { activeRequestId: ref.id }, { merge: true });
    });

    await offerNext(ref.id, nowMs);
    const status = ((await ref.get()).data() as ZaadAgentTopup).status;
    return { success: true, data: { requestId: ref.id, status, reference } };
  }
);

/** Cancel before the money is sent. After that, only a dispute. */
export const customerCancelZaadTopup = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ status: ZaadTopupStatus }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const id = requestId(request.data);
    const req = await ownRequest(uid, id);
    const db = admin.firestore();

    if (req.status === "offered") {
      const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(ref)).data() as ZaadAgentTopup;
        if (fresh.status !== "offered") {
          throw new https.HttpsError("failed-precondition", "An agent has just accepted. Cancel again.", {
            reason: "moved",
          });
        }
        const agentRef = fresh.offeredTo ? db.collection(ZAAD_AGENTS).doc(fresh.offeredTo) : null;
        const agent = agentRef ? ((await tx.get(agentRef)).data() as ZaadAgentDoc | undefined) : undefined;
        const now = admin.firestore.Timestamp.now();
        tx.update(ref, { status: "cancelled", offeredTo: null, offerExpiresAt: null, deadlineAt: null, updatedAt: now });
        const freed = agentRef ? withoutOpen(agent, id) : null;
        if (agentRef && freed) tx.update(agentRef, freed);
      });
      return { success: true, data: { status: "cancelled" } };
    }
    if (req.status === "accepted") {
      if (await releaseZaadHold(id, "cancelled", uid, ["accepted"])) {
        return { success: true, data: { status: "cancelled" } };
      }
    }
    throw new https.HttpsError(
      "failed-precondition",
      "This top-up can't be cancelled now. If you sent the money, open a dispute.",
      { reason: "not_cancellable" }
    );
  }
);

/**
 * "I've sent it": one tap. Zapp's reference identifies the top-up (D31), so
 * the customer types nothing. Builds 82–83 may still send `zaadTxnId`; when
 * one comes it is checked and claimed as before, so one Zaad payment can't
 * back two top-ups.
 */
export const customerMarkZaadSent = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ confirmBy: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const id = requestId(request.data);
    const typed = request.data?.zaadTxnId;
    const txnId = typed === undefined || typed === null || typed === "" ? null : normaliseTxnId(typed);
    if (typed !== undefined && typed !== null && typed !== "" && !txnId) {
      throw new https.HttpsError("invalid-argument", "That doesn't look like a Zaad transaction ID", {
        reason: "txn_id",
      });
    }
    const rates = await getRates();
    const db = admin.firestore();
    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
    const txnRef = txnId ? db.collection(ZAAD_AGENT_TXN_IDS).doc(txnId) : null;
    let req: ZaadAgentTopup | null = null;
    let confirmBy!: FirebaseFirestore.Timestamp;

    await db.runTransaction(async (tx) => {
      const [snap, txnSnap] = await Promise.all([tx.get(ref), txnRef ? tx.get(txnRef) : Promise.resolve(null)]);
      const fresh = snap.data() as ZaadAgentTopup | undefined;
      if (!fresh || fresh.customerId !== uid) throw new https.HttpsError("not-found", "Top-up not found");
      // A retry: the same tap again, or the same ID again.
      if (fresh.status === "customer_sent" && (!txnId || fresh.customerZaadTxnId === txnId)) {
        confirmBy = fresh.confirmBy!;
        return; // a retry
      }
      if (fresh.status !== "accepted") {
        throw new https.HttpsError("failed-precondition", "This top-up isn't waiting for your payment", {
          reason: "wrong_status",
          status: fresh.status,
        });
      }
      const nowMs = Date.now();
      if ((fresh.sendBy?.toMillis() ?? 0) < nowMs) {
        throw new https.HttpsError("deadline-exceeded", "The time to send has run out. If you sent it, contact support.", {
          reason: "too_late",
        });
      }
      if (txnSnap?.exists) {
        throw new https.HttpsError("already-exists", "That Zaad transaction ID has already been used", {
          reason: "txn_id_used",
        });
      }
      const now = admin.firestore.Timestamp.fromMillis(nowMs);
      confirmBy = admin.firestore.Timestamp.fromMillis(nowMs + rates.zaadAgentConfirmMinutes * 60_000);
      // D32: the sweep first wakes 5 minutes before, to remind the agent.
      const remindAt = confirmBy.toMillis() - REMINDER_MS;
      const wakeAt = remindAt > nowMs ? admin.firestore.Timestamp.fromMillis(remindAt) : confirmBy;
      if (txnRef) tx.set(txnRef, { requestId: id, customerId: uid, at: now });
      tx.update(ref, {
        status: "customer_sent",
        ...(txnId ? { customerZaadTxnId: txnId } : {}),
        customerSentAt: now,
        confirmBy,
        deadlineAt: wakeAt,
        updatedAt: now,
      });
      req = fresh;
    });

    const sent = req as ZaadAgentTopup | null;
    if (sent?.agentId) {
      notifyUser(
        sent.agentId,
        "zaad_agent_topup",
        {
          key: "zaadAgent.customer_sent",
          params: { customer: sent.customerFirstName, amount: pushAmount(sent.amount, sent.currency) },
        },
        { type: "zaad_agent_sent", requestId: id }
      ).catch((err) => console.error("zaadAgent notify failed:", err));
    }
    return { success: true, data: { confirmBy: confirmBy.toDate().toISOString() } };
  }
);

/** The agent said they didn't receive it, and the customer says they sent it. */
export const customerDisputeZaadTopup = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ status: ZaadTopupStatus }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const id = requestId(request.data);
    const text = typeof request.data?.reason === "string" ? request.data.reason.trim().slice(0, 500) : "";
    const db = admin.firestore();
    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
    let req: ZaadAgentTopup | null = null;

    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as ZaadAgentTopup | undefined;
      if (!fresh || fresh.customerId !== uid) throw new https.HttpsError("not-found", "Top-up not found");
      if (fresh.status === "disputed") return;
      if (fresh.status !== "declined" || (fresh.disputeUntil?.toMillis() ?? 0) < Date.now()) {
        throw new https.HttpsError("failed-precondition", "This top-up can't be disputed now. Contact Zapp Pay support.", {
          reason: "not_disputable",
        });
      }
      const now = admin.firestore.Timestamp.now();
      tx.update(ref, {
        status: "disputed",
        disputedAt: now,
        disputedBy: "customer",
        disputeReason: text,
        deadlineAt: null,
        updatedAt: now,
      });
      req = fresh;
    });

    const disputed = req as ZaadAgentTopup | null;
    if (disputed) notifyDisputed(id, disputed);
    return { success: true, data: { status: "disputed" } };
  }
);

/** Tell both sides ops are looking at it. */
export function notifyDisputed(id: string, req: ZaadAgentTopup): void {
  const amount = pushAmount(req.amount, req.currency);
  for (const uid of [req.customerId, req.agentId]) {
    if (!uid) continue;
    notifyUser(uid, "zaad_agent_topup", { key: "zaadAgent.disputed", params: { amount } }, {
      type: "zaad_agent_topup",
      requestId: id,
    }).catch((err) => console.error("zaadAgent notify failed:", err));
  }
}
