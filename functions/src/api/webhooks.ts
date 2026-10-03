/**
 * Webhooks: tell a merchant's server when a charge settles, lapses, is
 * cancelled or is refunded.
 *
 *   api_charges write ──trigger──▶ api_events/{evt} ──▶ webhook_deliveries/{evt}__{endpoint}
 *                                                           │ send now; on failure
 *                                                           ▼ retryWebhookDeliveries (every 5 min)
 *
 * Event and delivery IDs are derived from the charge and the transition, so
 * a trigger that fires twice (Firestore triggers are at-least-once) finds its
 * own work already done instead of sending twice.
 *
 * Each request carries `Zapp-Signature: t={unix},v1={hex}` where v1 is
 * HMAC-SHA256 of `{t}.{raw body}` under the endpoint's secret. Merchants
 * should verify it and reject a `t` more than five minutes old.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { ENCRYPTION_KEY } from "../config/secrets";
import { decrypt, encrypt } from "../utils/encryption";
import { badRequest, conflict, notFound } from "./http";
import { serializeCharge } from "./charges";
import {
  API_EVENTS_COLLECTION,
  ApiCharge,
  ApiEvent,
  WEBHOOK_DELIVERIES_COLLECTION,
  WEBHOOK_ENDPOINTS_COLLECTION,
  WEBHOOK_EVENT_TYPES,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEventType,
} from "./types";

const MAX_ENDPOINTS_PER_MERCHANT = 5;
const DELIVERY_TIMEOUT_MS = 10_000;
const LEASE_MS = 60_000;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const ENDPOINT_ID_PATTERN = /^we_[A-Za-z0-9_-]{16,64}$/;

/**
 * Wait after attempt n (1-based) before attempt n+1. Eight attempts spread
 * over roughly three days, then the delivery is marked failed.
 */
export const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600, 43200, 86400];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

// ─── Signing ───────────────────────────────────────────────────────────────

export function signPayload(secret: string, body: string, timestamp: number): string {
  const v1 = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/**
 * Reference verifier — what a merchant's server should do with the header.
 * Kept here so the docs and the tests exercise the exact algorithm we sign with.
 */
export function verifySignature(
  header: string,
  body: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || typeof v1 !== "string" || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
}

// ─── Endpoint management (via the API) ─────────────────────────────────────

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/**
 * Our servers make the request, so the URL must not point back inside
 * Google's network — the metadata server hands out service-account tokens.
 * This refuses the obvious internal targets by name and address; it does not
 * resolve DNS, so a public name that resolves to a private address would get
 * through (a follow-up if merchants ever self-serve endpoints).
 */
export function validateWebhookUrl(value: unknown): string {
  let url: URL;
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    url = new URL(value);
  } catch {
    throw badRequest("url_invalid", "url must be an absolute https URL", "url");
  }
  const host = url.hostname.toLowerCase();
  const blockedName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata" ||
    !host.includes(".");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    blockedName ||
    host.startsWith("[") ||
    isPrivateIPv4(host)
  ) {
    throw badRequest("url_invalid", "url must be a public https URL", "url");
  }
  return url.toString();
}

export function serializeEndpoint(id: string, endpoint: WebhookEndpoint, secret?: string) {
  return {
    id,
    object: "webhook_endpoint",
    url: endpoint.url,
    enabled_events: WEBHOOK_EVENT_TYPES,
    status: endpoint.enabled ? "enabled" : "disabled",
    created: endpoint.createdAt.toDate().toISOString(),
    // Shown once, at creation. Only the encrypted form is stored.
    ...(secret ? { secret } : {}),
  };
}

export async function createEndpoint(merchantId: string, body: Record<string, unknown>) {
  const url = validateWebhookUrl(body.url);
  const db = admin.firestore();
  const existing = await db
    .collection(WEBHOOK_ENDPOINTS_COLLECTION)
    .where("merchantId", "==", merchantId)
    .where("enabled", "==", true)
    .get();
  if (existing.size >= MAX_ENDPOINTS_PER_MERCHANT) {
    throw conflict(
      "endpoint_limit",
      `A merchant may have at most ${MAX_ENDPOINTS_PER_MERCHANT} webhook endpoints. Delete one first.`
    );
  }

  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const endpoint: WebhookEndpoint = {
    merchantId,
    url,
    secretEnc: encrypt(secret),
    enabled: true,
    createdAt: admin.firestore.Timestamp.now(),
  };
  const ref = db.collection(WEBHOOK_ENDPOINTS_COLLECTION).doc(`we_${crypto.randomBytes(18).toString("base64url")}`);
  await ref.create(endpoint);
  return serializeEndpoint(ref.id, endpoint, secret);
}

