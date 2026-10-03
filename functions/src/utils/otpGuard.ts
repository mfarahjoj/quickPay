import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";

// Same policy as the PIN lockout in auth/validatePin.ts: 5 straight bad
// guesses lock for 60s, doubling per additional failure, capped at 15 minutes.
// Guards agents brute-forcing 6-digit top-up/cash-out codes.
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const BASE_LOCK_SECONDS = 60;
const MAX_LOCK_SECONDS = 15 * 60;

/**
 * Count one code guess against the agent *before* the code is looked up,
 * throwing `resource-exhausted` while they are locked out.
 *
 * Reserving first, inside a transaction, is what makes the limit hold under
 * load: when the failure was recorded after the lookup, a burst of parallel
 * requests all read "not locked" and every one of them got a guess. Call
 * `clearOtpFailures` once a code matches, which gives the reservation back.
 */
export async function reserveOtpAttempt(agentId: string): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection("users").doc(agentId);
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() ?? {};
    const now = admin.firestore.Timestamp.now();
    const lockedUntil = data.agentOtpLockedUntil as admin.firestore.Timestamp | null | undefined;
    if (lockedUntil && lockedUntil.toMillis() > now.toMillis()) {
      const secondsLeft = Math.ceil((lockedUntil.toMillis() - now.toMillis()) / 1000);
      throw new https.HttpsError(
        "resource-exhausted",
        `Too many incorrect codes. Try again in ${secondsLeft} seconds.`,
        { secondsLeft }
      );
    }

    const attempts = (data.agentOtpFailedAttempts ?? 0) + 1;
    const updates: Record<string, unknown> = { agentOtpFailedAttempts: attempts };
    if (attempts >= MAX_ATTEMPTS_BEFORE_LOCK) {
      const lockSeconds = Math.min(
        BASE_LOCK_SECONDS * 2 ** (attempts - MAX_ATTEMPTS_BEFORE_LOCK),
        MAX_LOCK_SECONDS
      );
      updates.agentOtpLockedUntil = admin.firestore.Timestamp.fromMillis(
        now.toMillis() + lockSeconds * 1000
      );
    }
    tx.update(ref, updates);
  });
}

/** Reset the guess counter after a valid code is found. */
export async function clearOtpFailures(agentId: string): Promise<void> {
  await admin.firestore().collection("users").doc(agentId).update({
    agentOtpFailedAttempts: 0,
    agentOtpLockedUntil: null,
  });
}
