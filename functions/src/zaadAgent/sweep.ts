/**
 * Every minute: run the clocks on Zaad top-ups through agents (D11).
 *
 * Each request keeps its next moment in `deadlineAt`, so one query finds
 * every request with something due:
 *
 *   offered, ringing       offer timed out → next agent
 *   offered, ringing none  next agent (a dispatch that didn't finish)
 *   accepted               customer didn't send in time → float back to the agent
 *   customer_sent          5 minutes left → remind the agent, once (D32)
 *                          agent didn't answer in time → disputed, float stays held
 *   declined               customer didn't dispute in time → float back to the agent
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { endOffer, offerNext } from "./dispatch";
import { releaseZaadHold } from "./settle";
import { notifyDisputed } from "./customer";
import { withoutOpen } from "./core";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
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
    // An agent who didn't answer a remote request gets no more offers until
    // they come back. In person there was no offer to miss (D26): leave them be.
    if (agent && req.meeting !== "in_person") {
      tx.update(agentRef, { online: false, ...(withoutOpen(agent, id) ?? {}) });
    }
    return req;
  });
}

/**
 * Mark the 5-minute reminder sent and move the request's next wake-up to
 * its deadline. Resolves the request if this call did it, so the push goes
 * out once however often the sweep runs (D32).
 */
async function markReminded(id: string, nowMs: number): Promise<ZaadAgentTopup | null> {
  const db = admin.firestore();
  const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
  return db.runTransaction(async (tx) => {
    const req = (await tx.get(ref)).data() as ZaadAgentTopup | undefined;
    if (!req || req.status !== "customer_sent" || req.reminderSentAt || !req.confirmBy || !req.agentId) return null;
    if (req.confirmBy.toMillis() <= nowMs) return null;
    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    tx.update(ref, { reminderSentAt: now, deadlineAt: req.confirmBy, updatedAt: now });
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
  const counts: Record<string, number> = { offers: 0, expired: 0, reminded: 0, disputed: 0, released: 0 };

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
          if ((req.confirmBy?.toMillis() ?? 0) > nowMs) {
            const reminded = await markReminded(doc.id, nowMs);
            if (reminded) {
              notifyUser(
                reminded.agentId!,
                "zaad_agent_topup",
                {
                  key: "zaadAgent.confirm_reminder",
                  params: { customer: reminded.customerFirstName, amount: pushAmount(reminded.amount, reminded.currency) },
                },
                { type: "zaad_agent_sent", requestId: doc.id }
              ).catch((err) => console.error("zaadAgent notify failed:", err));
              counts.reminded++;
            }
            break;
          }
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
