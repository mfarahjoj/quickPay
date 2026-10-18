import * as admin from "firebase-admin";

/**
 * Platform ledger account. Payment fees are credited here and agent
 * commissions are debited from here, so the doc nets out the platform P&L.
 */
export const PLATFORM_ACCOUNT_ID = "platform";

/**
 * Fee / commission rates. Stored in Firestore at config/rates so they can be
 * tuned without a redeploy. These defaults are used when the doc is missing.
 */
export interface Rates {
  /** Fraction of a payment kept as the platform fee (merchant absorbs it). */
  paymentFeeRate: number;
  /** Fraction of a top-up paid to the agent as commission. */
  topupCommissionRate: number;
  /**
   * Float issuance at or above this many cents needs a second admin to
   * approve it. Below it, one ops admin may approve their own request —
   * still audited. Tunable without a redeploy because the right threshold
   * depends on how much float agents actually buy.
   */
  floatApprovalThresholdCents: number;
  /**
   * How long a merchant's charge stays payable after it is raised. Short on
   * purpose: the customer is standing at the counter, and a merchant who
   * gives up waiting and takes cash must not be paid a second time by an
   * approval that lands afterwards.
   */
  paymentRequestTtlSeconds: number;
  /**
   * After a PIN reset, outgoing money is paused this long. A reset proves only
   * that someone holds the phone number, which a thief or a SIM swap also
   * does; the pause stops a takeover draining the wallet before the owner
   * notices.
   */
  pinResetCooldownHours: number;
  /**
   * What may still be spent at shops during that pause, in total, so someone
   * who genuinely forgot their PIN isn't stranded at the counter.
   */
  pinResetCooldownAllowanceCents: number;
  /**
   * Fraction kept as the platform fee on a payment taken through the
   * merchant API (hosted checkout or a POS integration). Separate from
   * paymentFeeRate so online pricing can move without touching the counter.
   */
  onlinePaymentFeeRate: number;
  /**
   * How long an API charge stays payable unless the merchant asks for less.
   * Longer than paymentRequestTtlSeconds: an online shopper has to find their
   * phone, open the app and scan, and nobody is waiting at a counter.
   */
  apiChargeTtlSeconds: number;
  /** Requests one merchant API key may make per minute. */
  apiRequestsPerMinute: number;
  /**
   * How many days after a shop payment the merchant may still refund it from
   * the app. Past that, a return goes through support, where the books for
   * that period may already have been reconciled.
   */
  refundWindowDays: number;
  /**
   * Disputes (D6, D7): how many days after a transaction one may be opened,
   * how long the other party has to reply before it goes to ops, and how
   * long ops have to resolve it, counted from opening.
   */
  disputeWindowDays: number;
  disputeResponseHours: number;
  disputeResolutionHours: number;
  /**
   * Agent standing (plan 2.6): this many upheld disputes against an agent
   * within agentFlagWindowDays takes them out of Find Agent until ops review.
   */
  agentFlagUpheldDisputes: number;
  agentFlagWindowDays: number;
}

export const DEFAULT_RATES: Rates = {
  paymentFeeRate: 0.01,
  topupCommissionRate: 0.02,
  floatApprovalThresholdCents: 50000, // $500
  paymentRequestTtlSeconds: 90,
  pinResetCooldownHours: 24,
  pinResetCooldownAllowanceCents: 2000, // $20
  onlinePaymentFeeRate: 0.01,
  apiChargeTtlSeconds: 900, // 15 minutes
  apiRequestsPerMinute: 120,
  refundWindowDays: 30,
  disputeWindowDays: 60,
  disputeResponseHours: 72,
  disputeResolutionHours: 168,
  agentFlagUpheldDisputes: 3,
  agentFlagWindowDays: 30,
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { rates: Rates; expiresAt: number } | null = null;

function coerceRate(value: unknown, fallback: number): number {
  // Reject anything that isn't a sane fraction in [0, 1).
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
    return value;
  }
  return fallback;
}

/**
 * Coerce a whole-cents threshold. Unlike a rate this is not bounded above,
 * but it must be a non-negative integer — a fractional or negative threshold
 * would silently disable maker-checker.
 */
