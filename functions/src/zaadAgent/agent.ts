/**
 * The agent's side of a Zaad top-up: go online, answer offers, confirm
 * payments, report reversals.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { isAgentRole } from "../utils/roles";
import { verifyUserPin } from "../auth/validatePin";
import { getRates } from "../config/rates";
import { readFloatCents } from "../agents/float";
import { prepareJournalEntry } from "../ledger";
import { notifyUser } from "../utils/notifications";
import { formatAmount, pushAmount } from "../utils/money";
import { dialCode } from "../mobileMoney/linking";
import { LINKED_NUMBERS } from "../mobileMoney/receipts";
import { ApiResponse, User } from "../types";
import { displayMsisdn, holdEntry, holdEntryId, maskMsisdn, normaliseTxnId, openIds, withoutOpen } from "./core";
import { endOffer, offerNext } from "./dispatch";
import { creditZaadTopup } from "./settle";
import {
  AgentAnswer,
  ZAAD_AGENTS,
  ZAAD_AGENT_TOPUPS,
  ZaadAgentDoc,
  ZaadAgentTopup,
  ZaadTopupStatus,
} from "./types";

/** The caller, if they are an active agent. */
async function requireAgent(request: https.CallableRequest): Promise<{ uid: string; user: User }> {
  requireAuth(request);
  const uid = request.auth!.uid;
  const user = (await admin.firestore().collection("users").doc(uid).get()).data() as User | undefined;
  if (!user || !isAgentRole(user.accountType)) {
    throw new https.HttpsError("permission-denied", "Only agents can take Zaad top-ups");
  }
  assertAccountActive(user);
  return { uid, user };
}

function requestIdOf(data: unknown): string {
  const id = (data as { requestId?: unknown } | undefined)?.requestId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new https.HttpsError("invalid-argument", "requestId required");
  }
  return id;
}

function agentName(user: User): string {
  const info = (user as unknown as { agentInfo?: { businessName?: string } }).agentInfo;
  return info?.businessName || user.fullName || "Zapp Pay agent";
}

export interface ZaadAgentStatus {
  /** Ops switched this agent on and checked their number (D1, D4). */
  enabled: boolean;
  online: boolean;
  receiveNumber: string | null;
  pausedUntil: string | null;
  openRequestId: string | null;
  /** Remote requests open on the agent now, and the most allowed (D32). */
  openCount: number;
  maxOpen: number;
  floatCents: number;
  floatLowCents: number;
  /** Whether Zaad top-ups through agents are switched on at all. */
  open: boolean;
}

/**
 * The agent's Zaad top-up status, and their heartbeat: an online agent's app
 * calls this every minute. An agent who stops calling drops out of offers.
 */
export const agentGetZaadStatus = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<ZaadAgentStatus>> => {
    const { uid } = await requireAgent(request);
    const rates = await getRates();
    const ref = admin.firestore().collection(ZAAD_AGENTS).doc(uid);
    const doc = (await ref.get()).data() as ZaadAgentDoc | undefined;
    if (doc?.online) await ref.update({ lastSeenAt: admin.firestore.Timestamp.now() });
    return {
      success: true,
      data: {
        enabled: !!doc?.enabled && !!doc.receiveMsisdn,
        online: !!doc?.online,
        receiveNumber: doc?.receiveMsisdn ? displayMsisdn(doc.receiveMsisdn) : null,
        pausedUntil:
          doc?.pausedUntil && doc.pausedUntil.toMillis() > Date.now() ? doc.pausedUntil.toDate().toISOString() : null,
        openRequestId: doc?.openRequestId ?? null,
        openCount: openIds(doc).length,
        maxOpen: rates.zaadAgentMaxOpenRequests,
        floatCents: await readFloatCents(uid),
        floatLowCents: rates.zaadAgentFloatLowCents,
        open: rates.zaadAgentTopups === "on",
      },
    };
  }
);

