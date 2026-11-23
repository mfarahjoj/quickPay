/**
 * Offering a request to agents, one agent at a time per request (D7).
 *
 * A request rings on one agent until they answer or the offer times out, so
 * no two agents can both accept it. An agent can have several remote
 * requests open at once, ringing or held (D32): up to
 * `zaadAgentMaxOpenRequests`, and only while their free float covers them.
 */

import * as admin from "firebase-admin";
import { getRates } from "../config/rates";
import { readFloatCents } from "../agents/float";
import { isAccountActive } from "../utils/accountStatus";
import { isAgentRole } from "../utils/roles";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import { MAX_MISSED_OFFERS, rankCandidates, isAvailable, Candidate, withOpen, withoutOpen } from "./core";
import { ZAAD_AGENTS, ZAAD_AGENT_TOPUPS, ZaadAgentDoc, ZaadAgentTopup, ZaadOffer } from "./types";

export type OfferOutcome = "offered" | "no_agent" | "skipped";

/**
 * Float the agent hasn't promised yet: their float (held top-ups have
 * already left it) less what is ringing on them now (D32).
 */
export async function freeFloatCents(agentId: string): Promise<number> {
  const ringing = await admin
    .firestore()
    .collection(ZAAD_AGENT_TOPUPS)
    .where("offeredTo", "==", agentId)
    .where("status", "==", "offered")
    .get();
  const promised = ringing.docs.reduce((sum, d) => sum + ((d.get("amount") as number) ?? 0), 0);
  return (await readFloatCents(agentId)) - promised;
}

/** Whether the person behind a zaad_agents doc may hand out this much float right now. */
async function canServe(agentId: string, amount: number): Promise<boolean> {
  const user = (await admin.firestore().collection("users").doc(agentId).get()).data();
  if (!user || !isAgentRole(user.accountType) || !isAccountActive(user) || user.agentFlag) return false;
  return (await freeFloatCents(agentId)) >= amount;
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
      maxOpen: rates.zaadAgentMaxOpenRequests,
    });

    for (const candidate of ranked) {
      if (!(await canServe(candidate.id, req.amount))) continue;
      const claimed = await claim(ref, candidate.id, rates.zaadAgentOfferSeconds, rates.zaadAgentMaxOpenRequests, nowMs);
      if (claimed === "claimed") {
        notifyUser(
          candidate.id,
          "zaad_agent_topup",
          {
            key: "zaadAgent.offer",
            params: { amount: pushAmount(req.amount, req.currency), seconds: String(rates.zaadAgentOfferSeconds) },
          },
          {
            type: "zaad_agent_offer",
            requestId,
            amount: String(req.amount),
            currency: req.currency,
            expiresAt: String(nowMs + rates.zaadAgentOfferSeconds * 1000),
          }
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
  maxOpen: number,
  nowMs: number
): Promise<"claimed" | "agent_taken" | "request_moved"> {
  const db = admin.firestore();
  const agentRef = db.collection(ZAAD_AGENTS).doc(agentId);
  return db.runTransaction(async (tx) => {
    const [reqSnap, agentSnap] = await Promise.all([tx.get(ref), tx.get(agentRef)]);
    const req = reqSnap.data() as ZaadAgentTopup | undefined;
    if (!req || req.status !== "offered" || req.offeredTo) return "request_moved";
    const agent = agentSnap.data() as ZaadAgentDoc | undefined;
    if (!agent || !isAvailable(agent, nowMs, maxOpen)) return "agent_taken";

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
    tx.update(agentRef, { ...withOpen(agent, ref.id), lastOfferedAt: now });
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
        ...(withoutOpen(agent, requestId) ?? {}),
        missedOffers: missed,
        ...(missed >= MAX_MISSED_OFFERS ? { online: false } : {}),
      });
    }
    return true;
  });
}
