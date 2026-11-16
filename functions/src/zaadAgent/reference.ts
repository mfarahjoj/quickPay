/**
 * Zapp's own reference for a Zaad top-up through an agent (D31): made when the
 * request is, unique, and read by both sides, so the customer never has to
 * type Zaad's transaction ID.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { newTopupReference } from "./core";
import { ZAAD_AGENT_REFS } from "./types";

const TRIES = 8;

/**
 * Find an unused reference. Reads only, so call it before the transaction's
 * first write; then claim it with [claimTopupReference].
 */
export async function pickTopupReference(tx: FirebaseFirestore.Transaction): Promise<string> {
  const refs = admin.firestore().collection(ZAAD_AGENT_REFS);
  for (let i = 0; i < TRIES; i++) {
    const candidate = newTopupReference();
    if (!(await tx.get(refs.doc(candidate))).exists) return candidate;
  }
  throw new https.HttpsError("unavailable", "Could not make a top-up reference. Try again.");
}

/** create(): if another request took it meanwhile, the transaction fails and retries with a new pick. */
export function claimTopupReference(
  tx: FirebaseFirestore.Transaction,
  reference: string,
  requestId: string,
  customerId: string,
  at: FirebaseFirestore.Timestamp
): void {
  tx.create(admin.firestore().collection(ZAAD_AGENT_REFS).doc(reference), { requestId, customerId, at });
}
