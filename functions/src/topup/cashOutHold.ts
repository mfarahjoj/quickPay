/**
 * Returning a cash-out hold to the customer.
 *
 * A cash-out takes the customer's money into `platform:cashout_hold` the moment
 * they request it (customerCashOut), and an agent claims it from there
 * (agentConfirmCashOut). Every other ending returns it: the customer cancels,
 * a newer request replaces it, it expires unclaimed (expireAgentRequests), or
 * too many wrong codes lock it. All four go through here, so the money can
 * only ever come back once and always the same way.
 *
 * Ledger: `cashoutrelease_{cashOutId}` — platform:cashout_hold → user:{customer}.
 * The entry id is the idempotency key: whichever trigger fires first posts it,
 * and any later trigger finds the request no longer pending and does nothing.
 */

import * as admin from "firebase-admin";
import { CashOutRequest, CashOutReleaseReason } from "../types";
import { prepareJournalEntry, userAccount, CASHOUT_HOLD } from "../ledger";
import { notifyUser } from "../utils/notifications";

const RELEASE_COPY: Record<CashOutReleaseReason, string> = {
  cancelled: "Cash-out cancelled — money returned",
  replaced: "Cash-out replaced by a new request — money returned",
  expired: "Cash-out expired — money returned",
  too_many_attempts: "Cash-out locked after wrong codes — money returned",
};

export function releaseEntryIdFor(cashOutId: string): string {
  return `cashoutrelease_${cashOutId}`;
}

/**
 * Return a pending cash-out's held money to the customer.
 *
 * Resolves true if this call returned it, false if the request was no longer
 * pending (already completed, or already returned by another trigger).
 */
export async function releaseCashOutHold(
  cashOutId: string,
  reason: CashOutReleaseReason,
  postedBy: string
): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection("cashOutRequests").doc(cashOutId);
  let released: CashOutRequest | null = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const cashOut = snap.data() as CashOutRequest;
    if (cashOut.status !== "pending") return;

    const entryId = releaseEntryIdFor(cashOutId);
    const pending = await prepareJournalEntry(tx, {
      entryId,
      type: "adjustment",
      currency: cashOut.currency as "USD" | "SLS",
      lines: [
        { account: CASHOUT_HOLD, debit: cashOut.amount, credit: 0 },
        { account: userAccount(cashOut.customerId), debit: 0, credit: cashOut.amount },
      ],
      refs: { topupId: cashOutId, ...(cashOut.transactionId ? { transactionId: cashOut.transactionId } : {}) },
      description: RELEASE_COPY[reason],
      postedBy,
    });
    if (pending.alreadyPosted) return;
    pending.write(tx);

    const now = admin.firestore.Timestamp.now();
    tx.update(ref, {
      status: reason === "expired" ? "expired" : "cancelled",
      releaseReason: reason,
      releasedAt: now,
    });
    if (cashOut.transactionId) {
      tx.update(db.collection("transactions").doc(cashOut.transactionId), {
        status: "cancelled",
        description: RELEASE_COPY[reason],
        releaseEntryId: entryId,
        completedAt: now,
      });
    }
    released = cashOut;
  });

  const done = released as CashOutRequest | null;
  if (done && reason !== "replaced") {
    const amount = `${done.currency} ${(done.amount / 100).toFixed(2)}`;
    notifyUser(
      done.customerId,
      "cashout_returned",
      "Cash-out money returned",
      `${amount} is back in your wallet. ${RELEASE_COPY[reason].split(" — ")[0]}.`,
      { type: "cashout_returned", cashOutId, reason }
    ).catch((err) => console.error("Failed to notify customer:", err));
  }
  return done !== null;
}
