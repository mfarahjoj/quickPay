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
