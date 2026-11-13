/**
 * The counter display's state doc, and the one function that writes it.
 *
 * `syncCounterState` re-derives what the counter should show from the source
 * of truth (the shop's newest active QR, its newest pending request) every
 * time; nothing applies a delta. So any caller can run it at any time, a
 * missed or repeated event is healed by the next call, and the heartbeat
 * every display sends each minute bounds how long a wrong screen can last.
 *
 * Callers: generateQRCode and cancelQRCode (inline, for speed), the
 * Firestore triggers in triggers.ts, displayScanCustomer, pairing confirm,
 * and displayHeartbeat.
 */

import * as admin from "firebase-admin";
import { requestExpiryMillis } from "../customer-qr/requestExpiry";
import { buildStickerPayload } from "../merchants/generateMerchantSticker";
import { isAccountActive } from "../utils/accountStatus";
import { MerchantPaymentRequest, QRCode } from "../types";
import { MERCHANT_TYPES } from "./guard";
import {
  CounterDisplayState,
  DISPLAY_STATES,
  DisplayLang,
  MERCHANT_DISPLAYS,
  OTHER_FLASH_MS,
  PAID_FLASH_MS,
  StateFlash,
  StateRequest,
  StateSale,
} from "./types";

type Db = admin.firestore.Firestore;
type Derived = Omit<CounterDisplayState, "flash">;

const millis = (t: unknown, fallback = 0): number =>
  t && typeof (t as admin.firestore.Timestamp).toMillis === "function"
    ? (t as admin.firestore.Timestamp).toMillis()
    : fallback;

/** First word of a name: all a public screen needs to greet the payer. */
export function firstName(fullName: unknown): string {
  if (typeof fullName !== "string") return "";
  return fullName.trim().split(/\s+/)[0]?.slice(0, 24) ?? "";
}

function lang(value: unknown): DisplayLang {
  return value === "so" || value === "ar" ? value : "en";
}

/** Shop name exactly as generateQRCode picks it for the customer. */
export function shopName(
  user: admin.firestore.DocumentData | undefined,
  profile: admin.firestore.DocumentData | undefined
): string {
  return profile?.businessName || user?.fullName || "Zapp Pay Merchant";
}

/** A flash for an event, timed from when it happened rather than from now. */
export function makeFlash(
  kind: StateFlash["kind"],
  amountCents: number,
  atMs: number,
  receiptNumber?: string
): StateFlash {
  return {
    kind,
    amountCents,
    atMs,
    showUntilMs: atMs + (kind === "paid" ? PAID_FLASH_MS : OTHER_FLASH_MS),
    ...(receiptNumber ? { receiptNumber } : {}),
  };
}

/** What the counter should show for this shop, read from the source of truth. */
export async function deriveCounterState(
  db: Db,
  merchantId: string,
  derivedAtMs: number
): Promise<Derived> {
  const [userSnap, profileSnap] = await Promise.all([
    db.collection("users").doc(merchantId).get(),
    db.collection("merchantProfiles").doc(merchantId).get(),
  ]);
  const user = userSnap.data();
  const profile = profileSnap.exists ? profileSnap.data() : undefined;
  const merchantName = shopName(user, profile);
  const base = {
    v: 1 as const,
    merchantName,
    idleQr: buildStickerPayload(merchantId, merchantName, profile?.businessAddress || "Hargeisa"),
    lang: lang(user?.preferredLanguage),
    derivedAtMs,
  };

  if (!userSnap.exists || !MERCHANT_TYPES.includes(user?.accountType) || !isAccountActive(user)) {
    return { ...base, mode: "unavailable" };
  }

  const [requestSnap, qrSnap] = await Promise.all([
    db
      .collection("paymentRequests")
      .where("merchantId", "==", merchantId)
      .where("status", "==", "pending")
      .orderBy("createdAt", "desc")
      .limit(5)
      .get(),
    db
      .collection("qrCodes")
      .where("merchantId", "==", merchantId)
      .where("status", "==", "active")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get(),
  ]);

  let request: StateRequest | undefined;
  for (const doc of requestSnap.docs) {
    const r = doc.data() as MerchantPaymentRequest & { customerName?: string };
    // An agent paying out cash is not a sale at the counter.
    if (r.purpose === "cash_out") continue;
    const expiresAtMs = requestExpiryMillis(r);
    if (expiresAtMs <= derivedAtMs) continue;
    request = {
      id: doc.id,
      amountCents: r.amount,
      currency: "USD",
      customerFirstName: firstName(r.customerName),
      createdAtMs: millis(r.createdAt),
      expiresAtMs,
    };
    break;
  }

  let sale: StateSale | undefined;
  const qrDoc = qrSnap.docs[0];
  if (qrDoc) {
    const q = qrDoc.data() as QRCode;
    const expiresAtMs = millis(q.expiresAt);
    if (expiresAtMs > derivedAtMs && q.emvQrData) {
      sale = {
        id: qrDoc.id,
        qrData: q.emvQrData,
        amountCents: q.amount,
        currency: "USD",
        ...(q.reference ? { reference: q.reference } : {}),
        createdAtMs: millis(q.createdAt),
        expiresAtMs,
      };
    }
  }

  // Normally only one exists: a tablet scan voids the QR as it raises the
  // request. Newest wins if two phones on one account open sales at once.
  if (request && (!sale || request.createdAtMs >= sale.createdAtMs)) {
    return { ...base, mode: "approving", request };
  }
  if (sale) return { ...base, mode: "sale", sale };
  return { ...base, mode: "idle" };
}

