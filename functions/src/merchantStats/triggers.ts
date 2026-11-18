/**
 * Keeping the merchant read model in step with the money flows without
 * touching them (as counterDisplay/triggers.ts does for the counter screen).
 *
 * A row counts once it is completed. Most flows write it completed; an agent
 * cash-out is written pending and completed when the agent pays, which is
 * why this listens to writes and acts on the change to completed.
 *
 * A failure here is logged, not retried: the nightly catch-up
 * (merchantStatsNightly) applies any completed row that has no marker.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { Transaction } from "../types";
import { applyStoreEvent } from "./apply";
import { classifyTransaction } from "./classify";

/** Pure: whether this write is the moment the row became completed. */
export function becameCompleted(
  before: Partial<Transaction> | undefined,
  after: Partial<Transaction> | undefined
): boolean {
  return after?.status === "completed" && before?.status !== "completed";
}

export const merchantStatsOnTransaction = onDocumentWritten("transactions/{transactionId}", async (event) => {
  const before = event.data?.before.data() as Transaction | undefined;
  const after = event.data?.after.data() as Transaction | undefined;
  if (!becameCompleted(before, after)) return;
  const storeEvent = classifyTransaction(event.params.transactionId, after);
  if (!storeEvent) return;
  try {
    await applyStoreEvent(storeEvent);
  } catch (err) {
    console.error(`merchantStats: failed to apply ${event.params.transactionId}; the nightly catch-up will:`, err);
  }
});
