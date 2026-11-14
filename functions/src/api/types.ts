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
export const API_TRANSFERS_COLLECTION = "api_transfers";
export const API_PARTNERS_COLLECTION = "api_partners";
export const API_AGREEMENTS_COLLECTION = "api_agreements";
/** Under an agreement: `api_agreements/{id}/days/{YYYY-MM-DD}`. */
export const AGREEMENT_DAYS_SUBCOLLECTION = "days";
/** Under a partner: `api_partners/{merchantId}/transfer_days/{YYYY-MM-DD}`. */
export const TRANSFER_DAYS_SUBCOLLECTION = "transfer_days";

/**
 * What a key may do beyond charges and refunds. Only the console grants a
 * scope, and only to a partner; keys a merchant makes for themselves have none.
 */
export type ApiKeyScope = "transfers" | "agreements";

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
  /**
   * False for a `zpk_test_` key. Absent on keys issued before test mode
   * existed, which are all live — read it through `isLiveObject`.
   */
  livemode?: boolean;
  revoked: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  /** Uid that made the key: an ops admin, or the merchant themselves. */
  createdBy: string;
  /** Where the key was made. Absent on keys from before self-serve (all console). */
  createdVia?: "console" | "merchant_app";
  revokedAt?: FirebaseFirestore.Timestamp;
  revokedBy?: string;
  lastUsedAt?: FirebaseFirestore.Timestamp;
  /** Absent: charges and refunds only. */
  scopes?: ApiKeyScope[];
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
  /**
   * False when a test key raised it: no customer can pay it, it settles only
   * through the test helpers, and live keys cannot see it. Absent on charges
   * from before test mode, which are all live — read it through `isLiveObject`.
   */
  livemode?: boolean;
  /** Denormalised for the hosted checkout page and the approval screen. */
  merchantName: string;
  /** Key hash that raised the charge. */
  keyId: string;
  /** In the currency's smallest unit: cents, or whole shillings. */
  amount: number;
  /** The ledger's code. The API shows SLS as "SLSH". */
  currency: "USD" | "SLS";
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
  /** The agreement a partner raised this charge on (agreements.ts). */
  agreementId?: string;
  /** Set only on agreement charges: how far paying in the partner's app got. */
  autoPay?: ChargeAutoPay;
  /** Cents returned to the customer so far, across partial refunds. */
  amountRefunded: number;
  /** Of the fee, cents the platform has handed back so far. */
  feeRefunded: number;
  refundCount: number;
}

export interface ApiRefund {
  chargeId: string;
  merchantId: string;
  livemode?: boolean;
  /** The customer refunded. Absent in test mode, where nobody paid. */
  customerId?: string;
  /** In the charge's currency. */
  amount: number;
  /** The charge's currency. Absent on refunds from before shillings: USD. */
  currency?: "USD" | "SLS";
  /** Platform fee handed back with this refund. */
  feeReturned: number;
  reason?: string;
  /** Absent in test mode: a test refund posts nothing. */
  journalEntryId?: string;
  transactionId?: string;
  keyId: string;
  createdAt: FirebaseFirestore.Timestamp;
}

/** Objects stored before test mode have no `livemode` and are all live. */
export function isLiveObject(obj: { livemode?: boolean }): boolean {
  return obj.livemode !== false;
}