/** Go online for Zaad top-up offers, or offline. In: `{ online }`. */
export const agentSetZaadOnline = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ online: boolean }>> => {
    const { uid } = await requireAgent(request);
    const online = request.data?.online === true;
    const ref = admin.firestore().collection(ZAAD_AGENTS).doc(uid);
    const doc = (await ref.get()).data() as ZaadAgentDoc | undefined;
    if (online) {
      const rates = await getRates();
      if (rates.zaadAgentTopups !== "on") {
        throw new https.HttpsError("unavailable", "Zaad top-ups through agents aren't open yet", { reason: "off" });
      }
      if (!doc?.enabled || !doc.receiveMsisdn) {
        throw new https.HttpsError(
          "failed-precondition",
          "Zapp Pay needs to check your Zaad number in person before you can take Zaad top-ups",
          { reason: "not_set_up" }
        );
      }
      if (doc.pausedUntil && doc.pausedUntil.toMillis() > Date.now()) {
        throw new https.HttpsError(
          "failed-precondition",
          `Your Zaad number changed recently. You can go online after ${doc.pausedUntil.toDate().toISOString()}.`,
          { reason: "paused", pausedUntil: doc.pausedUntil.toDate().toISOString() }
        );
      }
    }
    if (!doc) return { success: true, data: { online: false } };
    await ref.update({ online, lastSeenAt: admin.firestore.Timestamp.now(), missedOffers: 0 });
    return { success: true, data: { online } };
  }
);

export interface AcceptedTopup {
  requestId: string;
  /** Zapp's reference the customer will quote (D31). */
  reference: string | null;
  amount: number;
  customerFirstName: string;
  /** Masked, for checking against the sender in the agent's Zaad text (D5). */
  allowedSenders: string[];
  sendBy: string;
}

/**
 * Answer an offer. In: `{ requestId, accept }`. Accepting holds the amount
 * from the agent's float (D3); declining passes it to the next agent.
 */
