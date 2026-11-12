/**
 * Ending sessions when it matters (ONBOARDING_SECURITY_REVIEW.md A5).
 *
 * A Firebase session refreshes for ever unless its refresh tokens are
 * revoked. After a PIN reset or change, a device revoke, or a freeze, every
 * other phone signed in to the account has to sign in again; their current
 * ID token still works until it expires, within the hour.
 *
 * The phone that asked keeps going: it gets a custom token to sign straight
 * back in with. Minting one needs the Service Account Token Creator grant
 * (review B9); without it the caller is signed out within the hour too, which
 * is safe, just less smooth.
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getRates } from "../config/rates";

export async function endSessions(uid: string, opts: { keepCaller: boolean }): Promise<string | undefined> {
  try {
    await admin.auth().revokeRefreshTokens(uid);
    await admin
      .firestore()
      .collection("users")
      .doc(uid)
      .set({ sessionsRevokedAt: admin.firestore.Timestamp.now() }, { merge: true });
  } catch (err) {
    // The change that led here has happened; don't undo it over this.
    console.error(`Failed to revoke sessions for ${uid}:`, err);
    return undefined;
  }
  if (!opts.keepCaller) return undefined;
  try {
    return await admin.auth().createCustomToken(uid);
  } catch (err) {
    console.error("Could not mint a session token (Token Creator grant?):", err);
    return undefined;
  }
}

/**
 * Sign out after `sessionIdleDays` unused (review C10, O2: 30 days).
 *
 * "Used" means a correct PIN (lastActiveAt, set by verifyUserPin), which both
 * apps ask for when they open. Accounts idle past the limit have every
 * session ended once; signing back in needs an SMS code, or a trusted phone
 * and the PIN. The apps also sign themselves out at launch after the same
 * time, so nobody waits for this to run.
 */
export async function expireIdleSessionsNow(nowMs = Date.now()): Promise<number> {
  const { sessionIdleDays } = await getRates();
  const cutoff = admin.firestore.Timestamp.fromMillis(nowMs - sessionIdleDays * 24 * 60 * 60 * 1000);
  const idle = await admin.firestore().collection("users").where("lastActiveAt", "<", cutoff).limit(500).get();
  let ended = 0;
  for (const doc of idle.docs) {
    const { lastActiveAt, sessionsRevokedAt } = doc.data() as {
      lastActiveAt: admin.firestore.Timestamp;
      sessionsRevokedAt?: admin.firestore.Timestamp;
    };
    // Already ended since they were last active.
    if (sessionsRevokedAt && sessionsRevokedAt.toMillis() >= lastActiveAt.toMillis()) continue;
    await endSessions(doc.id, { keepCaller: false });
    ended += 1;
  }
  return ended;
}

export const expireIdleSessions = onSchedule(
  { schedule: "every day 03:00", timeZone: "Africa/Mogadishu" },
  async () => {
    const ended = await expireIdleSessionsNow();
    if (ended) console.log(`Ended sessions for ${ended} idle account(s)`);
  }
);
