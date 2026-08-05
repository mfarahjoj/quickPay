/**
 * Account role helpers.
 *
 * The same role lists were previously spelled out inline in a dozen
 * callables, and they had already drifted apart — `lookupUserByPhone` omitted
 * `agent_merchant`, locking agent-merchants out of the first step of the
 * top-up flow. Centralising them means a new role is added in one place.
 */

import { PrivilegedRole } from "../types";

export const PRIVILEGED_ROLES: readonly PrivilegedRole[] = [
  "merchant",
  "topup_agent",
  "agent_merchant",
];

/** Roles that must be granted by an admin rather than chosen at signup. */
export function isPrivilegedRole(value: unknown): value is PrivilegedRole {
  return (
    typeof value === "string" &&
    (PRIVILEGED_ROLES as readonly string[]).includes(value)
  );
}

/** Roles that perform agent cash-in / cash-out. */
export function isAgentRole(value: unknown): boolean {
  return value === "topup_agent" || value === "agent_merchant";
}

/** Roles that accept payments as a merchant. */
export function isMerchantRole(value: unknown): boolean {
  return value === "merchant" || value === "agent_merchant";
}

/**
 * Roles allowed to resolve a customer by phone number.
 *
 * Every privileged role needs this: agents to cash a customer in or out,
 * merchants to raise a charge against one.
 */
export function canLookupUsers(value: unknown): boolean {
  return isPrivilegedRole(value);
}