function coerceCents(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

/**
 * Coerce a whole number into [min, max]. Out-of-range values fall
 * back rather than clamp: a typo of 9000 should not quietly become the max.
 */
function coerceIntInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) {
    return value;
  }
  return fallback;
}

/**
 * Read the current rates, cached in-memory for CACHE_TTL_MS to avoid a Firestore
 * read on every money-path invocation. Falls back to DEFAULT_RATES on any error.
 */
export async function getRates(): Promise<Rates> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.rates;
  }

  try {
    const snap = await admin.firestore().collection("config").doc("rates").get();
    const data = snap.exists ? snap.data() ?? {} : {};
    const rates: Rates = {
      paymentFeeRate: coerceRate(data.paymentFeeRate, DEFAULT_RATES.paymentFeeRate),
      topupCommissionRate: coerceRate(
        data.topupCommissionRate,
        DEFAULT_RATES.topupCommissionRate
      ),
      floatApprovalThresholdCents: coerceCents(
        data.floatApprovalThresholdCents,
        DEFAULT_RATES.floatApprovalThresholdCents
      ),
      paymentRequestTtlSeconds: coerceIntInRange(
        data.paymentRequestTtlSeconds,
        DEFAULT_RATES.paymentRequestTtlSeconds,
        30,
        600
      ),
      // Bounded so a typo can't switch the pause off (0) or freeze a wallet
      // for weeks.
      pinResetCooldownHours: coerceIntInRange(
        data.pinResetCooldownHours,
        DEFAULT_RATES.pinResetCooldownHours,
        1,
        168
      ),
      pinResetCooldownAllowanceCents: coerceCents(
        data.pinResetCooldownAllowanceCents,
        DEFAULT_RATES.pinResetCooldownAllowanceCents
      ),
      onlinePaymentFeeRate: coerceRate(
        data.onlinePaymentFeeRate,
        DEFAULT_RATES.onlinePaymentFeeRate
      ),
      // A minute is the least a shopper needs to scan; a day is the most a
      // merchant should leave an order payable without re-raising it.
      apiChargeTtlSeconds: coerceIntInRange(
        data.apiChargeTtlSeconds,
        DEFAULT_RATES.apiChargeTtlSeconds,
        60,
        86400
      ),
      apiRequestsPerMinute: coerceIntInRange(
        data.apiRequestsPerMinute,
        DEFAULT_RATES.apiRequestsPerMinute,
        10,
        6000
      ),
      refundWindowDays: coerceIntInRange(
        data.refundWindowDays,
        DEFAULT_RATES.refundWindowDays,
        1,
        365
      ),
      disputeWindowDays: coerceIntInRange(data.disputeWindowDays, DEFAULT_RATES.disputeWindowDays, 1, 365),
      disputeResponseHours: coerceIntInRange(
        data.disputeResponseHours,
        DEFAULT_RATES.disputeResponseHours,
        1,
        720
      ),
      agentFlagUpheldDisputes: coerceIntInRange(
        data.agentFlagUpheldDisputes,
        DEFAULT_RATES.agentFlagUpheldDisputes,
        1,
        50
      ),
      agentFlagWindowDays: coerceIntInRange(data.agentFlagWindowDays, DEFAULT_RATES.agentFlagWindowDays, 1, 365),
      disputeResolutionHours: coerceIntInRange(
        data.disputeResolutionHours,
        DEFAULT_RATES.disputeResolutionHours,
        1,
        2160
      ),
    };
    cached = { rates, expiresAt: now + CACHE_TTL_MS };
    return rates;
  } catch (error) {
    console.error("Failed to load config/rates, using defaults:", error);
    return DEFAULT_RATES;
  }
}

/** Platform fee on a payment, in whole cents (never exceeds the amount). */
export function computePaymentFee(amountCents: number, rate: number): number {
  const fee = Math.round(amountCents * rate);
  return Math.min(Math.max(fee, 0), amountCents);
}

/** Agent commission on a top-up, in whole cents. */
export function computeCommission(amountCents: number, rate: number): number {
  return Math.max(Math.round(amountCents * rate), 0);
}
