/**
 * Zapp Business on the web (portal/): sign-in records and sessions.
 * MERCHANT_INSIGHTS.md, "Web sign-in".
 */

import type { Timestamp } from "firebase-admin/firestore";

export const PORTAL_LOGINS = "portalLogins";
export const PORTAL_SESSIONS = "portalSessions";

/** "pl_" + 24 hex: a sign-in waiting for a phone. */
export const LOGIN_ID = /^pl_[0-9a-f]{24}$/;
/** "ps_" + 32 hex: a signed-in computer. */
export const SESSION_ID = /^ps_[0-9a-f]{32}$/;
/** 32 hex: in the QR (code) or held only by the browser (pollSecret). */
export const LOGIN_SECRET = /^[0-9a-f]{32}$/;

/** How long a sign-in QR can be approved. The page fetches a new one after. */
export const LOGIN_TTL_MS = 2 * 60 * 1000;
/** Kept a day for the record, then removed by the TTL policy on `expireAt`. */
export const LOGIN_CLEANUP_MS = 24 * 60 * 60 * 1000;
/** Computers a shop can have signed in at once; the oldest is signed out beyond it. */
export const MAX_ACTIVE_SESSIONS = 5;

/** The Firebase Auth uid a session signs in as. Never a real user's uid. */
export const portalUid = (sessionId: string) => `portal_${sessionId}`;

export type PortalLoginStatus = "waiting" | "approved" | "declined" | "completed";

/** `portalLogins/{loginId}`: server-only. */
export interface PortalLogin {
  /** SHA-256 of the secret only the browser holds; polling needs it. */
  pollSecretSha256: string;
  /** SHA-256 of the code in the QR; approving needs it. */
  codeSha256: string;
  status: PortalLoginStatus;
  /** "Chrome on macOS", from the browser's User-Agent, for the phone to show. */
  browser: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  expireAt: Timestamp;
  merchantUid?: string;
  merchantName?: string;
  sessionId?: string;
  approvedAt?: Timestamp;
}

export type SessionEndReason = "signed_out" | "revoked" | "security" | "expired" | "replaced";

/** `portalSessions/{sessionId}`: server-only; the rules read `active` and `expiresAt`. */
export interface PortalSession {
  merchantUid: string;
  active: boolean;
  browser: string;
  loginId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  lastSeenAt?: Timestamp;
  endedAt?: Timestamp;
  endReason?: SessionEndReason;
  /**
   * Set when a staff member signed this computer in for the shop
   * (STAFF_ACCESS.md). Fixed at sign-in: any change to their grant ends the
   * session (staff/manage.ts), so the rules can trust these as they stand.
   */
  actorUid?: string;
  actorName?: string;
  role?: "manager";
  /** Staff only: may see customer names and history. The shop always may. */
  showCustomers?: boolean;
}

/** Custom claims on a session's token. `portal` is what requireAuth refuses. */
export interface PortalClaims {
  portal: true;
  portalFor: string;
  portalSid: string;
}
