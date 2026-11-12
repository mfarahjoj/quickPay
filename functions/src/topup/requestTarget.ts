/**
 * Naming the one request a customer's 6-digit code belongs to.
 *
 * A code on its own is not a name. Codes are random, so two customers waiting
 * at the same time can be shown the same six digits, and a lookup by code
 * alone then picks one of them arbitrarily. It also lets guesses be pooled
 * across every open request. So every agent call says which request it means:
 * the request id from the customer's QR, or the customer's phone number typed
 * with the code. Cash-out has worked this way since 2026-10-03
 * (CASH_IN_CASH_OUT.md); top-up confirmation uses the same helpers.
 */

import * as crypto from "crypto";

/** A Firestore auto-id or similar: never a path. */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value);
}

export function isSixDigitCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

/** "+252634…", "0634…", "634…", "00252…" → "+252634…". Other countries need their "+". */
export function normaliseCustomerPhone(raw: string): string | null {
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (!digits) return null;
  let e164: string;
  if (t.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith("252")) e164 = `+${digits}`;
  else e164 = `+252${digits.replace(/^0/, "")}`;
  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}

/** Constant-time comparison, so a near miss answers no faster than a wild guess. */
export function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * The pending request a call is about, in [collection] (`cashOutRequests` or
 * `agentTopupRequests`): by id, or the one pending request of the customer
 * with that phone number. Null when the call names nothing that exists.
 *
 * A customer has one pending request of each kind at a time (a new one
 * replaces the old), so the phone number names exactly one.
 */
export async function findPendingRequest(
  db: FirebaseFirestore.Firestore,
  collection: "cashOutRequests" | "agentTopupRequests",
  target: { requestId?: unknown; customerPhone?: unknown }
): Promise<FirebaseFirestore.DocumentReference | null> {
  if (isRequestId(target.requestId)) {
    return db.collection(collection).doc(target.requestId);
  }
  if (typeof target.customerPhone !== "string") return null;
  const phone = normaliseCustomerPhone(target.customerPhone);
  if (!phone) return null;
  const users = await db.collection("users").where("phoneNumber", "==", phone).limit(1).get();
  if (users.empty) return null;
  const pending = await db
    .collection(collection)
    .where("customerId", "==", users.docs[0].id)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  return pending.empty ? null : pending.docs[0].ref;
}