export const agentAnswerZaadOffer = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<AcceptedTopup | { declined: true }>> => {
    const { uid, user } = await requireAgent(request);
    const id = requestIdOf(request.data);
    const db = admin.firestore();

    if (request.data?.accept !== true) {
      if (await endOffer(id, uid, "declined")) await offerNext(id);
      return { success: true, data: { declined: true } };
    }

    const rates = await getRates();
    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
    const peek = (await ref.get()).data() as ZaadAgentTopup | undefined;
    if (!peek || peek.offeredTo !== uid || peek.status !== "offered") {
      throw new https.HttpsError("failed-precondition", "This offer has ended", { reason: "offer_ended" });
    }
    // The numbers the customer may pay from (D5): their account's phone, and
    // a Zaad number they proved is theirs with the activation payment.
    const customer = (await db.collection("users").doc(peek.customerId).get()).data() as User | undefined;
    const linked = await db
      .collection(LINKED_NUMBERS)
      .where("uid", "==", peek.customerId)
      .where("provider", "==", "zaad")
      .where("status", "==", "verified")
      .limit(1)
      .get();
    const allowedSenders = [
      ...new Set([customer?.phoneNumber, ...linked.docs.map((d) => d.get("msisdn") as string)].filter(Boolean)),
    ] as string[];

    const nowMs = Date.now();
    let insufficient = false;
    let accepted: AcceptedTopup | null = null;
    let receive = "";
    await db.runTransaction(async (tx) => {
      const agentRef = db.collection(ZAAD_AGENTS).doc(uid);
      const [snap, agentSnap] = await Promise.all([tx.get(ref), tx.get(agentRef)]);
      const req = snap.data() as ZaadAgentTopup | undefined;
      if (!req || req.status !== "offered" || req.offeredTo !== uid || (req.offerExpiresAt?.toMillis() ?? 0) < nowMs) {
        throw new https.HttpsError("failed-precondition", "This offer has ended", { reason: "offer_ended" });
      }
      const agent = agentSnap.data() as ZaadAgentDoc | undefined;
      if (!agent?.enabled || !agent.receiveMsisdn) {
        throw new https.HttpsError("failed-precondition", "Your Zaad number isn't set up", { reason: "not_set_up" });
      }
      if ((await readFloatCents(uid, tx)) < req.amount) {
        insufficient = true;
        return;
      }
      const prepared = await prepareJournalEntry(tx, holdEntry(id, uid, req.amount));
      prepared.write(tx);

      const now = admin.firestore.Timestamp.fromMillis(nowMs);
      const sendBy = admin.firestore.Timestamp.fromMillis(nowMs + rates.zaadAgentSendMinutes * 60_000);
      receive = agent.receiveMsisdn;
      tx.update(ref, {
        status: "accepted",
        offers: req.offers.map((o, i) =>
          i === req.offers.length - 1 ? { ...o, answer: "accepted", answeredAt: now } : o
        ),
        offeredTo: null,
        offerExpiresAt: null,
        agentId: uid,
        agentName: agentName(user),
        agentReceiveMsisdn: agent.receiveMsisdn,
        dialCode: dialCode("zaad", agent.receiveMsisdn, req.amount, "USD"),
        allowedSenders,
        acceptedAt: now,
        sendBy,
        deadlineAt: sendBy,
        holdEntryId: holdEntryId(id),
        updatedAt: now,
      });
      tx.update(agentRef, { missedOffers: 0 });
      accepted = {
        requestId: id,
        reference: req.reference ?? null,
        amount: req.amount,
        customerFirstName: req.customerFirstName,
        allowedSenders: allowedSenders.map(maskMsisdn),
        sendBy: sendBy.toDate().toISOString(),
      };
    });

    if (insufficient) {
      if (await endOffer(id, uid, "declined")) await offerNext(id);
      const float = await readFloatCents(uid);
      throw new https.HttpsError(
        "failed-precondition",
        `Your float is ${formatAmount(float, "USD")}, less than this top-up. Refill at Zapp Pay to take it.`,
        { reason: "insufficient_float", floatCents: float }
      );
    }
    const done = accepted as AcceptedTopup | null;
    if (!done) throw new https.HttpsError("internal", "Could not accept");
    notifyUser(
      peek.customerId,
      "zaad_agent_topup",
      {
        key: "zaadAgent.accepted",
        params: {
          agent: agentName(user),
          amount: pushAmount(done.amount, "USD"),
          number: displayMsisdn(receive),
          minutes: String(rates.zaadAgentSendMinutes),
        },
      },
      { type: "zaad_agent_accepted", requestId: id }
    ).catch((err) => console.error("zaadAgent notify failed:", err));
    return { success: true, data: done };
  }
);

const ANSWERS: readonly AgentAnswer[] = ["received", "not_received", "different_amount"];

/**
 * The agent checked their own Zaad (D10). In: `{ requestId, answer,
 * expectedAmount, agentPin, zaadTxnId? }`. "received" needs the PIN or Face ID
 * and pays the held float to the customer; `zaadTxnId`, from the agent's
 * "you received" text, is optional and claims that Zaad payment for this
 * top-up only (D31); the other two decline, and the customer
 * has `zaadAgentDisputeMinutes` to dispute while the float stays held.
 */
