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
}

export const DEFAULT_RATES: Rates = {
  paymentFeeRate: 0.01,
  topupCommissionRate: 0.02,
  floatApprovalThresholdCents: 50000, // $500
  paymentRequestTtlSeconds: 90,
  pinResetCooldownHours: 24,
  pinResetCooldownAllowanceCents: 2000, // $20
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