export async function listEndpoints(merchantId: string) {
  const snap = await admin
    .firestore()
    .collection(WEBHOOK_ENDPOINTS_COLLECTION)
    .where("merchantId", "==", merchantId)
    .where("enabled", "==", true)
    .get();
  return {
    object: "list",
    data: snap.docs.map((d) => serializeEndpoint(d.id, d.data() as WebhookEndpoint)),
    has_more: false,
  };
}

/** Disabled rather than deleted, so past deliveries still name a real endpoint. */
export async function deleteEndpoint(merchantId: string, endpointId: string) {
  if (!ENDPOINT_ID_PATTERN.test(endpointId)) throw notFound("webhook endpoint");
  const ref = admin.firestore().collection(WEBHOOK_ENDPOINTS_COLLECTION).doc(endpointId);
  const snap = await ref.get();
  const endpoint = snap.data() as WebhookEndpoint | undefined;
  if (!snap.exists || endpoint?.merchantId !== merchantId || !endpoint.enabled) {
    throw notFound("webhook endpoint");
  }
  await ref.update({ enabled: false, disabledAt: admin.firestore.Timestamp.now() });
  return { id: endpointId, object: "webhook_endpoint", deleted: true };
}

// ─── Events ────────────────────────────────────────────────────────────────

export interface PendingEvent {
  eventId: string;
  type: WebhookEventType;
}

/** Which events a change to a charge doc raises. Pure, for testing. */
export function eventsForChange(
  chargeId: string,
  before: ApiCharge | undefined,
  after: ApiCharge | undefined
): PendingEvent[] {
  if (!after) return [];
  const events: PendingEvent[] = [];
  if (before?.status !== after.status && after.status !== "pending") {
    events.push({ eventId: `evt_${chargeId}_${after.status}`, type: `charge.${after.status}` as WebhookEventType });
  }
  const refundsBefore = before?.refundCount ?? 0;
  for (let n = refundsBefore + 1; n <= (after.refundCount ?? 0); n++) {
    events.push({ eventId: `evt_${chargeId}_refund_${n}`, type: "charge.refunded" });
  }
  return events;
}

async function recordEvent(
  chargeId: string,
  charge: ApiCharge,
  pending: PendingEvent
): Promise<string[]> {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const payload = JSON.stringify({
    id: pending.eventId,
    object: "event",
    type: pending.type,
    created: now.toDate().toISOString(),
    data: { object: serializeCharge(chargeId, charge, now.toMillis()) },
  });
  const event: ApiEvent = {
    type: pending.type,
    merchantId: charge.merchantId,
    chargeId,
    payload,
    createdAt: now,
  };

  const endpoints = await db
    .collection(WEBHOOK_ENDPOINTS_COLLECTION)
    .where("merchantId", "==", charge.merchantId)
    .where("enabled", "==", true)
    .get();

  const deliveryIds: string[] = [];
  await db.runTransaction(async (tx) => {
    const eventRef = db.collection(API_EVENTS_COLLECTION).doc(pending.eventId);
    if ((await tx.get(eventRef)).exists) return; // a repeated trigger
    tx.create(eventRef, event);
    for (const endpoint of endpoints.docs) {
      const id = `${pending.eventId}__${endpoint.id}`;
      const delivery: WebhookDelivery = {
        eventId: pending.eventId,
        endpointId: endpoint.id,
        merchantId: charge.merchantId,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      };
      tx.create(db.collection(WEBHOOK_DELIVERIES_COLLECTION).doc(id), delivery);
      deliveryIds.push(id);
    }
  });
  return deliveryIds;
}

// ─── Delivery ──────────────────────────────────────────────────────────────

