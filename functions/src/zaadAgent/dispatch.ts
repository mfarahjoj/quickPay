/**
 * Offering a request to agents, like a job.
 *
 * A request rings on several online agents at once, each with the same
 * deadline (`zaadAgentOfferSeconds`, 60 by default). The first to accept wins:
 * accepting holds their float in one transaction (agent.ts), and that
 * transaction only goes through while the request is still `offered`, so no
 * two agents can both win. If nobody accepts in time, or every agent
 * declines, the request becomes `no_agent` and the customer is asked whether
 * to send the money to Zapp's own Zaad number instead.
 *
 * An agent can have several remote requests open at once, ringing or held
 * (D32): up to `zaadAgentMaxOpenRequests`, and only while their free float
 * covers them.
 */

import * as admin from "firebase-admin";
import { computeCommission, getRates } from "../config/rates";
import { readFloatCents } from "../agents/float";
import { isAccountActive } from "../utils/accountStatus";
import { isAgentRole } from "../utils/roles";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import { MAX_MISSED_OFFERS, rankCandidates, isAvailable, ringingIds, Candidate, withOpen, withoutOpen } from "./core";
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
    .where("offeredToIds", "array-contains", agentId)
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

/** Mark [agentId]'s unanswered offer on a request with [answer]. */
function answered(offers: ZaadOffer[], agentId: string, answer: NonNullable<ZaadOffer["answer"]>, now: admin.firestore.Timestamp): ZaadOffer[] {
  let at = -1;
  offers.forEach((o, i) => {
    if (o.agentId === agentId && !o.answer) at = i;
  });
  return offers.map((o, i) => (i === at ? { ...o, answer, answeredAt: now } : o));
}

/**
 * Offer [requestId] to the best available agents, all at once, with one
 * shared deadline. If nobody can take it right now the customer is told
 * straight away. Does nothing unless the request is waiting for its first
 * ring (status offered, ringing on nobody), so a late duplicate call is
 * harmless.
 */
export async function ringAgents(requestId: string, nowMs = Date.now()): Promise<OfferOutcome> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) return "skipped";
  const req = snap.data() as ZaadAgentTopup;
  if (req.status !== "offered" || ringingIds(req).length > 0) return "skipped";

  const rates = await getRates();
  const online = await db.collection(ZAAD_AGENTS).where("online", "==", true).limit(200).get();
  const candidates: Candidate[] = online.docs.map((d) => ({ id: d.id, doc: d.data() as ZaadAgentDoc }));
  const ranked = rankCandidates(candidates, {
    nowMs,
    customerId: req.customerId,
    alreadyOffered: new Set(req.offers.map((o) => o.agentId)),
    maxOpen: rates.zaadAgentMaxOpenRequests,
  });

  const picked: string[] = [];
  for (const candidate of ranked) {
    if (picked.length >= rates.zaadAgentOffersPerRequest) break;
    if (await canServe(candidate.id, req.amount)) picked.push(candidate.id);
  }

  const rung = picked.length > 0 ? await claimRing(ref, picked, rates.zaadAgentOfferSeconds, rates.zaadAgentMaxOpenRequests, nowMs) : [];
  if (rung.length === 0) {
    const ended = await endRing(requestId, nowMs);
    return ended ? "no_agent" : "skipped";
  }

  const earn = req.agentCommissionCents ?? computeCommission(req.amount, rates.zaadAgentTopupCommissionRate);
  const expiresAt = nowMs + rates.zaadAgentOfferSeconds * 1000;
  for (const agentId of rung) {
    notifyUser(
      agentId,
      "zaad_agent_topup",
      {
        key: "zaadAgent.offer",
        params: {
          amount: pushAmount(req.amount, req.currency),
          earn: pushAmount(earn, req.currency),
          seconds: String(rates.zaadAgentOfferSeconds),
        },
      },
      {
        type: "zaad_agent_offer",
        requestId,
        amount: String(req.amount),
        currency: req.currency,
        expiresAt: String(expiresAt),
      }
    ).catch((err) => console.error("zaadAgent offer push failed:", err));
  }
  return "offered";
}

/**
 * Reserve [agentIds] for the request in one transaction and start the shared
 * countdown. Returns the agents that were actually free (an agent can be
 * taken by another request between the check and here).
 */
