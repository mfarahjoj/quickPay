/**
 * Record lapsed API charges as expired.
 *
 * Not what stops a late payment — approveApiCharge checks `expiresAt` itself,
 * inside its transaction. This sweep exists so the stored status catches up
 * and the `charge.expired` webhook goes out to a merchant whose customer never
 * came back.
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { isLapsed } from "./charges";
import { API_CHARGES_COLLECTION, ApiCharge } from "./types";

const BATCH = 300;

export async function expireLapsedCharges(): Promise<number> {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const due = await db
    .collection(API_CHARGES_COLLECTION)
    .where("status", "==", "pending")
    .where("expiresAt", "<", now)
    .orderBy("expiresAt")
    .limit(BATCH)
    .get();

  let expired = 0;
  for (const doc of due.docs) {
    // Per charge, in a transaction: an approval may be committing right now,
    // and a paid charge must never be relabelled expired.
    const flipped = await db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      const charge = snap.data() as ApiCharge | undefined;
      if (!charge || !isLapsed(charge)) return false;
      tx.update(doc.ref, { status: "expired", expiredAt: admin.firestore.Timestamp.now() });
      return true;
    });
    if (flipped) expired++;
  }
  return expired;
}

export const expireApiCharges = onSchedule({ schedule: "every 5 minutes" }, async () => {
  const n = await expireLapsedCharges();
  if (n > 0) console.log(`Expired ${n} API charges`);
});
