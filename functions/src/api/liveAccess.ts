/**
 * Live API access: Zapp approves a shop once before it can make live API
 * keys itself (docs/MERCHANT_API.md §1). Test keys stay self-serve: they
 * never move money, so a developer can build before anyone at Zapp looks.
 *
 * Why: most shops never need a key, and the easiest way to steal from one is
 * to phone as "Zapp support" and ask the owner to make a live key and read it
 * out. A key now only exists for shops Zapp has spoken to.
 *
 * api_live_access/{merchantId} (server-only: no Firestore rule matches it):
 *
 *   none ─request─▶ pending ─approve─▶ approved ─withdraw─▶ withdrawn
 *                     │ decline                                │
 *                     ▼                                        │
 *                  declined ──────────request──────────────────┴─▶ pending
 *
 * Withdrawing revokes the shop's live keys in the same transaction. A shop
 * that already held a live key before approvals existed counts as approved
 * (`legacy`), so its integration and its key rotation keep working; so does
 * one whose live key ops issued from the console, which is ops' approval.
 */

import * as admin from "firebase-admin";
import { activeKeyCount } from "./keys";

export const API_LIVE_ACCESS = "api_live_access";

export type LiveAccessStatus = "none" | "pending" | "approved" | "declined" | "withdrawn";

/** A shop's own words on what it wants live keys for. */
export const PURPOSE_MIN = 10;
export const PURPOSE_MAX = 300;
/** What ops tell the shop when declining or withdrawing. */
export const NOTE_MAX = 300;

export interface LiveAccessDoc {
  merchantId: string;
  status: Exclude<LiveAccessStatus, "none">;
  purpose: string;
  requestedAt: FirebaseFirestore.Timestamp;
  decidedAt: FirebaseFirestore.Timestamp | null;
  decidedBy: string | null;
  /** Shown to the shop with a decline or a withdrawal. */
  note: string | null;
}

/** What the merchant app and the console are shown. Dates are ISO strings. */
export interface LiveAccessView {
  status: LiveAccessStatus;
  purpose: string | null;
  note: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  /** Approved because it held a live key before approvals existed. */
  legacy: boolean;
}

const iso = (ts: FirebaseFirestore.Timestamp | null | undefined) => (ts ? ts.toDate().toISOString() : null);

export function toLiveAccessView(doc: LiveAccessDoc): LiveAccessView {
  return {
    status: doc.status,
    purpose: doc.purpose ?? null,
    note: doc.note ?? null,
    requestedAt: iso(doc.requestedAt),
    decidedAt: iso(doc.decidedAt),
    legacy: false,
  };
}

export function liveAccessRef(merchantId: string): FirebaseFirestore.DocumentReference {
  return admin.firestore().collection(API_LIVE_ACCESS).doc(merchantId);
}

/** Where a shop stands. A recorded decision always wins over the legacy rule. */
export async function liveAccessOf(merchantId: string): Promise<LiveAccessView> {
  const snap = await liveAccessRef(merchantId).get();
  if (snap.exists) return toLiveAccessView(snap.data() as LiveAccessDoc);
  const legacy = (await activeKeyCount(merchantId, "live")) > 0;
  return {
    status: legacy ? "approved" : "none",
    purpose: null,
    note: null,
    requestedAt: null,
    decidedAt: null,
    legacy,
  };
}

/** Tidy free text from a form: one line of spaces, trimmed. */
export function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
