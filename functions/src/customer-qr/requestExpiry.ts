import { MerchantPaymentRequest } from "../types";

/**
 * Requests raised before `expiresAt` was stored were payable for five
 * minutes, measured from `createdAt`. Kept so they expire on their old terms
 * instead of instantly.
 */
const LEGACY_REQUEST_TTL_MS = 5 * 60 * 1000;

/** The moment a payment request stops being payable, in epoch millis. */
export function requestExpiryMillis(
  req: Pick<MerchantPaymentRequest, "expiresAt" | "createdAt">
): number {
  return req.expiresAt
    ? req.expiresAt.toMillis()
    : req.createdAt.toMillis() + LEGACY_REQUEST_TTL_MS;
}
