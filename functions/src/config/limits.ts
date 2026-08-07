/**
 * Transaction limits — the single source of truth.
 *
 * These used to live in two places that disagreed: `getAccountLimits` showed
 * customers one table while `validateTransactionLimit` enforced different
 * inline thresholds (a rejected account was told $50 and allowed $100), and
 * the daily and monthly figures were advertised but never enforced at all.
 *
 * Stored at Firestore `config/limits` so they can be tuned during the pilot
 * without a redeploy, exactly like `config/rates`.
 */

import * as admin from "firebase-admin";

export interface TierLimits {
  /** Largest single transaction, in cents. */
  perTransaction: number;
  /** Most a user may send in a calendar day, in cents. */
  daily: number;
  /** Most a user may send in a calendar month, in cents. */
  monthly: number;
}

export type LimitTier =
  | "unverified"
  | "verified"
  | "rejected"
  | "merchant"
  | "agent";

export type Limits = Record<LimitTier, TierLimits>;

export const DEFAULT_LIMITS: Limits = {
  // KYC not yet done: enough to try the product, not enough to be worth
  // stealing an account for.
  unverified: { perTransaction: 10000, daily: 50000, monthly: 500000 },
  verified: { perTransaction: 100000, daily: 500000, monthly: 5000000 },
  // A rejected document is a signal, so this tier is tighter than unverified.
  rejected: { perTransaction: 5000, daily: 20000, monthly: 200000 },
  /** A business pays suppliers and staff; consumer caps would block payroll. */
  merchant: { perTransaction: 100000, daily: 2000000, monthly: 20000000 },
  /**
   * Agents move far more value than customers by design, and their outflow is
   * already bounded by float they have paid for. Customer-scale caps would
   * simply break the agent network.
   */
  agent: { perTransaction: 100000, daily: 5000000, monthly: 50000000 },
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { limits: Limits; expiresAt: number } | null = null;

/** A limit must be a non-negative integer number of cents. */
function coerceCents(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function coerceTier(value: unknown, fallback: TierLimits): TierLimits {
  const data = (value ?? {}) as Record<string, unknown>;
  return {
    perTransaction: coerceCents(data.perTransaction, fallback.perTransaction),
    daily: coerceCents(data.daily, fallback.daily),
    monthly: coerceCents(data.monthly, fallback.monthly),
  };
}

/** Read the current limits, cached in memory, falling back to defaults. */
export async function getLimits(): Promise<Limits> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.limits;
  }

  try {
    const snap = await admin.firestore().collection("config").doc("limits").get();
    const data = snap.exists ? snap.data() ?? {} : {};
    const limits: Limits = {
      unverified: coerceTier(data.unverified, DEFAULT_LIMITS.unverified),
      verified: coerceTier(data.verified, DEFAULT_LIMITS.verified),
      rejected: coerceTier(data.rejected, DEFAULT_LIMITS.rejected),
      merchant: coerceTier(data.merchant, DEFAULT_LIMITS.merchant),
      agent: coerceTier(data.agent, DEFAULT_LIMITS.agent),
    };
    cached = { limits, expiresAt: now + CACHE_TTL_MS };
    return limits;
  } catch (error) {
    console.error("Failed to load config/limits, using defaults:", error);
    return DEFAULT_LIMITS;
  }
}

/**
 * Which tier an account falls into.
 *
 * The elevated business tiers require verified identity: holding a merchant or
 * agent role is not on its own a reason to trust an account with more money,
 * and tying the raise to KYC is what makes verification mean something for
 * businesses as well as consumers.
 */
export function tierFor(kycStatus: unknown, accountType: unknown): LimitTier {
  if (kycStatus === "verified") {
    if (accountType === "topup_agent" || accountType === "agent_merchant") {
      return "agent";
    }
    if (accountType === "merchant") return "merchant";
    return "verified";
  }
  if (kycStatus === "rejected") return "rejected";
  // "pending" and "submitted" both mean not yet verified.
  return "unverified";
}

/** Convenience: the limits that apply to one account. */
export async function limitsFor(
  kycStatus: unknown,
  accountType: unknown
): Promise<{ tier: LimitTier; limits: TierLimits }> {
  const all = await getLimits();
  const tier = tierFor(kycStatus, accountType);
  return { tier, limits: all[tier] };
}
