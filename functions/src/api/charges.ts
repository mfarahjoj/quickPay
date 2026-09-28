/**
 * The charge resource: a merchant asks to be paid, the customer approves in
 * the app. Nothing here moves money — creating, reading and cancelling a
 * charge only manage the `api_charges` doc. The money moves in
 * approveApiCharge, under the customer's PIN.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { User } from "../types";
import { getRates } from "../config/rates";
import { isAccountActive } from "../utils/accountStatus";
import { validatePhoneNumber } from "../utils/validation";
import { sendPushNotification } from "../utils/notifications";
import { ApiCaller } from "./keys";
import { ApiError, badRequest, conflict, notFound } from "./http";
import {
  idempotencyDocId,
  idempotencyMismatch,
  requestFingerprint,
} from "./requestGuards";
import {
  API_CHARGES_COLLECTION,
  API_IDEMPOTENCY_COLLECTION,
  ApiCharge,
  ApiChargeStatus,
  ApiIdempotencyRecord,
} from "./types";

export const CHARGE_ID_PATTERN = /^ch_[A-Za-z0-9_-]{16,64}$/;
export const DEEP_LINK_SCHEME = "zapppay";

const MIN_EXPIRES_IN = 60;
const MAX_EXPIRES_IN = 24 * 60 * 60;
const MAX_REFERENCE = 128;
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEY = 40;
const MAX_METADATA_VALUE = 500;
const MAX_URL = 2048;
const MAX_LIST_LIMIT = 100;

export function newChargeId(): string {
  return `ch_${crypto.randomBytes(18).toString("base64url")}`;
}

/**
 * Where the hosted checkout lives. Derived from the project so staging links
 * point at staging; `ZAPP_CHECKOUT_BASE_URL` overrides it once a custom
 * domain is in front.
 */
export function checkoutBaseUrl(): string {
  const configured = process.env.ZAPP_CHECKOUT_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "quickpay-485417";
  return `https://${project}.web.app`;
}

export function checkoutUrl(chargeId: string): string {
  return `${checkoutBaseUrl()}/checkout/${chargeId}`;
}

export function deepLink(chargeId: string): string {
  return `${DEEP_LINK_SCHEME}://charge/${chargeId}`;
}

/** The moment a charge stops being payable, whether or not the sweep has recorded it yet. */
export function isLapsed(charge: Pick<ApiCharge, "status" | "expiresAt">, now = Date.now()): boolean {
  return charge.status === "pending" && now > charge.expiresAt.toMillis();
}

export function effectiveStatus(charge: ApiCharge, now = Date.now()): ApiChargeStatus {
  return isLapsed(charge, now) ? "expired" : charge.status;
}

const iso = (ts?: FirebaseFirestore.Timestamp) => (ts ? ts.toDate().toISOString() : null);

/** The charge as integrators see it (snake_case, ISO times, cents). */
export function serializeCharge(id: string, charge: ApiCharge, now = Date.now()) {
  return {
    id,
    object: "charge",
    amount: charge.amount,
    currency: charge.currency,
    status: effectiveStatus(charge, now),
    reference: charge.reference ?? null,
    metadata: charge.metadata ?? {},
    customer_phone: charge.customerPhone ?? null,
    amount_refunded: charge.amountRefunded ?? 0,
    fee: charge.feeCents ?? null,
    net: charge.netCents ?? null,
    transaction_id: charge.transactionId ?? null,
    checkout_url: checkoutUrl(id),
    qr_payload: checkoutUrl(id),
    deep_link: deepLink(id),
    success_url: charge.successUrl ?? null,
    cancel_url: charge.cancelUrl ?? null,
    created: iso(charge.createdAt),
    expires_at: iso(charge.expiresAt),
    succeeded_at: iso(charge.succeededAt),
    canceled_at: iso(charge.canceledAt),
    expired_at: iso(charge.expiredAt) ?? (isLapsed(charge, now) ? iso(charge.expiresAt) : null),
    livemode: true,
  };
}

/**
 * What the hosted checkout page may show. The charge ID is the capability —
 * whoever holds the link can see what they are being asked to pay and who is
 * asking, and nothing else: no metadata, no customer phone, no fee.
 */
