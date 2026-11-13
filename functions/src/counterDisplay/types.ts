/**
 * Counter display: a customer-facing tablet on the shop counter
 * (COUNTER_DISPLAY.md). These are its documents and limits.
 *
 * The tablet has no Firebase Auth identity. It proves itself with a
 * `displayId` and a `displaySecret` (stored here only as a SHA-256), and it
 * reads one server-written state doc whose id, `stateKey`, is itself a
 * 256-bit secret.
 */

import type * as admin from "firebase-admin";

export const MERCHANT_DISPLAYS = "merchantDisplays";
export const DISPLAY_PAIRINGS = "displayPairings";
export const DISPLAY_STATES = "counterDisplayStates";
export const DISPLAY_RATE_LIMITS = "display_rate_limits";

/** A shop links at most this many tablets. One counter per shop at launch. */
export const MAX_ACTIVE_DISPLAYS = 3;
/** How long a pairing code on the tablet stays usable. */
export const PAIRING_TTL_MS = 5 * 60 * 1000;
/** Pairing docs are swept by a Firestore TTL policy on `expireAt`. */
export const PAIRING_CLEANUP_MS = 24 * 60 * 60 * 1000;

export const PAID_FLASH_MS = 8000;
export const OTHER_FLASH_MS = 5000;

export const DISPLAY_ID = /^cd_[a-f0-9]{24}$/;
export const PAIRING_ID = /^dp_[a-f0-9]{24}$/;
export const SECRET = /^[a-f0-9]{64}$/;
export const PAIRING_CODE = /^[0-9]{8}$/;

export type DisplayStatus = "pending_confirm" | "active" | "revoked";

export interface MerchantDisplay {
  merchantId: string;
  name: string;
  status: DisplayStatus;
  /** SHA-256 of the tablet's secret. Null until confirmed, and after revoke. */
  secretSha256: string | null;
  stateKey: string | null;
  pairingId: string;
  secretFailedAttempts?: number;
  secretLockedUntil?: admin.firestore.Timestamp | null;
  createdAt: admin.firestore.Timestamp;
  confirmedAt?: admin.firestore.Timestamp | null;
  lastSeenAt?: admin.firestore.Timestamp | null;
  lastError?: string | null;
  appBuild?: string | null;
  revokedAt?: admin.firestore.Timestamp | null;
}

export type PairingStatus = "waiting" | "claimed" | "completed" | "declined";

export interface DisplayPairing {
  secretSha256: string;
  code: string;
  status: PairingStatus;
  displayId?: string;
  merchantId?: string;
  merchantName?: string;
  createdAt: admin.firestore.Timestamp;
  expiresAt: admin.firestore.Timestamp;
  /** Firestore TTL field. */
  expireAt: admin.firestore.Timestamp;
}

export type DisplayMode = "idle" | "sale" | "approving" | "unavailable";
export type DisplayLang = "en" | "so" | "ar";

export interface StateSale {
  id: string;
  qrData: string;
  amountCents: number;
  currency: "USD";
  reference?: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface StateRequest {
  id: string;
  amountCents: number;
  currency: "USD";
  customerFirstName: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export type FlashKind = "paid" | "declined" | "expired";

export interface StateFlash {
  kind: FlashKind;
  amountCents: number;
  receiptNumber?: string;
  /** When it happened, from the source doc, never "now". */
  atMs: number;
  showUntilMs: number;
}

/**
 * What a counter display shows. Holds only what is on a public screen anyway:
 * never fees, net amounts, balances, full names or anyone's id.
 */
export interface CounterDisplayState {
  v: 1;
  merchantName: string;
  idleQr: string;
  mode: DisplayMode;
  sale?: StateSale;
  request?: StateRequest;
  flash?: StateFlash;
  lang: DisplayLang;
  derivedAtMs: number;
}
