import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";

// Same policy as the PIN lockout in auth/validatePin.ts: 5 straight bad
// guesses lock for 60s, doubling per additional failure, capped at 15 minutes.
// Guards agents brute-forcing 6-digit top-up/cash-out codes.
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const BASE_LOCK_SECONDS = 60;
const MAX_LOCK_SECONDS = 15 * 60;

interface OtpGuardFields {
  agentOtpFailedAttempts?: number;
  agentOtpLockedUntil?: admin.firestore.Timestamp | null;
}

/**
 * Throw `resource-exhausted` while the agent is locked out from code guesses.
 * Call with the already-fetched user doc data before looking up a code.
 */
export function assertNotOtpLocked(agentData: OtpGuardFields): void {
  const lockedUntil = agentData.agentOtpLockedUntil;
  const now = admin.firestore.Timestamp.now();
  if (lockedUntil && lockedUntil.toMillis() > now.toMillis()) {
    const secondsLeft = Math.ceil(
      (lockedUntil.toMillis() - now.toMillis()) / 1000
    );
    throw new https.HttpsError(
      "resource-exhausted",
      `Too many incorrect codes. Try again in ${secondsLeft} seconds.`,
      { secondsLeft }
    );
  }
}

/** Record a failed code guess, locking the agent out past the threshold. */
export async function recordOtpFailure(
  agentId: string,
  agentData: OtpGuardFields
): Promise<void> {
  const failedAttempts = (agentData.agentOtpFailedAttempts ?? 0) + 1;
  const updates: Record<string, unknown> = {
    agentOtpFailedAttempts: admin.firestore.FieldValue.increment(1),
  };
  if (failedAttempts >= MAX_ATTEMPTS_BEFORE_LOCK) {
    const lockSeconds = Math.min(
      BASE_LOCK_SECONDS * 2 ** (failedAttempts - MAX_ATTEMPTS_BEFORE_LOCK),
      MAX_LOCK_SECONDS
    );
    updates.agentOtpLockedUntil = admin.firestore.Timestamp.fromMillis(
      admin.firestore.Timestamp.now().toMillis() + lockSeconds * 1000
    );
  }
  await admin.firestore().collection("users").doc(agentId).update(updates);
}

/** Reset the guess counter after a valid code is found. */
export async function clearOtpFailures(
  agentId: string,
  agentData: OtpGuardFields
): Promise<void> {
  if ((agentData.agentOtpFailedAttempts ?? 0) > 0 || agentData.agentOtpLockedUntil) {
    await admin.firestore().collection("users").doc(agentId).update({
      agentOtpFailedAttempts: 0,
      agentOtpLockedUntil: null,
    });
  }
}