export function serializePublicCharge(id: string, charge: ApiCharge, now = Date.now()) {
  return {
    id,
    object: "public_charge",
    status: effectiveStatus(charge, now),
    amount: charge.amount,
    currency: charge.currency,
    merchant_name: charge.merchantName,
    reference: charge.reference ?? null,
    expires_at: iso(charge.expiresAt),
    deep_link: deepLink(id),
    qr_payload: checkoutUrl(id),
    success_url: charge.successUrl ?? null,
    cancel_url: charge.cancelUrl ?? null,
  };
}

// ─── Validation ────────────────────────────────────────────────────────────

export function parseAmount(value: unknown, param = "amount"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(
      "amount_invalid",
      "amount must be a positive integer number of cents (e.g. 1250 for $12.50)",
      param
    );
  }
  return value;
}

function parseOptionalString(value: unknown, param: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw badRequest("parameter_invalid", `${param} must be a string of at most ${max} characters`, param);
  }
  return value.trim();
}

function parseMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("parameter_invalid", "metadata must be an object of string values", "metadata");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_METADATA_KEYS) {
    throw badRequest("parameter_invalid", `metadata may hold at most ${MAX_METADATA_KEYS} keys`, "metadata");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (k.length === 0 || k.length > MAX_METADATA_KEY || typeof v !== "string" || v.length > MAX_METADATA_VALUE) {
      throw badRequest(
        "parameter_invalid",
        `metadata keys must be 1-${MAX_METADATA_KEY} characters and values strings of at most ${MAX_METADATA_VALUE}`,
        "metadata"
      );
    }
    out[k] = v;
  }
  return entries.length ? out : undefined;
}

function parseRedirectUrl(value: unknown, param: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let url: URL;
  try {
    if (typeof value !== "string" || value.length > MAX_URL) throw new Error();
    url = new URL(value);
  } catch {
    throw badRequest("url_invalid", `${param} must be an absolute https URL`, param);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw badRequest("url_invalid", `${param} must be an absolute https URL`, param);
  }
  return url.toString();
}

export interface NormalisedChargeInput {
  amount: number;
  currency: "USD";
  reference?: string;
  metadata?: Record<string, string>;
  customerPhone?: string;
  successUrl?: string;
  cancelUrl?: string;
  expiresIn?: number;
}

export function parseChargeInput(body: Record<string, unknown>): NormalisedChargeInput {
  const amount = parseAmount(body.amount);

  const currency = body.currency === undefined ? "USD" : body.currency;
  if (typeof currency !== "string" || currency.toUpperCase() !== "USD") {
    throw badRequest("currency_unsupported", "currency must be USD", "currency");
  }

  const customerPhone = parseOptionalString(body.customer_phone, "customer_phone", 20);
  if (customerPhone && !validatePhoneNumber(customerPhone)) {
    throw badRequest(
      "phone_invalid",
      "customer_phone must be in international format, e.g. +252634123456",
      "customer_phone"
    );
  }

  let expiresIn: number | undefined;
  if (body.expires_in !== undefined && body.expires_in !== null) {
    const v = body.expires_in;
    if (typeof v !== "number" || !Number.isInteger(v) || v < MIN_EXPIRES_IN || v > MAX_EXPIRES_IN) {
      throw badRequest(
        "parameter_invalid",
        `expires_in must be whole seconds between ${MIN_EXPIRES_IN} and ${MAX_EXPIRES_IN}`,
        "expires_in"
      );
    }
    expiresIn = v;
  }

  return {
    amount,
    currency: "USD",
    reference: parseOptionalString(body.reference, "reference", MAX_REFERENCE),
    metadata: parseMetadata(body.metadata),
    customerPhone,
    successUrl: parseRedirectUrl(body.success_url, "success_url"),
    cancelUrl: parseRedirectUrl(body.cancel_url, "cancel_url"),
    expiresIn,
  };
}

// ─── Operations ────────────────────────────────────────────────────────────

