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
  | "portal"
  /**
   * Refund the shop's counter payments with their own PIN, within the caps
   * the owner set on the grant. Off until the owner sets both caps.
   */
  | "refund";

const CAPABILITIES: Record<StaffRole, readonly StaffCapability[]> = {
  waiter: ["tables"],
  cashier: ["tables", "charge"],
  manager: ["tables", "charge", "portal", "refund"],
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
  /**
   * Manager only: the most one refund may give back, and the most their
   * refunds may give back in a Hargeisa day, in US cents (shillings count at
   * `slsPerUsd`). Refunds are off unless both are set above zero.
   */
  refundCapCents?: number;
  refundDayCapCents?: number;
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

/** Highest caps an owner may set: $1,000 a refund, $5,000 a day. */
export const MAX_REFUND_CAP_CENTS = 100_000;
export const MAX_REFUND_DAY_CAP_CENTS = 500_000;

/** Whether this grant may refund at all: a manager with both caps set. */
export function refundsEnabled(g: Pick<StaffGrant, "role" | "refundCapCents" | "refundDayCapCents">): boolean {
  return g.role === "manager" && (g.refundCapCents ?? 0) > 0 && (g.refundDayCapCents ?? 0) > 0;
}

/** `staffRefundDays/{grantId}_{YYYY-MM-DD}`: a manager's refunds that day. Server-only. */
export const STAFF_REFUND_DAYS = "staffRefundDays";

export interface StaffRefundDay {
  merchantUid: string;
  staffUid: string;
  /** Hargeisa day, "2026-11-21". */
  day: string;
  /** Sum of that day's refunds in US cents (shillings at `slsPerUsd`). */
  usedCents: number;
  count: number;
  updatedAt: Timestamp;
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
  refundCapCents?: number;
  refundDayCapCents?: number;
  at: Timestamp;
}