async function claimRing(
  ref: FirebaseFirestore.DocumentReference,
  agentIds: string[],
  offerSeconds: number,
  maxOpen: number,
  nowMs: number
): Promise<string[]> {
  const db = admin.firestore();
  const agentRefs = agentIds.map((id) => db.collection(ZAAD_AGENTS).doc(id));
  return db.runTransaction(async (tx) => {
    const [reqSnap, ...agentSnaps] = await Promise.all([tx.get(ref), ...agentRefs.map((r) => tx.get(r))]);
    const req = reqSnap.data() as ZaadAgentTopup | undefined;
    if (!req || req.status !== "offered" || ringingIds(req).length > 0) return [];

    const free: { id: string; doc: ZaadAgentDoc; ref: FirebaseFirestore.DocumentReference }[] = [];
    agentSnaps.forEach((s, i) => {
      const doc = s.data() as ZaadAgentDoc | undefined;
      if (doc && isAvailable(doc, nowMs, maxOpen)) free.push({ id: agentIds[i], doc, ref: agentRefs[i] });
    });
    if (free.length === 0) return [];

    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    const expiresAt = admin.firestore.Timestamp.fromMillis(nowMs + offerSeconds * 1000);
    const offers: ZaadOffer[] = free.map((a) => ({ agentId: a.id, offeredAt: now, expiresAt }));
    tx.update(ref, {
      offers: [...req.offers, ...offers],
      offeredToIds: free.map((a) => a.id),
      offeredTo: free[0].id,
      offerExpiresAt: expiresAt,
      deadlineAt: expiresAt,
      updatedAt: now,
    });
    for (const a of free) tx.update(a.ref, { ...withOpen(a.doc, ref.id), lastOfferedAt: now });
    return free.map((a) => a.id);
  });
}

/** Tell the customer nobody picked it up, and what to do next (the app asks). */
function notifyNoAgent(requestId: string, req: ZaadAgentTopup): void {
  notifyUser(
    req.customerId,
    "zaad_agent_topup",
    { key: "zaadAgent.no_agent", params: { amount: pushAmount(req.amount, req.currency) } },
    { type: "zaad_agent_topup", requestId }
  ).catch((err) => console.error("zaadAgent notify failed:", err));
}

/**
 * The ring is over with no accept: free every agent it was ringing on, count
 * the ones who let it time out (two in a row take an agent offline, D8), and
 * turn the request into `no_agent`. Also used when nobody could be rung at
 * all. Does nothing while an agent still has time to answer, or if the
 * request has moved on. Resolves true if this call ended it.
 */
export async function endRing(requestId: string, nowMs = Date.now()): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(requestId);
  let ended: ZaadAgentTopup | null = null;
  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(ref);
    const req = reqSnap.data() as ZaadAgentTopup | undefined;
    if (!req || req.status !== "offered") return;
    const ringing = ringingIds(req);
    if (ringing.length > 0 && (req.offerExpiresAt?.toMillis() ?? 0) > nowMs) return;

    const agentRefs = ringing.map((id) => db.collection(ZAAD_AGENTS).doc(id));
    const agentSnaps = await Promise.all(agentRefs.map((r) => tx.get(r)));
    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    let offers = req.offers;
    ringing.forEach((id, i) => {
      offers = answered(offers, id, "timed_out", now);
      const agent = agentSnaps[i].data() as ZaadAgentDoc | undefined;
      if (!agent) return;
      const missed = (agent.missedOffers ?? 0) + 1;
      tx.update(agentRefs[i], {
        ...(withoutOpen(agent, requestId) ?? {}),
        missedOffers: missed,
        ...(missed >= MAX_MISSED_OFFERS ? { online: false } : {}),
      });
    });
    tx.update(ref, {
      status: "no_agent",
      offers,
      offeredToIds: [],
      offeredTo: null,
      offerExpiresAt: null,
      deadlineAt: null,
      updatedAt: now,
    });
    ended = req;
  });
  if (!ended) return false;
  notifyNoAgent(requestId, ended);
  return true;
}

/**
 * [agentId] declined (or couldn't take it): they stop ringing on it and are
 * freed. When the last one has left, the customer is told straight away
 * instead of waiting out the clock. Resolves "left" (others still ringing),
 * "ended" (that was the last one), or false if they weren't ringing on it.
 */
export async function leaveRing(
  requestId: string,
  agentId: string,
  nowMs = Date.now()
): Promise<"left" | "ended" | false> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(requestId);
  const agentRef = db.collection(ZAAD_AGENTS).doc(agentId);
  let ended: ZaadAgentTopup | null = null;
  const result = await db.runTransaction(async (tx) => {
    const [reqSnap, agentSnap] = await Promise.all([tx.get(ref), tx.get(agentRef)]);
    const req = reqSnap.data() as ZaadAgentTopup | undefined;
    if (!req || req.status !== "offered" || !ringingIds(req).includes(agentId)) return false as const;

    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    const rest = ringingIds(req).filter((id) => id !== agentId);
    tx.update(ref, {
      offers: answered(req.offers, agentId, "declined", now),
      offeredToIds: rest,
      offeredTo: rest[0] ?? null,
      ...(rest.length === 0 ? { status: "no_agent", offerExpiresAt: null, deadlineAt: null } : {}),
      updatedAt: now,
    });
    const agent = agentSnap.data() as ZaadAgentDoc | undefined;
    if (agent) tx.update(agentRef, { ...(withoutOpen(agent, requestId) ?? {}), missedOffers: 0 });
    if (rest.length === 0) {
      ended = req;
      return "ended" as const;
    }
    return "left" as const;
  });
  if (ended) notifyNoAgent(requestId, ended);
  return result;
}