async function merchantDisplayName(merchantId: string, merchant: User): Promise<string> {
  const profile = await admin.firestore().collection("merchantProfiles").doc(merchantId).get();
  const businessName = profile.exists ? (profile.data()?.businessName as string | undefined) : undefined;
  return businessName || merchant.fullName || "Zapp Pay Merchant";
}

/**
 * The customer a merchant addressed the charge to, if the phone number is a
 * Zapp customer who can pay. The API answers the same either way — whether a
 * phone number has a Zapp account is not the merchant's to learn.
 */
async function findPayer(phone: string, merchantId: string): Promise<string | undefined> {
  const snap = await admin
    .firestore()
    .collection("users")
    .where("phoneNumber", "==", phone)
    .limit(1)
    .get();
  if (snap.empty) return undefined;
  const doc = snap.docs[0];
  if (doc.id === merchantId || !isAccountActive(doc.data())) return undefined;
  return doc.id;
}

export interface CreateChargeResult {
  id: string;
  charge: ApiCharge;
  replayed: boolean;
}

export async function createCharge(
  caller: ApiCaller,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<CreateChargeResult> {
  const input = parseChargeInput(body);
  const db = admin.firestore();
  const idemRef = db
    .collection(API_IDEMPOTENCY_COLLECTION)
    .doc(idempotencyDocId(caller.merchantId, "charge", idempotencyKey));
  const requestHash = requestFingerprint(input);

  // Answer a retry before doing any other work, so it costs one read.
  const prior = await idemRef.get();
  if (prior.exists) {
    return replayCharge(prior.data() as ApiIdempotencyRecord, requestHash);
  }

  const [merchantName, customerId, rates] = await Promise.all([
    merchantDisplayName(caller.merchantId, caller.merchant),
    input.customerPhone ? findPayer(input.customerPhone, caller.merchantId) : Promise.resolve(undefined),
    getRates(),
  ]);

  const now = admin.firestore.Timestamp.now();
  const ttlSeconds = input.expiresIn ?? rates.apiChargeTtlSeconds;
  const chargeRef = db.collection(API_CHARGES_COLLECTION).doc(newChargeId());

  // Firestore rejects undefined values; attach optional fields only when set.
  const charge: ApiCharge = {
    merchantId: caller.merchantId,
    merchantName,
    keyId: caller.keyId,
    amount: input.amount,
    currency: "USD",
    status: "pending",
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}),
    ...(customerId ? { customerId } : {}),
    ...(input.successUrl ? { successUrl: input.successUrl } : {}),
    ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
    createdAt: now,
    expiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + ttlSeconds * 1000),
    amountRefunded: 0,
    feeRefunded: 0,
    refundCount: 0,
  };

  // Two retries racing each other both miss the read above; the transaction
  // lets exactly one create the charge and hands the other its result.
  const outcome = await db.runTransaction(async (tx) => {
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      return { created: false as const, record: idemSnap.data() as ApiIdempotencyRecord };
    }
    const record: ApiIdempotencyRecord = {
      merchantId: caller.merchantId,
      scope: "charge",
      requestHash,
      objectId: chargeRef.id,
      createdAt: now,
    };
    tx.create(chargeRef, charge);
    tx.create(idemRef, record);
    return { created: true as const };
  });

  if (!outcome.created) {
    return replayCharge(outcome.record, requestHash);
  }

  if (customerId) {
    const amount = (input.amount / 100).toFixed(2);
    const body = input.reference
      ? `${merchantName} is requesting USD ${amount} — ${input.reference}`
      : `${merchantName} is requesting USD ${amount}`;
    sendPushNotification(customerId, "Payment Request", body, {
      type: "api_charge",
      chargeId: chargeRef.id,
      merchantName,
      amount: input.amount.toString(),
      currency: "USD",
      expiresAt: charge.expiresAt.toDate().toISOString(),
      ...(input.reference ? { reference: input.reference } : {}),
    }).catch((err) => console.error("Failed to notify customer of API charge:", err));
  }

  return { id: chargeRef.id, charge, replayed: false };
}