/**
 * The state to store, given what is stored now. Pure, so the ordering rules
 * are tested without Firestore.
 *
 * - A derivation older than the stored one keeps the stored screen: a later
 *   one already landed.
 * - A new flash replaces an older one. A stored flash is kept until it runs
 *   out or a sale or request newer than it appears, so an unrelated re-sync
 *   can't wipe "Paid" before the customer sees it, and a new sale clears it.
 */
export function mergeState(
  stored: CounterDisplayState | undefined,
  derived: Derived,
  flash: StateFlash | undefined,
  nowMs: number
): CounterDisplayState {
  const screen: Derived =
    stored && stored.derivedAtMs > derived.derivedAtMs ? stripFlash(stored) : derived;

  let kept: StateFlash | undefined = stored?.flash;
  if (flash && (!kept || flash.atMs >= kept.atMs)) kept = flash;
  if (kept) {
    const newer = Math.max(screen.sale?.createdAtMs ?? 0, screen.request?.createdAtMs ?? 0);
    if (kept.showUntilMs <= nowMs || newer > kept.atMs) kept = undefined;
  }

  const out: CounterDisplayState = { ...screen };
  if (!out.sale) delete out.sale;
  if (!out.request) delete out.request;
  if (kept) out.flash = kept;
  return out;
}

function stripFlash(state: CounterDisplayState): Derived {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { flash, ...rest } = state;
  return rest;
}

function sameState(a: CounterDisplayState | undefined, b: CounterDisplayState): boolean {
  if (!a) return false;
  const pick = (s: CounterDisplayState) => {
    // derivedAtMs alone changing is no reason to wake every tablet.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { derivedAtMs, ...rest } = s as CounterDisplayState & { updatedAt?: unknown };
    delete (rest as Record<string, unknown>).updatedAt;
    return JSON.stringify(sortKeys(rest));
  };
  return pick(a) === pick(b);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])])
    );
  }
  return value;
}

async function writeState(
  db: Db,
  stateKey: string,
  derived: Derived,
  flash: StateFlash | undefined
): Promise<void> {
  const ref = db.collection(DISPLAY_STATES).doc(stateKey);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists ? (snap.data() as CounterDisplayState) : undefined;
    const next = mergeState(stored, derived, flash, Date.now());
    if (sameState(stored, next)) return;
    tx.set(ref, { ...next, updatedAt: admin.firestore.Timestamp.now() });
  });
}

/**
 * Bring every linked display of this shop up to date. One query and nothing
 * more for a shop with no display, so callers can run it on every sale.
 */
export async function syncCounterState(
  merchantId: string,
  opts: { flash?: StateFlash; onlyStateKey?: string } = {}
): Promise<void> {
  const db = admin.firestore();
  const displays = await db
    .collection(MERCHANT_DISPLAYS)
    .where("merchantId", "==", merchantId)
    .where("status", "==", "active")
    .get();
  if (displays.empty) return;

  // Taken before the source reads, so a derivation that started later wins.
  const derivedAtMs = Date.now();
  const derived = await deriveCounterState(db, merchantId, derivedAtMs);
  const keys = displays.docs
    .map((d) => d.get("stateKey") as string | null)
    .filter((k): k is string => typeof k === "string" && k.length > 0)
    .filter((k) => !opts.onlyStateKey || k === opts.onlyStateKey);
  await Promise.all(keys.map((k) => writeState(db, k, derived, opts.flash)));
}

/** For callers on the money path's edge: never let a display problem fail them. */
export async function syncCounterStateQuietly(
  merchantId: string,
  opts: { flash?: StateFlash } = {}
): Promise<void> {
  try {
    await syncCounterState(merchantId, opts);
  } catch (err) {
    console.error(`Counter display sync failed for ${merchantId}:`, err);
  }
}

export { millis as toMillis };
