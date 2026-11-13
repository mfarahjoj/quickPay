/**
 * Fixed one-minute windows for the counter display's callables.
 *
 * The same blind increment then read as the public API's limiter
 * (api/requestGuards.ts): a counter that can lag a concurrent request by one
 * or two is fine for a rate limit, and no transaction means no contention.
 * Counter docs carry `expireAt` for a Firestore TTL policy on
 * `display_rate_limits`.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { DISPLAY_RATE_LIMITS } from "./types";

const MINUTE_MS = 60 * 1000;

export async function enforceDisplayRateLimit(
  key: string,
  perMinute: number,
  now: number = Date.now()
): Promise<void> {
  const bucket = Math.floor(now / MINUTE_MS);
  const ref = admin
    .firestore()
    .collection(DISPLAY_RATE_LIMITS)
    .doc(`${key.slice(0, 64)}_${bucket}`);

  await ref.set(
    {
      count: admin.firestore.FieldValue.increment(1),
      expireAt: admin.firestore.Timestamp.fromMillis((bucket + 2) * MINUTE_MS),
    },
    { merge: true }
  );
  const count = (await ref.get()).data()?.count ?? 0;
  if (count > perMinute) {
    throw new https.HttpsError(
      "resource-exhausted",
      "Too many requests from this screen. Wait a minute and try again.",
      { reason: "rate_limited" }
    );
  }
}

/**
 * A key for the caller's network address, hashed so no IP is stored. Used
 * only before a tablet has an id of its own (starting a pairing).
 */
export function callerIpKey(request: https.CallableRequest): string {
  const raw = request.rawRequest;
  const forwarded = raw?.headers?.["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") ||
    raw?.ip ||
    "unknown";
  return "ip_" + crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}
