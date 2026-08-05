/**
 * Account status — whether an account may move money at all.
 *
 * Enforcement is deliberately two-layered:
 *
 *  1. **Callables** call `requireActiveAccount` / `assertAccountActive` early,
 *     so a frozen user gets a clear message before any work is done, and so
 *     both sides of a two-party flow are checked (a frozen merchant should
 *     not be taking payments either).
 *  2. **The ledger** refuses to debit a frozen wallet inside
 *     `prepareJournalEntry`. That is the layer that actually holds: it cannot
 *     be bypassed by a call site that forgot step 1, and it costs no extra
 *     reads because the entry already reads every affected wallet.
 *
 * Layer 1 is the user experience. Layer 2 is the guarantee.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { AccountStatus } from "../types";

/** The document fields this module reads; anything user-doc shaped works. */
export interface AccountStatusFields {
  accountStatus?: unknown;
  isActive?: unknown;
}

const VALID: readonly string[] = ["active", "frozen", "closed"];

/**
 * Resolve an account's status, tolerating documents written before
 * `accountStatus` existed.
 *
 * Legacy fallback: `deleteAccount` has always marked closed accounts with
 * `isActive: false`, so that keeps meaning closed. Everything else defaults to
 * active — a missing field must never read as frozen, or every pre-existing
 * account would be locked out on deploy.
 */
export function resolveAccountStatus(
  userData: AccountStatusFields | undefined
): AccountStatus {
  const explicit = userData?.accountStatus;
  if (typeof explicit === "string" && VALID.includes(explicit)) {
    return explicit as AccountStatus;
  }
  if (userData?.isActive === false) {
    return "closed";
  }
  return "active";
}

/** True when the account may participate in money movement. */
export function isAccountActive(
  userData: AccountStatusFields | undefined
): boolean {
  return resolveAccountStatus(userData) === "active";
}

export type AccountRole = "actor" | "counterparty";

function message(status: AccountStatus, role: AccountRole): string {
  if (role === "counterparty") {
    return status === "closed"
      ? "That account is closed and cannot be paid."
      : "That account is temporarily unavailable. Please try again later or contact support.";
  }
  return status === "closed"
    ? "This account is closed."
    : "This account is frozen. Please contact support.";
}

/**
 * Throw unless the account is active. Pure — operates on an already-read
 * document, so call sites that have the user doc in hand add no extra read.
 *
 * `role` only shapes the error text: a customer should not be told why some
 * merchant's account is unavailable.
 */
export function assertAccountActive(
  userData: AccountStatusFields | undefined,
  role: AccountRole = "actor"
): void {
  const status = resolveAccountStatus(userData);
  if (status === "active") return;
  throw new https.HttpsError("permission-denied", message(status, role));
}

/**
 * Read a user document and assert it is active, returning the data so the
 * caller can reuse it instead of reading twice.
 *
 * Throws `not-found` when the user does not exist, matching `verifyUserPin`.
 */
export async function requireActiveAccount(
  userId: string,
  role: AccountRole = "actor"
): Promise<FirebaseFirestore.DocumentData> {
  const snap = await admin.firestore().collection("users").doc(userId).get();

  if (!snap.exists) {
    throw new https.HttpsError(
      "not-found",
      role === "actor" ? "User not found" : "Recipient not found"
    );
  }

  const data = snap.data()!;
  assertAccountActive(data, role);
  return data;
}
