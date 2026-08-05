/**
 * Admin authorization — the choke point every console callable goes through.
 *
 * Authority comes from Firebase Auth custom claims (`admin`, `adminRoles`),
 * which can only be set with `scripts/set-admin-claim.js` by someone who
 * already has project-level credentials. There is deliberately no callable
 * that grants admin: privilege escalation should require shell access, not a
 * phished console session.
 */

import { https } from "firebase-functions/v2";
import { AdminIdentity, AdminRole, ADMIN_ROLES } from "./types";

/**
 * How recently the admin must have signed in for a sensitive action
 * (freeze, KYC approval, float issuance). Mirrors the freshness check
 * resetPin applies to OTP verification.
 */
export const MAX_ADMIN_AUTH_AGE_SECONDS = 10 * 60;

function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

/**
 * Assert the caller is an admin, optionally holding one of `required`.
 *
 * Note on claim propagation: custom claims land in the ID token, so a newly
 * granted role only takes effect once the console refreshes its token. The
 * script prints that reminder.
 */
export function requireAdmin(
  request: https.CallableRequest,
  required?: AdminRole | AdminRole[]
): AdminIdentity {
  if (!request.auth) {
    throw new https.HttpsError(
      "unauthenticated",
      "Admin authentication required"
    );
  }

  const token = request.auth.token as Record<string, unknown>;

  if (token.admin !== true) {
    // Deliberately identical to the role-mismatch message below: the console
    // is not a place to learn whether a given account is an admin at all.
    throw new https.HttpsError("permission-denied", "Not authorized");
  }

  const roles = Array.isArray(token.adminRoles)
    ? token.adminRoles.filter(isAdminRole)
    : [];

  if (roles.length === 0) {
    throw new https.HttpsError("permission-denied", "Not authorized");
  }

  if (required) {
    const accepted = Array.isArray(required) ? required : [required];
    const allowed =
      roles.includes("super") || accepted.some((role) => roles.includes(role));
    if (!allowed) {
      throw new https.HttpsError("permission-denied", "Not authorized");
    }
  }

  const email = typeof token.email === "string" ? token.email : "";

  return { uid: request.auth.uid, email, roles };
}

/**
 * Require a recent sign-in on top of admin authority.
 *
 * Applied to actions that move money or change a customer's access, so a
 * long-lived console tab left open on an unlocked laptop cannot be used to
 * freeze accounts or issue float.
 */
export function requireRecentAdminAuth(
  request: https.CallableRequest,
  maxAgeSeconds: number = MAX_ADMIN_AUTH_AGE_SECONDS
): void {
  const authTime = request.auth?.token?.auth_time;
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!authTime || nowSeconds - authTime > maxAgeSeconds) {
    throw new https.HttpsError(
      "failed-precondition",
      "Recent sign-in required. Please re-authenticate and try again."
    );
  }
}

/**
 * Validate an operator-supplied justification.
 *
 * Every admin action requires one: the audit log is only useful if the
 * "why" is captured while the operator still remembers it.
 */
export function requireReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length < 8) {
    throw new https.HttpsError(
      "invalid-argument",
      "A reason of at least 8 characters is required"
    );
  }
  return reason.trim().slice(0, 500);
}
