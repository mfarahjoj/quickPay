/**
 * Rolling 24-hour totals for maker-checker thresholds.
 *
 * A threshold checked per request is easy to walk under: $2,000 of float
 * asked for as five $400 requests never needs a second admin. So the float
 * desk and payouts compare the threshold with everything still standing
 * for the same agent or merchant over the last day, this request included.
 */

import * as admin from "firebase-admin";

export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Start of the rolling window, for a `createdAt >=` query. */
export function rollingWindowStart(nowMs: number = Date.now()): FirebaseFirestore.Timestamp {
  return admin.firestore.Timestamp.fromMillis(nowMs - ROLLING_WINDOW_MS);
}

/**
 * Sum `amountCents` over the docs that still count: anything not rejected.
 * Pending and approved/paid both count, so splitting a request and getting
 * the first half approved doesn't reset the total.
 */
export function sumStandingCents(
  docs: Array<{ data(): FirebaseFirestore.DocumentData | undefined }>,
  include: (doc: FirebaseFirestore.DocumentData) => boolean = () => true
): number {
  let total = 0;
  for (const snap of docs) {
    const d = snap.data();
    if (!d || d.status === "rejected" || !include(d)) continue;
    if (typeof d.amountCents === "number") total += d.amountCents;
  }
  return total;
}
