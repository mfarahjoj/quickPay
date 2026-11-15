/**
 * Offering a request to agents, one at a time (D7).
 *
 * An agent who is offered a request is reserved for it (openRequestId) until
 * they answer or the offer times out, so nobody's phone rings for two
 * requests at once and no two agents can both accept one.
 */

import * as admin from "firebase-admin";
import { getRates } from "../config/rates";
import { readFloatCents } from "../agents/float";
import { isAccountActive } from "../utils/accountStatus";
import { isAgentRole } from "../utils/roles";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import { MAX_MISSED_OFFERS, rankCandidates, isAvailable, Candidate } from "./core";
import { ZAAD_AGENTS, ZAAD_AGENT_TOPUPS, ZaadAgentDoc, ZaadAgentTopup, ZaadOffer } from "./types";

export type OfferOutcome = "offered" | "no_agent" | "skipped";

/** Whether the person behind a zaad_agents doc may hand out float right now. */
async function canServe(agentId: string, amount: number): Promise<boolean> {
  const user = (await admin.firestore().collection("users").doc(agentId).get()).data();
  if (!user || !isAgentRole(user.accountType) || !isAccountActive(user) || user.agentFlag) return false;
  return (await readFloatCents(agentId)) >= amount;
}

/**
 * Offer [requestId] to the next agent, or tell the customer nobody is free.
 * Does nothing unless the request is waiting for an offer (status offered,
 * ringing on nobody), so a late duplicate call is harmless.
 */
export async function offerNext(requestId: string, nowMs = Date.now()): Promise<OfferOutcome> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) return "skipped";
  const req = snap.data() as ZaadAgentTopup;
  if (req.status !== "offered" || req.offeredTo) return "skipped";

  const rates = await getRates();
  if (req.offers.length < rates.zaadAgentOffersPerRequest) {
    const online = await db.collection(ZAAD_AGENTS).where("online", "==", true).limit(200).get();
    const candidates: Candidate[] = online.docs.map((d) => ({ id: d.id, doc: d.data() as ZaadAgentDoc }));
    const ranked = rankCandidates(candidates, {
      nowMs,
      customerId: req.customerId,
      alreadyOffered: new Set(req.offers.map((o) => o.agentId)),
    });

    for (const candidate of ranked) {
      if (!(await canServe(candidate.id, req.amount))) continue;
      const claimed = await claim(ref, candidate.id, rates.zaadAgentOfferSeconds, nowMs);
      if (claimed === "claimed") {
        notifyUser(
          candidate.id,
          "zaad_agent_topup",
          { key: "zaadAgent.offer", params: { amount: pushAmount(req.amount, req.currency) } },
          { type: "zaad_agent_offer", requestId, amount: String(req.amount), currency: req.currency }
        ).catch((err) => console.error("zaadAgent offer push failed:", err));
        return "offered";
      }
      if (claimed === "request_moved") return "skipped";
      // The agent was taken by another request in the meantime: try the next.
    }
  }

  const ended = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as ZaadAgentTopup | undefined;
    if (!fresh || fresh.status !== "offered" || fresh.offeredTo) return false;
    tx.update(ref, {
      status: "no_agent",
      deadlineAt: null,
      offerExpiresAt: null,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return true;
  });
  if (!ended) return "skipped";
  notifyUser(
    req.customerId,
    "zaad_agent_topup",
    { key: "zaadAgent.no_agent", params: { amount: pushAmount(req.amount, req.currency) } },
    { type: "zaad_agent_topup", requestId }
  ).catch((err) => console.error("zaadAgent notify failed:", err));
  return "no_agent";
}

/** Reserve [agentId] for the request and start their countdown. */
async function claim(
  ref: FirebaseFirestore.DocumentReference,
  agentId: string,
  offerSeconds: number,
  nowMs: number
): Promise<"claimed" | "agent_taken" | "request_moved"> {
  const db = admin.firestore();
  const agentRef = db.collection(ZAAD_AGENTS).doc(agentId);
  return db.runTransaction(async (tx) => {
    const [reqSnap, agentSnap] = await Promise.all([tx.get(ref), tx.get(agentRef)]);
    const req = reqSnap.data() as ZaadAgentTopup | undefined;
    if (!req || req.status !== "offered" || req.offeredTo) return "request_moved";
    const agent = agentSnap.data() as ZaadAgentDoc | undefined;
    if (!agent || !isAvailable(agent, nowMs)) return "agent_taken";

    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    const expiresAt = admin.firestore.Timestamp.fromMillis(nowMs + offerSeconds * 1000);
    const offer: ZaadOffer = { agentId, offeredAt: now, expiresAt };
    tx.update(ref, {
      offers: [...req.offers, offer],
      offeredTo: agentId,
      offerExpiresAt: expiresAt,
      deadlineAt: expiresAt,
      updatedAt: now,
    });
    tx.update(agentRef, { openRequestId: ref.id, lastOfferedAt: now });
    return "claimed";
  });
}

/**
 * The agent ringing on [requestId] declined, or let it time out: free them
 * and put the request back for the next agent. Two timeouts in a row take
 * the agent offline (D8). Resolves true if this call ended the offer.
 */
export async function endOffer(
  requestId: string,
  agentId: string,
  answer: "declined" | "timed_out",
  nowMs = Date.now()
): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(requestId);
  const agentRef = db.collection(ZAAD_AGENTS).doc(agentId);
  return db.runTransaction(async (tx) => {
    const [reqSnap, agentSnap] = await Promise.all([tx.get(ref), tx.get(agentRef)]);
    const req = reqSnap.data() as ZaadAgentTopup | undefined;
    if (!req || req.status !== "offered" || req.offeredTo !== agentId) return false;
    if (answer === "timed_out" && (req.offerExpiresAt?.toMillis() ?? 0) > nowMs) return false;

    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    const offers = req.offers.map((o, i) =>
      i === req.offers.length - 1 && o.agentId === agentId ? { ...o, answer, answeredAt: now } : o
    );
    tx.update(ref, {
      offers,
      offeredTo: null,
      offerExpiresAt: null,
      // Picked up by the sweep if the next offer can't be made straight away.
      deadlineAt: now,
      updatedAt: now,
    });
    const agent = agentSnap.data() as ZaadAgentDoc | undefined;
    if (agent) {
      const missed = answer === "timed_out" ? (agent.missedOffers ?? 0) + 1 : 0;
      tx.update(agentRef, {
        ...(agent.openRequestId === requestId ? { openRequestId: null } : {}),
        missedOffers: missed,
        ...(missed >= MAX_MISSED_OFFERS ? { online: false } : {}),
      });
    }
    return true;
  });
}
