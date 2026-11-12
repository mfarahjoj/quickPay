/**
 * Client-supplied idempotency keys.
 *
 * Some money flows carry their own natural idempotency key — a QR code is
 * single-use, a payment request resolves once — so the journal entry ID can be
 * derived from the thing being consumed. A direct payment has no such anchor:
 * the customer scans a permanent sticker, types an amount and pays. If the
 * connection drops after the server commits, the customer sees a failure,
 * taps again, and pays twice. On Hargeisa mobile data that is not a rare case.
 *
 * The fix is for the client to mint a key once per payment attempt and resend
 * the same key on every retry, so the journal entry ID is stable and the
 * ledger's own idempotency (entry doc ID = key) collapses the retry.
 *
 * Keys are always scoped to the caller. An entry ID is a document ID in a
 * shared collection, so an unscoped key would let one customer name another
 * customer's entry — the replay branch would then hand them somebody else's
 * transaction. Scoping makes a collision across users impossible rather than
 * unlikely.
 */

import { https } from "firebase-functions/v2";

/**
 * Deliberately narrow: this ends up inside a Firestore document ID, and the
 * length floor keeps a client from sending a key with too little entropy to be
 * unique across its own payment attempts. A UUID v4 satisfies it.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Validate a client-supplied key, returning it unchanged.
 *
 * @throws HttpsError("invalid-argument") when the key is missing or malformed.
 */
export function requireIdempotencyKey(key: unknown): string {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    throw new https.HttpsError(
      "invalid-argument",
      "idempotencyKey must be 8-64 characters of A-Z, a-z, 0-9, hyphen or underscore"
    );
  }
  return key;
}

/** True when the key is well-formed; for callers that accept older clients. */
export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && KEY_PATTERN.test(key);
}

/**
 * Build a journal entry ID that is stable for a retry and unreachable by any
 * other caller: `{prefix}_{callerUid}_{key}`.
 */
export function scopedEntryId(
  prefix: string,
  callerUid: string,
  key: string
): string {
  return `${prefix}_${callerUid}_${key}`;
}
