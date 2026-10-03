import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { releaseCashOutHold } from "./cashOutHold";

const BATCH = 100;

/**
 * Every 5 minutes: end agent requests nobody claimed in time.
 *
 * Expired cash-outs return their held money to the customer (through the same
 * idempotent path as cancel). Before this existed, an unclaimed cash-out kept
 * the customer's money in platform:cashout_hold until someone happened to
 * touch the request again. Expired top-up requests move no money; they are
 * just closed so a stale code can't be confirmed later.
 */
export async function expireAgentRequestsNow(now = admin.firestore.Timestamp.now()) {
  const db = admin.firestore();

  const cashOuts = await db
    .collection("cashOutRequests")
    .where("status", "==", "pending")
    .where("expiresAt", "<=", now)
    .limit(BATCH)
    .get();
  let returned = 0;
  for (const doc of cashOuts.docs) {
    try {
      if (await releaseCashOutHold(doc.id, "expired", "system")) returned++;
    } catch (err) {
      // One bad request must not stop the rest; the next run retries it.
      console.error(`Could not expire cash-out ${doc.id}:`, err);
    }
  }

  const topups = await db
    .collection("agentTopupRequests")
    .where("status", "==", "pending")
    .where("expiresAt", "<=", now)
    .limit(BATCH)
    .get();
  if (!topups.empty) {
    const batch = db.batch();
    topups.docs.forEach((doc) => batch.update(doc.ref, { status: "expired" }));
    await batch.commit();
  }

  if (returned || !topups.empty) {
    console.log(`Expired ${returned} cash-out(s), money returned; closed ${topups.size} top-up request(s)`);
  }
  return { cashOutsReturned: returned, topupsExpired: topups.size };
}

export const expireAgentRequests = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Africa/Mogadishu" },
  async () => {
    await expireAgentRequestsNow();
  }
);