async function replayCharge(
  record: ApiIdempotencyRecord,
  requestHash: string
): Promise<CreateChargeResult> {
  if (record.requestHash !== requestHash) throw idempotencyMismatch();
  const snap = await admin.firestore().collection(API_CHARGES_COLLECTION).doc(record.objectId).get();
  if (!snap.exists) {
    throw new ApiError(500, "api_error", "internal_error", "Charge for this Idempotency-Key is missing");
  }
  return { id: snap.id, charge: snap.data() as ApiCharge, replayed: true };
}

/** Read a charge the caller owns. Someone else's charge is indistinguishable from none. */
export async function getOwnCharge(merchantId: string, chargeId: string): Promise<ApiCharge> {
  if (!CHARGE_ID_PATTERN.test(chargeId)) throw notFound("charge");
  const snap = await admin.firestore().collection(API_CHARGES_COLLECTION).doc(chargeId).get();
  const charge = snap.data() as ApiCharge | undefined;
  if (!snap.exists || charge?.merchantId !== merchantId) throw notFound("charge");
  return charge;
}

export async function getPublicCharge(chargeId: string): Promise<ApiCharge> {
  if (!CHARGE_ID_PATTERN.test(chargeId)) throw notFound("charge");
  const snap = await admin.firestore().collection(API_CHARGES_COLLECTION).doc(chargeId).get();
  if (!snap.exists) throw notFound("charge");
  return snap.data() as ApiCharge;
}

export async function listCharges(merchantId: string, query: Record<string, unknown>) {
  const rawLimit = query.limit === undefined ? 10 : Number(query.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIST_LIMIT) {
    throw badRequest("parameter_invalid", `limit must be between 1 and ${MAX_LIST_LIMIT}`, "limit");
  }
  const status = query.status;
  if (status !== undefined && !["pending", "succeeded", "expired", "canceled"].includes(status as string)) {
    throw badRequest("parameter_invalid", "status must be pending, succeeded, expired or canceled", "status");
  }

  const db = admin.firestore();
  let q: FirebaseFirestore.Query = db
    .collection(API_CHARGES_COLLECTION)
    .where("merchantId", "==", merchantId);
  if (status) q = q.where("status", "==", status);
  q = q.orderBy("createdAt", "desc");

  const startingAfter = query.starting_after;
  if (startingAfter !== undefined) {
    if (typeof startingAfter !== "string" || !CHARGE_ID_PATTERN.test(startingAfter)) {
      throw badRequest("parameter_invalid", "starting_after must be a charge id", "starting_after");
    }
    const cursor = await db.collection(API_CHARGES_COLLECTION).doc(startingAfter).get();
    if (!cursor.exists || cursor.data()?.merchantId !== merchantId) {
      throw badRequest("parameter_invalid", "starting_after must be one of your charges", "starting_after");
    }
    q = q.startAfter(cursor);
  }

  const snap = await q.limit(rawLimit + 1).get();
  const docs = snap.docs.slice(0, rawLimit);
  const now = Date.now();
  return {
    object: "list",
    data: docs.map((d) => serializeCharge(d.id, d.data() as ApiCharge, now)),
    has_more: snap.docs.length > rawLimit,
  };
}

/**
 * Withdraw a pending charge, e.g. the shopper paid cash instead.
 *
 * Runs in a transaction on the charge doc, the same doc approveApiCharge
 * settles, so a cancel and an approval landing together resolve one way or
 * the other — never both. Cancelling something already over is not an error
 * unless it succeeded: then the till has to know, because money moved.
 */
export async function cancelCharge(merchantId: string, chargeId: string) {
  await getOwnCharge(merchantId, chargeId);
  const db = admin.firestore();
  const ref = db.collection(API_CHARGES_COLLECTION).doc(chargeId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const charge = snap.data() as ApiCharge;
    const now = admin.firestore.Timestamp.now();

    if (charge.status === "succeeded") {
      throw conflict(
        "charge_already_succeeded",
        "This charge has already been paid. Refund it instead."
      );
    }
    if (charge.status !== "pending") return serializeCharge(chargeId, charge);

    const update: Partial<ApiCharge> = isLapsed(charge, now.toMillis())
      ? { status: "expired", expiredAt: now }
      : { status: "canceled", canceledAt: now };
    tx.update(ref, update);
    return serializeCharge(chargeId, { ...charge, ...update });
  });
}
