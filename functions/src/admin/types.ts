/**
 * Admin console types — see ADMIN_CONSOLE_PLAN.md.
 *
 * Everything the console can do runs through a callable in this directory:
 * the SPA never reads or writes Firestore directly, so `firestore.rules`
 * stays as closed for admins as it is for customers.
 */

/**
 * `super` implies every other role. `ops` runs day-to-day support (lookup,
 * freeze, float requests); `compliance` reviews KYC and role requests.
 */
export type AdminRole = "super" | "ops" | "compliance";

export const ADMIN_ROLES: readonly AdminRole[] = ["super", "ops", "compliance"];

/** The verified identity behind an admin callable, from custom claims. */
export interface AdminIdentity {
  uid: string;
  email: string;
  roles: AdminRole[];
}

/** Kinds of object an admin action can target. */
export type AuditTargetType =
  | "user"
  | "wallet"
  | "kyc"
  | "role_request"
  | "float_issuance"
  | "payout"
  | "api_key";

/**
 * One immutable record of an admin action. Written in the same transaction as
 * the effect it describes, so an action can never happen unlogged.
 *
 * Corrections are new entries — these are never updated or deleted, for the
 * same reason journal entries aren't.
 */
export interface AdminAuditEntry {
  actor: string;
  actorEmail: string;
  /** Dotted action name, e.g. "user.freeze", "kyc.approve", "float.issue". */
  action: string;
  target: { type: AuditTargetType; id: string };
  /** Changed fields only, before and after. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Operator-supplied justification. Required by every admin callable. */
  reason: string;
  /** Set when the action moved money. */
  journalEntryId?: string;
  at: FirebaseFirestore.Timestamp;
}