export const agentConfirmZaadTopup = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ status: ZaadTopupStatus; commissionCents?: number }>> => {
    const { uid, user } = await requireAgent(request);
    const id = requestIdOf(request.data);
    const answer = request.data?.answer as AgentAnswer;
    if (!ANSWERS.includes(answer)) throw new https.HttpsError("invalid-argument", "Say whether you received it");
    const db = admin.firestore();
    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
    const req = (await ref.get()).data() as ZaadAgentTopup | undefined;
    if (!req || req.agentId !== uid) throw new https.HttpsError("not-found", "Top-up not found");
    if (request.data?.expectedAmount !== req.amount) {
      throw new https.HttpsError("failed-precondition", "The amount on your screen is out of date. Open the top-up again.", {
        reason: "amount_mismatch",
      });
    }

    if (answer === "received") {
      const typed = request.data?.zaadTxnId;
      const given = typed !== undefined && typed !== null && typed !== "";
      const zaadTxnId = given ? normaliseTxnId(typed) : null;
      if (given && !zaadTxnId) {
        throw new https.HttpsError("invalid-argument", "That doesn't look like a Zaad transaction ID", {
          reason: "txn_id",
        });
      }
      const pin = request.data?.agentPin;
      if (typeof pin !== "string" || !pin) throw new https.HttpsError("invalid-argument", "Agent PIN is required");
      if (!(await verifyUserPin(uid, pin))) throw new https.HttpsError("permission-denied", "Wrong PIN");
      // Allowed before the customer taps "I've sent it": the agent may see
      // the money first.
      const res = await creditZaadTopup(id, { uid, kind: "agent", zaadTxnId }, ["accepted", "customer_sent"]);
      return { success: true, data: { status: "completed", commissionCents: res.commissionCents } };
    }

    const rates = await getRates();
    const nowMs = Date.now();
    await db.runTransaction(async (tx) => {
      const agentRef = db.collection(ZAAD_AGENTS).doc(uid);
      const [snap, agentSnap] = await Promise.all([tx.get(ref), tx.get(agentRef)]);
      const fresh = snap.data() as ZaadAgentTopup;
      if (fresh.status !== "customer_sent") {
        throw new https.HttpsError(
          "failed-precondition",
          fresh.status === "accepted"
            ? "Wait until the customer says they've sent it"
            : "This top-up can't be answered now",
          { reason: "wrong_status", status: fresh.status }
        );
      }
      const now = admin.firestore.Timestamp.fromMillis(nowMs);
      const disputeUntil = admin.firestore.Timestamp.fromMillis(nowMs + rates.zaadAgentDisputeMinutes * 60_000);
      tx.update(ref, {
        status: "declined",
        agentAnswer: answer,
        agentAnsweredAt: now,
        disputeUntil,
        deadlineAt: disputeUntil,
        updatedAt: now,
      });
      const freed = withoutOpen(agentSnap.data() as ZaadAgentDoc | undefined, id);
      if (freed) tx.update(agentRef, freed);
    });
    notifyUser(
      req.customerId,
      "zaad_agent_topup",
      {
        key: "zaadAgent.declined",
        params: {
          agent: agentName(user),
          amount: pushAmount(req.amount, req.currency),
          minutes: String(rates.zaadAgentDisputeMinutes),
        },
      },
      { type: "zaad_agent_declined", requestId: id, answer }
    ).catch((err) => console.error("zaadAgent notify failed:", err));
    return { success: true, data: { status: "declined" } };
  }
);

/**
 * Telesom reversed a payment the agent confirmed (D16). In: `{ requestId,
 * note, agentZaadTxnId? }`. Nothing moves until ops confirm it.
 */
export const agentReportZaadReversal = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ reported: true }>> => {
    const { uid } = await requireAgent(request);
    const id = requestIdOf(request.data);
    const note = typeof request.data?.note === "string" ? request.data.note.trim() : "";
    if (note.length < 3) throw new https.HttpsError("invalid-argument", "Say what happened");
    const txn = request.data?.agentZaadTxnId ? normaliseTxnId(request.data.agentZaadTxnId) : null;
    const db = admin.firestore();
    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
    await db.runTransaction(async (tx) => {
      const req = (await tx.get(ref)).data() as ZaadAgentTopup | undefined;
      if (!req || req.agentId !== uid) throw new https.HttpsError("not-found", "Top-up not found");
      if (req.status !== "completed") {
        throw new https.HttpsError("failed-precondition", "Only a credited top-up can be reversed");
      }
      if (req.reversal) throw new https.HttpsError("already-exists", "This reversal is already reported");
      const now = admin.firestore.Timestamp.now();
      tx.update(ref, {
        reversal: { status: "reported", reportedAt: now, note: note.slice(0, 500), ...(txn ? { agentZaadTxnId: txn } : {}) },
        updatedAt: now,
      });
    });
    return { success: true, data: { reported: true } };
  }
);
