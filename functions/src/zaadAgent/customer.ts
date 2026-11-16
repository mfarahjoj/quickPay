/**
 * The customer's side of a Zaad top-up through an agent: ask, cancel, say
 * it's sent, dispute.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { enforcePerTransactionLimit } from "../utils/limits";
import { isPrivilegedRole } from "../utils/roles";
import { getRates } from "../config/rates";
import { notifyUser } from "../utils/notifications";
import { formatAmount, pushAmount } from "../utils/money";
import { ApiResponse, User } from "../types";
import { activeStrikes, firstName, normaliseTxnId } from "./core";
import { offerNext } from "./dispatch";
import { releaseZaadHold } from "./settle";
import {
  ACTIVE_STATUSES,
  ZAAD_AGENTS,
  ZAAD_AGENT_CUSTOMERS,
  ZAAD_AGENT_TOPUPS,
  ZAAD_AGENT_TXN_IDS,
  ZaadAgentCustomerDoc,
  ZaadAgentDoc,
  ZaadAgentTopup,
  ZaadTopupStatus,
} from "./types";

const DAY_MS = 24 * 3600 * 1000;
/** Requests that never got as far as an agent's float don't count towards the daily amount. */
const NOT_COUNTED: readonly ZaadTopupStatus[] = ["no_agent", "cancelled", "expired", "released"];

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
 * Out: the request id; the app follows `zaadAgentTopups/{id}` from there.
 */
export const customerRequestZaadAgentTopup = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ requestId: string; status: ZaadTopupStatus }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const rates = await getRates();
    if (rates.zaadAgentTopups !== "on") {
      throw new https.HttpsError("unavailable", "Zaad top-ups through agents aren't open yet", { reason: "off" });
    }
    const currency = request.data?.currency ?? "USD";
    if (currency !== "USD") {
      throw new https.HttpsError("invalid-argument", "Zaad top-ups through agents are in dollars for now", {
        reason: "currency",
      });
    }
    const amount = request.data?.amount;
    const min = rates.zaadAgentTopupMinCents;
    const max = rates.zaadAgentTopupMaxCents;
    if (!Number.isInteger(amount) || amount < min || amount > max) {
      throw new https.HttpsError(
        "invalid-argument",
        `Top up between ${formatAmount(min, "USD")} and ${formatAmount(max, "USD")}`,
        { reason: "amount_out_of_range", minCents: min, maxCents: max }
      );
    }

    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) throw new https.HttpsError("not-found", "User not found");
    const user = userSnap.data() as User;
    assertAccountActive(user);
    // Agents and merchants hold float or takings; a cash-in to them moves
    // value between businesses (agentGuards.ts).
    if (isPrivilegedRole(user.accountType)) {
      throw new https.HttpsError("permission-denied", "Zaad top-ups through agents are for customer accounts");
    }
    // D5: the payment must come from the customer's own number, which sign-up
    // verified by SMS code.
    if (!user.phoneNumber) {
      throw new https.HttpsError("failed-precondition", "Your account has no phone number");
    }
    await enforcePerTransactionLimit(amount, user, "USD");

    const nowMs = Date.now();
    const customerRef = db.collection(ZAAD_AGENT_CUSTOMERS).doc(uid);
    const customer = (await customerRef.get()).data() as ZaadAgentCustomerDoc | undefined;
    if (
      customer?.blocked ||
      activeStrikes(customer?.strikes, rates.zaadAgentStrikeWindowDays, nowMs) >= rates.zaadAgentCustomerStrikes
    ) {
      throw new https.HttpsError(
        "permission-denied",
        "Zaad top-ups through agents are paused on your account. Contact Zapp Pay support.",
        { reason: "blocked" }
      );
    }

    const recent = await db
      .collection(ZAAD_AGENT_TOPUPS)
      .where("customerId", "==", uid)
      .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(nowMs - DAY_MS))
      .limit(100)
      .get();
    if (recent.size >= rates.zaadAgentDailyCount) {
      throw new https.HttpsError("resource-exhausted", "You've asked for as many top-ups as you can today", {
        reason: "daily_count",
      });
    }
    const todayCents = recent.docs
      .map((d) => d.data() as ZaadAgentTopup)
      .filter((r) => !NOT_COUNTED.includes(r.status))
      .reduce((sum, r) => sum + r.amount, 0);
    if (todayCents + amount > rates.zaadAgentDailyMaxCents) {
      throw new https.HttpsError(
        "resource-exhausted",
        `You can top up ${formatAmount(Math.max(0, rates.zaadAgentDailyMaxCents - todayCents), "USD")} more today`,
        { reason: "daily_amount" }
      );
    }

    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc();
    await db.runTransaction(async (tx) => {
      const lock = (await tx.get(customerRef)).data() as ZaadAgentCustomerDoc | undefined;
      if (lock?.activeRequestId) {
        const open = (await tx.get(db.collection(ZAAD_AGENT_TOPUPS).doc(lock.activeRequestId))).data() as
          | ZaadAgentTopup
          | undefined;
        if (open && ACTIVE_STATUSES.includes(open.status)) {
          throw new https.HttpsError("already-exists", "You already have a Zaad top-up in progress", {
            reason: "in_progress",
            requestId: lock.activeRequestId,
          });
        }
      }
      const now = admin.firestore.Timestamp.fromMillis(nowMs);
      const record: ZaadAgentTopup = {
        customerId: uid,
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
      };
      tx.set(ref, record);
      tx.set(customerRef, { activeRequestId: ref.id }, { merge: true });
    });

    await offerNext(ref.id, nowMs);
    const status = ((await ref.get()).data() as ZaadAgentTopup).status;
    return { success: true, data: { requestId: ref.id, status } };
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
        if (agentRef && agent?.openRequestId === id) tx.update(agentRef, { openRequestId: null });
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
 * "I've sent it": the customer paid the agent's Zaad and gives the Zaad
 * transaction ID from their "you sent" text (D9). Each ID claims one request.
 */
export const customerMarkZaadSent = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ confirmBy: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const id = requestId(request.data);
    const txnId = normaliseTxnId(request.data?.zaadTxnId);
    if (!txnId) {
      throw new https.HttpsError("invalid-argument", "Enter the transaction ID from your Zaad text", {
        reason: "txn_id",
      });
    }
    const rates = await getRates();
    const db = admin.firestore();
    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
    const txnRef = db.collection(ZAAD_AGENT_TXN_IDS).doc(txnId);
    let req: ZaadAgentTopup | null = null;
    let confirmBy!: FirebaseFirestore.Timestamp;

    await db.runTransaction(async (tx) => {
      const [snap, txnSnap] = await Promise.all([tx.get(ref), tx.get(txnRef)]);
      const fresh = snap.data() as ZaadAgentTopup | undefined;
      if (!fresh || fresh.customerId !== uid) throw new https.HttpsError("not-found", "Top-up not found");
      if (fresh.status === "customer_sent" && fresh.customerZaadTxnId === txnId) {
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
      if (txnSnap.exists) {
        throw new https.HttpsError("already-exists", "That Zaad transaction ID has already been used", {
          reason: "txn_id_used",
        });
      }
      const now = admin.firestore.Timestamp.fromMillis(nowMs);
      confirmBy = admin.firestore.Timestamp.fromMillis(nowMs + rates.zaadAgentConfirmMinutes * 60_000);
      tx.set(txnRef, { requestId: id, customerId: uid, at: now });
      tx.update(ref, {
        status: "customer_sent",
        customerZaadTxnId: txnId,
        customerSentAt: now,
        confirmBy,
        deadlineAt: confirmBy,
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
