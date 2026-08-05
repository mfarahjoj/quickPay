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
}

export const DEFAULT_RATES: Rates = {
  paymentFeeRate: 0.01,
  topupCommissionRate: 0.02,
  floatApprovalThresholdCents: 50000, // $500
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
