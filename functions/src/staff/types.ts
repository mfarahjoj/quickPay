/**
 * Staff access: owner-granted roles for a shop (STAFF_ACCESS.md).
 *
 * A staff member is a customer account of their own. They never use the
 * shop's login or PIN. What they may do for the shop comes only from a grant
 * the shop's own account made, and that grant is read on every call.
 */

import type { Timestamp } from "firebase-admin/firestore";

export const MERCHANT_STAFF = "merchantStaff";
export const MERCHANT_STAFF_AUDIT = "merchantStaffAudit";

/** Staff a shop can have, active and invited together. */
export const MAX_STAFF_PER_SHOP = 20;

export type StaffRole = "waiter" | "cashier" | "manager";
export const STAFF_ROLES: readonly StaffRole[] = ["waiter", "cashier", "manager"];

export type StaffStatus = "invited" | "active" | "declined" | "revoked" | "left";

/**
 * What a grant can allow. Anything not listed here (payouts, payroll, API
 * keys, staff management, store links, float, PIN or phone changes) is the
 * shop's own account only and can never be granted.
 */
export type StaffCapability =
  /** Tables board and table bills (TABLE_CONNECT.md). */
  | "tables"
  /** Counter charge: scan a customer's code and raise a payment request. */
  | "charge"
  /** Sign a computer in to Zapp Business (portal/) with a read-only view. */
  | "portal";

const CAPABILITIES: Record<StaffRole, readonly StaffCapability[]> = {
  waiter: ["tables"],
  cashier: ["tables", "charge"],
  manager: ["tables", "charge", "portal"],
};

export function roleCan(role: StaffRole, capability: StaffCapability): boolean {
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** `merchantStaff/{merchantUid}_{staffUid}`. Written only by the server. */
export const grantId = (merchantUid: string, staffUid: string) => `${merchantUid}_${staffUid}`;

export interface StaffGrant {
  merchantUid: string;
  staffUid: string;
  role: StaffRole;
  status: StaffStatus;
  /** Manager only: may see customer names and history on Zapp Business. */
  showCustomers: boolean;
  /** Shown to the staff member ("Hodan's Café"), fixed when invited. */
  shopName: string;
  /** Shown to the shop: the staff member's name and number. */
  staffName: string;
  staffPhone: string;
  invitedAt: Timestamp;
  updatedAt: Timestamp;
  acceptedAt?: Timestamp;
  endedAt?: Timestamp;
}

export type StaffAuditAction = "invited" | "accepted" | "declined" | "changed" | "removed" | "left";

/** `merchantStaffAudit/{autoId}`: append-only, server-only. */
export interface StaffAuditEntry {
  merchantUid: string;
  staffUid: string;
  /** Who did it: the shop, or the staff member (accept, decline, leave). */
  byUid: string;
  action: StaffAuditAction;
  role: StaffRole;
  showCustomers: boolean;
  previousRole?: StaffRole;
  at: Timestamp;
}
