/**
 * Merchant Payments API — stored shapes.
 *
 * Every collection here is server-only (see firestore.rules). Merchants reach
 * them through the `api` HTTPS function with an API key; customers reach a
 * charge through the getApiCharge / approveApiCharge callables; the console
 * reaches keys through the admin callables.
 */

export const API_KEYS_COLLECTION = "merchant_api_keys";
export const API_CHARGES_COLLECTION = "api_charges";
export const API_REFUNDS_COLLECTION = "api_refunds";
export const API_IDEMPOTENCY_COLLECTION = "api_idempotency";
export const API_RATE_LIMITS_COLLECTION = "api_rate_limits";
export const API_EVENTS_COLLECTION = "api_events";
export const WEBHOOK_ENDPOINTS_COLLECTION = "webhook_endpoints";
export const WEBHOOK_DELIVERIES_COLLECTION = "webhook_deliveries";

/**
 * A merchant's API key. The document ID is the SHA-256 of the key, so the key
 * itself is never stored: authenticating is one document read by hash, and a
 * leaked Firestore export does not leak working keys.
 */
export interface MerchantApiKey {
  merchantId: string;
  label: string;
  /** `zpk_live_abcd…wxyz`, for telling keys apart in the console. */
  hint: string;
  revoked: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  /** Admin uid who issued the key. */
  createdBy: string;
  revokedAt?: FirebaseFirestore.Timestamp;
  revokedBy?: string;
  lastUsedAt?: FirebaseFirestore.Timestamp;
}

/**
 * `pending` resolves exactly once, to one of the other three. `succeeded` is
 * the only status with money behind it; refunds are tracked on the charge
 * (`amountRefunded`) rather than as a status, so a partly refunded charge
 * still reads `succeeded`.
 */
export type ApiChargeStatus = "pending" | "succeeded" | "expired" | "canceled";

export interface ApiCharge {
  merchantId: string;
  /** Denormalised for the hosted checkout page and the approval screen. */
  merchantName: string;
  /** Key hash that raised the charge. */
  keyId: string;
  amount: number; // Integer cents
  currency: "USD";
  status: ApiChargeStatus;
  reference?: string;
  metadata?: Record<string, string>;
  customerPhone?: string;
  /**
   * Set when `customerPhone` matched a Zapp account. Only that customer may
   * then pay the charge — the merchant addressed it to them.
   */
  customerId?: string;
  successUrl?: string;
  cancelUrl?: string;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  succeededAt?: FirebaseFirestore.Timestamp;
  canceledAt?: FirebaseFirestore.Timestamp;
  expiredAt?: FirebaseFirestore.Timestamp;
  /** Customer who approved it. */
  paidBy?: string;
  transactionId?: string;
  journalEntryId?: string;
  feeCents?: number;
  netCents?: number;
  /** Cents returned to the customer so far, across partial refunds. */
  amountRefunded: number;
  /** Of the fee, cents the platform has handed back so far. */
  feeRefunded: number;
  refundCount: number;
}

export interface ApiRefund {
  chargeId: string;
  merchantId: string;
  customerId: string;
  amount: number;
  /** Platform fee handed back with this refund. */
  feeReturned: number;
  reason?: string;
  journalEntryId: string;
  transactionId: string;
  keyId: string;
  createdAt: FirebaseFirestore.Timestamp;
}

/** Maps a merchant's Idempotency-Key to the object its first request made. */
export interface ApiIdempotencyRecord {
  merchantId: string;
  scope: "charge" | "refund";
  /** Hash of the normalised request, so a reused key with a different body is refused. */
  requestHash: string;
  objectId: string;
  createdAt: FirebaseFirestore.Timestamp;
}

export type WebhookEventType =
  | "charge.succeeded"
  | "charge.expired"
  | "charge.canceled"
  | "charge.refunded";

export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  "charge.succeeded",
  "charge.expired",
  "charge.canceled",
  "charge.refunded",
];

export interface WebhookEndpoint {
  merchantId: string;
  url: string;
  /** Signing secret, encrypted with ENCRYPTION_KEY (utils/encryption). */
  secretEnc: string;
  enabled: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  disabledAt?: FirebaseFirestore.Timestamp;
}

export interface ApiEvent {
  type: WebhookEventType;
  merchantId: string;
  chargeId: string;
  /**
   * The exact JSON body every delivery sends. Stored rather than rebuilt so a
   * retry three hours later signs and sends the same bytes the first attempt did.
   */
  payload: string;
  createdAt: FirebaseFirestore.Timestamp;
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "canceled";

export interface WebhookDelivery {
  eventId: string;
  endpointId: string;
  merchantId: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: FirebaseFirestore.Timestamp;
  /** Held by whichever worker is sending, so the retry job and the trigger never both send. */
  leaseUntil?: FirebaseFirestore.Timestamp;
  lastStatusCode?: number;
  lastError?: string;
  deliveredAt?: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
}
