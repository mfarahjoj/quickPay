/**
 * Per-key rate limiting and Idempotency-Key handling for the public API.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import type { Request } from "firebase-functions/v2/https";
import { ApiError, badRequest, header } from "./http";
import { API_RATE_LIMITS_COLLECTION } from "./types";

const MINUTE_MS = 60 * 1000;

/**
 * Fixed one-minute window per key.
 *
 * A blind increment followed by a read, not a transaction: a busy till makes
 * several calls a second, and transactions on one counter doc would contend
 * and retry. The read can lag a concurrent increment by a request or two,
 * which is fine for a rate limit — it is not what keeps money safe.
 *
 * Counter docs carry `expireAt` for a Firestore TTL policy on
 * `api_rate_limits` (set once in the console); without one they are tiny and
 * merely accumulate.
 */
export async function enforceApiRateLimit(
  keyId: string,
  perMinute: number,
  now: number = Date.now()
): Promise<void> {
  const bucket = Math.floor(now / MINUTE_MS);
  const ref = admin
    .firestore()
    .collection(API_RATE_LIMITS_COLLECTION)
    .doc(`${keyId.slice(0, 32)}_${bucket}`);

  await ref.set(
    {
      count: admin.firestore.FieldValue.increment(1),
      expireAt: admin.firestore.Timestamp.fromMillis((bucket + 2) * MINUTE_MS),
    },
    { merge: true }
  );
  const count = (await ref.get()).data()?.count ?? 0;

  if (count > perMinute) {
    throw new ApiError(
      429,
      "rate_limit_error",
      "rate_limited",
      `Too many requests. This key may make ${perMinute} requests per minute.`
    );
  }
}

/**
 * Printable ASCII, 8–255 characters. Merchants use UUIDs or their own order
 * numbers; the key is hashed before it reaches a document ID, so it may carry
 * characters a Firestore path could not.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,255}$/;

export function requireIdempotencyKeyHeader(req: Request): string {
  const key = header(req, "idempotency-key");
  if (!key) {
    throw badRequest(
      "idempotency_key_required",
      "Send an Idempotency-Key header (e.g. a UUID) so a retried request can never charge twice"
    );
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw badRequest(
      "idempotency_key_invalid",
      "Idempotency-Key must be 8-255 printable ASCII characters"
    );
  }
  return key;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Scoped to the merchant, so two merchants choosing the same key (both
 * starting their order numbers at 1001) can never see each other's objects.
 */
export function idempotencyDocId(merchantId: string, scope: string, key: string): string {
  return sha256(`${merchantId}\n${scope}\n${key}`);
}

/** JSON with sorted keys, so field order in the request never changes the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function requestFingerprint(normalised: unknown): string {
  return sha256(stableStringify(normalised));
}

export function idempotencyMismatch(): ApiError {
  return new ApiError(
    422,
    "idempotency_error",
    "idempotency_key_reused",
    "This Idempotency-Key was already used with different parameters"
  );
}