/** Maps a merchant's Idempotency-Key to the object its first request made. */
export interface ApiIdempotencyRecord {
  merchantId: string;
  scope: "charge" | "refund" | "transfer" | "agreement";
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
  /** Test endpoints hear only test charges, live only live. Absent = live. */
  livemode?: boolean;
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

/**
 * A merchant ops has made a partner: a platform (Ridy) that collects from its
 * customers and pays people out of its own wallet, by API, with no PIN. Set
 * only from the console. Caps are in US cents; shillings count at
 * `config/rates.slsPerUsd`, the same as every other limit.
 */
export interface ApiPartner {
  /** Transfers and account lookups are allowed while this is true. */
  transfersEnabled: boolean;
  /** Largest single transfer, in US cents. */
  maxTransferUsdCents: number;
  /** Most the partner may transfer per local day, in US cents. */
  dailyTransferUsdCents: number;
  /**
   * Zapp's fee on this partner's charges, as a fraction (0.01 = 1%). Absent:
   * the standard `onlinePaymentFeeRate`. Transfers carry no fee.
   */
  chargeFeeRate?: number;
  /**
   * Phone numbers outside +252 this partner may charge, pay and look up:
   * the Firebase test numbers its testers sign in with on simulators
   * (+447700900123). E.164. Every other number must be +252.
   */
  testPhoneNumbers?: string[];
  /**
   * Agreements (agreements.ts) are allowed while this is true: the partner's
   * customers may link their wallet once and then approve each payment in
   * the partner's app, on their phone, without the Zapp PIN.
   */
  agreementsEnabled?: boolean;
  /** Largest charge an agreement may pay, in US cents. Copied onto each agreement when approved. */
  agreementMaxChargeUsdCents?: number;
  /** Most an agreement may pay per local day, in US cents. Copied likewise. */
  agreementDailyUsdCents?: number;
  updatedAt: FirebaseFirestore.Timestamp;
  updatedBy: string;
}

/** A partner's running total for one local day. */
export interface TransferDay {
  /** Sum of succeeded live transfers, in US cents (shillings converted). */
  usdCents: number;
  count: number;
}

/**
 * Settled the moment it is made: `succeeded` (money moved) or `failed`
 * (nothing moved — the recipient could not receive). Refusals that may pass on
 * a retry (balance, caps, a frozen partner) are errors and leave no transfer,
 * so the same Idempotency-Key can be retried later.
 */
export type ApiTransferStatus = "succeeded" | "failed";

export type TransferFailureCode = "recipient_not_found" | "recipient_inactive";

export interface ApiTransfer {
  merchantId: string;
  livemode: boolean;
  keyId: string;
  amount: number;
  currency: "USD" | "SLS";
  status: ApiTransferStatus;
  destinationPhone: string;
  /** Who was paid. Absent when failed, and in test mode. */
  recipientId?: string;
  failureCode?: TransferFailureCode;
  reference?: string;
  metadata?: Record<string, string>;
  journalEntryId?: string;
  transactionId?: string;
  createdAt: FirebaseFirestore.Timestamp;
}

/** pending → active → revoked, or pending → expired. Never back. */
export type ApiAgreementStatus = "pending" | "active" | "revoked" | "expired";

/**
 * A customer's standing permission for one partner to charge their wallet,
 * each payment approved on the customer's phone by a hardware key the
 * partner's app holds (agreements.ts). The customer grants it once, in Zapp,
 * with their PIN.
 */
export interface ApiAgreement {
  merchantId: string;
  merchantName: string;
  livemode: boolean;
  /** API key hash that created it. */
  keyId: string;
  /** Who the partner addressed it to; only that customer may approve it. */
  customerPhone: string;
  /** Set when approved. */
  customerId?: string;
  status: ApiAgreementStatus;
  /** EC P-256 public key, base64 SPKI DER. Every payment must be signed by its private half. */
  devicePublicKey: string;
  /** e.g. "iPhone 15". Display only. */
  deviceLabel?: string;
  /** Copied from the partner when approved, so raising a partner's caps never raises an existing agreement's. US cents. */
  maxChargeUsdCents?: number;
  dailyUsdCents?: number;
  reference?: string;
  createdAt: FirebaseFirestore.Timestamp;
  /** Until when a pending agreement may be approved. */
  expiresAt: FirebaseFirestore.Timestamp;
  approvedAt?: FirebaseFirestore.Timestamp;
  revokedAt?: FirebaseFirestore.Timestamp;
  revokedBy?: "customer" | "merchant" | "ops" | "replaced";
}

/** An agreement's running total for one local day. */
export interface AgreementDay {
  usdCents: number;
  count: number;
}

/** Why an agreement charge was not paid in the partner's app; the charge stays pending. */
export type AutoDeclineCode =
  | "agreement_not_active"
  | "customer_mismatch"
  | "over_charge_limit"
  | "over_daily_limit"
  | "insufficient_balance"
  | "customer_limit"
  | "account_unavailable";

export interface ChargeAutoPay {
  status: "requires_confirmation" | "declined" | "paid";
  declinedCode?: AutoDeclineCode;
  /** Confirms refused for a bad signature. */
  badSignatures?: number;
}
