/**
 * Every minute: run the clocks on Zaad top-ups through agents (D11).
 *
 * Each request keeps its next moment in `deadlineAt`, so one query finds
 * every request with something due:
 *
 *   offered, ringing       offer timed out → next agent
 *   offered, ringing none  next agent (a dispatch that didn't finish)
 *   accepted               customer didn't send in time → float back to the agent
 *   customer_sent          agent didn't answer in time → disputed, float stays held
 *   declined               customer didn't dispute in time → float back to the agent
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { endOffer, offerNext } from "./dispatch";
import { releaseZaadHold } from "./settle";
import { notifyDisputed } from "./customer";
import { ZAAD_AGENTS, ZAAD_AGENT_TOPUPS, ZaadAgentDoc, ZaadAgentTopup } from "./types";

const BATCH = 200;

/** Turn an unanswered customer_sent request into a dispute. */
async function disputeForTimeout(id: string, nowMs: number): Promise<ZaadAgentTopup | null> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
  return db.runTransaction(async (tx) => {
    const req = (await tx.get(ref)).data() as ZaadAgentTopup | undefined;
    if (!req || req.status !== "customer_sent" || (req.confirmBy?.toMillis() ?? 0) > nowMs || !req.agentId) return null;
    const agentRef = db.collection(ZAAD_AGENTS).doc(req.agentId);
    const agent = (await tx.get(agentRef)).data() as ZaadAgentDoc | undefined;
    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    tx.update(ref, { status: "disputed", disputedAt: now, disputedBy: "timeout", deadlineAt: null, updatedAt: now });
    // An agent who didn't answer gets no more offers until they come back.
    if (agent) tx.update(agentRef, { online: false, ...(agent.openRequestId === id ? { openRequestId: null } : {}) });
    return req;
  });
}

export async function runZaadAgentSweep(nowMs = Date.now()): Promise<Record<string, number>> {
  const db = admin.firestore();
  const due = await db
    .collection(ZAAD_AGENT_TOPUPS)
    .where("deadlineAt", "<=", admin.firestore.Timestamp.fromMillis(nowMs))
    .limit(BATCH)
    .get();
  const counts: Record<string, number> = { offers: 0, expired: 0, disputed: 0, released: 0 };

  for (const doc of due.docs) {
    const req = doc.data() as ZaadAgentTopup;
    try {
      switch (req.status) {
        case "offered":
          if (req.offeredTo) {
            if ((req.offerExpiresAt?.toMillis() ?? 0) > nowMs) break;
            if (!(await endOffer(doc.id, req.offeredTo, "timed_out", nowMs))) break;
          }
          await offerNext(doc.id, nowMs);
          counts.offers++;
          break;
        case "accepted":
          if ((req.sendBy?.toMillis() ?? 0) <= nowMs && (await releaseZaadHold(doc.id, "expired", "system", ["accepted"]))) {
            counts.expired++;
          }
          break;
        case "customer_sent": {
          const disputed = await disputeForTimeout(doc.id, nowMs);
          if (disputed) {
            notifyDisputed(doc.id, disputed);
            counts.disputed++;
          }
          break;
        }
        case "declined":
          if (
            (req.disputeUntil?.toMillis() ?? 0) <= nowMs &&
            (await releaseZaadHold(doc.id, "declined", "system", ["declined"]))
          ) {
            counts.released++;
          }
          break;
        default:
          // Nothing timed in this status: stop matching the query.
          await doc.ref.update({ deadlineAt: null });
      }
    } catch (err) {
      // One bad request must not stop the rest; the next run retries it.
      console.error(`zaadAgent sweep: ${doc.id} failed`, err);
    }
  }
  return counts;
}

export const zaadAgentTopupSweep = onSchedule({ schedule: "every 1 minutes", timeZone: "Africa/Mogadishu" }, async () => {
  const counts = await runZaadAgentSweep();
  if (Object.values(counts).some((n) => n > 0)) console.log("zaadAgent sweep", counts);
});