/** Claim a due delivery for this worker, or return null if it isn't ours to send. */
async function claimDelivery(id: string): Promise<WebhookDelivery | null> {
  const db = admin.firestore();
  const ref = db.collection(WEBHOOK_DELIVERIES_COLLECTION).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() as WebhookDelivery | undefined;
    const now = Date.now();
    if (!d || d.status !== "pending") return null;
    if (d.nextAttemptAt.toMillis() > now) return null;
    if (d.leaseUntil && d.leaseUntil.toMillis() > now) return null;
    tx.update(ref, { leaseUntil: admin.firestore.Timestamp.fromMillis(now + LEASE_MS) });
    return d;
  });
}

type SendResult = { ok: true; status: number } | { ok: false; status?: number; error: string };

async function send(url: string, body: string, signature: string, eventId: string): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ZappPay-Webhooks/1",
        "Zapp-Signature": signature,
        "Zapp-Event-Id": eventId,
      },
      body,
      // A redirect could point anywhere, including somewhere validateWebhookUrl refused.
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message?.slice(0, 200) ?? "request failed" };
  }
}

/** Send one delivery attempt and record the outcome. Safe to call from anywhere. */
export async function attemptDelivery(id: string): Promise<void> {
  const delivery = await claimDelivery(id);
  if (!delivery) return;

  const db = admin.firestore();
  const ref = db.collection(WEBHOOK_DELIVERIES_COLLECTION).doc(id);
  const [endpointSnap, eventSnap] = await Promise.all([
    db.collection(WEBHOOK_ENDPOINTS_COLLECTION).doc(delivery.endpointId).get(),
    db.collection(API_EVENTS_COLLECTION).doc(delivery.eventId).get(),
  ]);
  const endpoint = endpointSnap.data() as WebhookEndpoint | undefined;
  const event = eventSnap.data() as ApiEvent | undefined;
  if (!endpoint || !endpoint.enabled || !event) {
    await ref.update({ status: "canceled", leaseUntil: admin.firestore.FieldValue.delete() });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(decrypt(endpoint.secretEnc), event.payload, timestamp);
  const result = await send(endpoint.url, event.payload, signature, delivery.eventId);
  const attempts = delivery.attempts + 1;
  const now = admin.firestore.Timestamp.now();

  if (result.ok) {
    await ref.update({
      status: "delivered",
      attempts,
      deliveredAt: now,
      lastStatusCode: result.status,
      leaseUntil: admin.firestore.FieldValue.delete(),
    });
    return;
  }

  const giveUp = attempts >= MAX_ATTEMPTS;
  await ref.update({
    status: giveUp ? "failed" : "pending",
    attempts,
    lastError: result.error,
    ...(result.status ? { lastStatusCode: result.status } : {}),
    nextAttemptAt: giveUp
      ? now
      : admin.firestore.Timestamp.fromMillis(now.toMillis() + RETRY_DELAYS_SECONDS[attempts - 1] * 1000),
    leaseUntil: admin.firestore.FieldValue.delete(),
  });
  if (giveUp) {
    console.error(`Webhook delivery ${id} failed after ${attempts} attempts: ${result.error}`);
  }
}

// ─── Functions ─────────────────────────────────────────────────────────────

export const onApiChargeWritten = onDocumentWritten(
  { document: `api_charges/{chargeId}`, secrets: [ENCRYPTION_KEY] },
  async (event) => {
    const chargeId = event.params.chargeId;
    const before = event.data?.before.data() as ApiCharge | undefined;
    const after = event.data?.after.data() as ApiCharge | undefined;
    const pending = eventsForChange(chargeId, before, after);
    if (pending.length === 0 || !after) return;

    for (const p of pending) {
      const deliveryIds = await recordEvent(chargeId, after, p);
      await Promise.all(deliveryIds.map((id) => attemptDelivery(id)));
    }
  }
);

export const retryWebhookDeliveries = onSchedule(
  { schedule: "every 5 minutes", secrets: [ENCRYPTION_KEY] },
  async () => {
    const due = await admin
      .firestore()
      .collection(WEBHOOK_DELIVERIES_COLLECTION)
      .where("status", "==", "pending")
      .where("nextAttemptAt", "<=", admin.firestore.Timestamp.now())
      .orderBy("nextAttemptAt")
      .limit(100)
      .get();
    // In parallel, so a slow merchant server holds up only its own
    // deliveries; each attempt is capped by DELIVERY_TIMEOUT_MS.
    await Promise.all(due.docs.map((d) => attemptDelivery(d.id).catch((err) => {
      console.error(`Webhook retry ${d.id} errored:`, err);
    })));
  }
);
