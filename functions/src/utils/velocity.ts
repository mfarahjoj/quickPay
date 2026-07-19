import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_LIMITS = {
  maxPerHour: 20,
  maxPerDay: 50,
};

/**
 * Check that a user hasn't exceeded transaction velocity limits.
 * Throws HttpsError("resource-exhausted") if exceeded.
 */
export async function enforceVelocity(
  userId: string,
  opts?: { maxPerHour?: number; maxPerDay?: number }
): Promise<void> {
  const limits = { ...DEFAULT_LIMITS, ...opts };
  const db = admin.firestore();
  const now = Date.now();

  const hourAgo = admin.firestore.Timestamp.fromMillis(now - HOUR_MS);
  const dayAgo = admin.firestore.Timestamp.fromMillis(now - DAY_MS);

  const [hourSnap, daySnap] = await Promise.all([
    db
      .collection("transactions")
      .where("fromUserId", "==", userId)
      .where("createdAt", ">=", hourAgo)
      .count()
      .get(),
    db
      .collection("transactions")
      .where("fromUserId", "==", userId)
      .where("createdAt", ">=", dayAgo)
      .count()
      .get(),
  ]);

  const hourCount = hourSnap.data().count;
  const dayCount = daySnap.data().count;

  if (hourCount >= limits.maxPerHour) {
    throw new https.HttpsError(
      "resource-exhausted",
      `Too many transactions. Limit: ${limits.maxPerHour} per hour.`
    );
  }

  if (dayCount >= limits.maxPerDay) {
    throw new https.HttpsError(
      "resource-exhausted",
      `Too many transactions. Limit: ${limits.maxPerDay} per day.`
    );
  }
}
