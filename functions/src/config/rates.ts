import * as admin from "firebase-admin";

/**
 * Platform ledger account. Payment fees are credited here and agent
 * commissions are debited from here, so the doc nets out the platform P&L.
 */
export const PLATFORM_ACCOUNT_ID = "platform";

/** When a referral bonus is paid (decision D3). */
export type ReferralUnlock = "first_cash_in" | "kyc_verified" | "off";

/**
 * Prices and rules, stored in Firestore at config/rates so they can be tuned
 * without a redeploy. Every field is described once, in RATE_FIELDS below,
 * which getRates, the admin editor (adminGetRates / adminUpdateRates) and its
 * validation all read. A missing or out-of-range stored value falls back to
 * the default rather than clamping: a typo of 9000 should not quietly become
 * the maximum.
 */
export interface Rates {
  paymentFeeRate: number;
  onlinePaymentFeeRate: number;
  cashOutFeeRate: number;
  cashInCommissionRate: number;
  cashOutCommissionRate: number;
  roundTripWindowHours: number;
  referralUnlock: ReferralUnlock;
  referralBonusCents: number;
  referralMinCashInCents: number;
  referralMonthlyCapPerReferrer: number;
  payoutTargetHours: number;
  autoPayoutMinCents: number;
  floatApprovalThresholdCents: number;
  paymentRequestTtlSeconds: number;
  apiChargeTtlSeconds: number;
  apiRequestsPerMinute: number;
  pinResetCooldownHours: number;
  pinResetCooldownAllowanceCents: number;
  refundWindowDays: number;
  disputeWindowDays: number;
  disputeResponseHours: number;
  disputeResolutionHours: number;
  agentFlagUpheldDisputes: number;
  agentFlagWindowDays: number;
}

export type RateGroup = "Pricing" | "Agents" | "Referrals" | "Payouts" | "Limits and safety" | "Refunds and disputes";

interface BaseField {
  group: RateGroup;
  label: string;
  help: string;
}
/** A fraction in [0, max], shown to admins as a percentage. */
interface RateField extends BaseField {
  kind: "rate";
  default: number;
  max: number;
}
/** Whole cents in [min, max]. */
interface CentsField extends BaseField {
  kind: "cents";
  default: number;
  min: number;
  max: number;
}
/** A whole number in [min, max]. */
interface IntField extends BaseField {
  kind: "int";
  default: number;
  min: number;
  max: number;
  unit: string;
}
interface EnumField extends BaseField {
  kind: "enum";
  default: string;
  options: { value: string; label: string }[];
}
export type RateFieldSpec = RateField | CentsField | IntField | EnumField;

export const RATE_FIELDS: { [K in keyof Rates]: RateFieldSpec } = {
  paymentFeeRate: {
    group: "Pricing",
    label: "Shop payment fee",
    help: "Kept from every counter payment; the merchant absorbs it.",
    kind: "rate",
    default: 0.01,
    max: 0.1,
  },
  onlinePaymentFeeRate: {
    group: "Pricing",
    label: "Online payment fee",
    help: "Kept from payments taken through the Merchant API.",
    kind: "rate",
    default: 0.01,
    max: 0.1,
  },
  cashOutFeeRate: {
    group: "Pricing",
    label: "Cash-out fee (customer pays)",
    help: "Charged to the customer on top of the cash they take out, held with it and kept by Zapp when the agent confirms. 0% is free cash-out (decision D1).",
    kind: "rate",
    default: 0,
    max: 0.1,
  },
  cashInCommissionRate: {
    group: "Agents",
    label: "Cash-in commission",
    help: "Paid by Zapp to the agent on each top-up they confirm.",
    kind: "rate",
    default: 0.02,
    max: 0.1,
  },
  cashOutCommissionRate: {
    group: "Agents",
    label: "Cash-out commission",
    help: "Paid by Zapp to the agent on each cash-out they confirm. Withheld on round trips (below).",
    kind: "rate",
    default: 0.02,
    max: 0.1,
  },
  roundTripWindowHours: {
    group: "Agents",
    label: "Round-trip window",
    help: "No cash-out commission when the customer cashed in with the same agent within this many hours: otherwise an agent and a friend could loop the same cash and collect commission both ways (finding F1). 0 turns the check off.",
    kind: "int",
    default: 24,
    min: 0,
    max: 168,
    unit: "hours",
  },
  referralUnlock: {
    group: "Referrals",
    label: "When the bonus is paid",
    help: "Paying at sign-up turns new SIM cards into free money (finding F2), so the bonus waits for a real action by the new user (decision D3).",
    kind: "enum",
    default: "first_cash_in",
    options: [
      { value: "first_cash_in", label: "After their first cash-in" },
      { value: "kyc_verified", label: "After their ID is verified" },
      { value: "off", label: "Referral bonuses off" },
    ],
  },
  referralBonusCents: {
    group: "Referrals",
    label: "Bonus to each side",
    help: "Paid to both the new user and the person who invited them.",
    kind: "cents",
    default: 100,
    min: 0,
    max: 2000,
  },
  referralMinCashInCents: {
    group: "Referrals",
    label: "Smallest qualifying cash-in",
    help: "With 'after their first cash-in', a top-up smaller than this doesn't unlock the bonus.",
    kind: "cents",
    default: 500,
    min: 0,
    max: 100000,
  },
  referralMonthlyCapPerReferrer: {
    group: "Referrals",
    label: "Bonuses per inviter per month",
    help: "Beyond this many in a calendar month, the inviter's bonus isn't paid (the new user's still is).",
    kind: "int",
    default: 10,
    min: 0,
    max: 1000,
    unit: "bonuses",
  },
  payoutTargetHours: {
    group: "Payouts",
    label: "Payout time promised to merchants",
    help: "Shown in the merchant app as when a requested payout should arrive (decision D11).",
    kind: "int",
    default: 24,
    min: 1,
    max: 168,
    unit: "hours",
  },
  autoPayoutMinCents: {
    group: "Payouts",
    label: "Smallest automatic payout",
    help: "Merchants who switch on daily automatic payouts choose a balance to keep; nothing is requested unless at least this much is above it.",
    kind: "cents",
    default: 1000,
    min: 500,
    max: 1000000,
  },
  floatApprovalThresholdCents: {
    group: "Limits and safety",
    label: "Second-approver threshold",
    help: "Float, payouts and corrections at or above this, counted over 24 hours, need a second or senior admin.",
    kind: "cents",
    default: 50000,
    min: 0,
    max: 10000000,
  },
  paymentRequestTtlSeconds: {
    group: "Limits and safety",
    label: "Counter charge expiry",
    help: "How long a merchant's charge stays payable. Short, so a shop that gave up and took cash isn't paid twice.",
    kind: "int",
    default: 90,
    min: 30,
    max: 600,
    unit: "seconds",
  },
  apiChargeTtlSeconds: {
    group: "Limits and safety",
    label: "Online charge expiry",
    help: "How long an API charge stays payable unless the merchant asks for less.",
    kind: "int",
    default: 900,
    min: 60,
    max: 86400,
    unit: "seconds",
  },
  apiRequestsPerMinute: {
    group: "Limits and safety",
    label: "API requests per key per minute",
    help: "Rate limit on the Merchant API.",
    kind: "int",
    default: 120,
    min: 10,
    max: 6000,
    unit: "requests",
  },
  pinResetCooldownHours: {
    group: "Limits and safety",
    label: "Pause after a PIN reset",
    help: "Outgoing money is paused this long after a reset, so a SIM-swap thief can't drain the wallet.",
    kind: "int",
    default: 24,
    min: 1,
    max: 168,
    unit: "hours",
  },
  pinResetCooldownAllowanceCents: {
    group: "Limits and safety",
    label: "Shop spending allowed during that pause",
    help: "In total, so someone who forgot their PIN isn't stranded at the counter.",
    kind: "cents",
    default: 2000,
    min: 0,
    max: 100000,
  },
  refundWindowDays: {
    group: "Refunds and disputes",
    label: "Refund window",
    help: "Days a merchant can still refund a counter payment from the app.",
    kind: "int",
    default: 30,
    min: 1,
    max: 365,
    unit: "days",
  },
  disputeWindowDays: {
    group: "Refunds and disputes",
    label: "Dispute window",
    help: "Days after a transaction a dispute can be opened (decision D6).",
    kind: "int",
    default: 60,
    min: 1,
    max: 365,
    unit: "days",
  },
  disputeResponseHours: {
    group: "Refunds and disputes",
    label: "Time to reply to a dispute",
    help: "After this, an unanswered dispute goes to ops (decision D7).",
    kind: "int",
    default: 72,
    min: 1,
    max: 720,
    unit: "hours",
  },
  disputeResolutionHours: {
    group: "Refunds and disputes",
    label: "Time for ops to resolve",
    help: "Counted from opening; overdue disputes are flagged on the desk (decision D7).",
    kind: "int",
    default: 168,
    min: 1,
    max: 2160,
    unit: "hours",
  },
  agentFlagUpheldDisputes: {
    group: "Agents",
    label: "Upheld disputes before an agent is flagged",
    help: "A flagged agent drops out of Find Agent until ops clear them.",
    kind: "int",
    default: 3,
    min: 1,
    max: 50,
    unit: "disputes",
  },
  agentFlagWindowDays: {
    group: "Agents",
    label: "Counted over",
    help: "Days of upheld disputes that count towards a flag.",
    kind: "int",
    default: 30,
    min: 1,
    max: 365,
    unit: "days",
  },
};

export const RATE_KEYS = Object.keys(RATE_FIELDS) as (keyof Rates)[];

export const DEFAULT_RATES: Rates = Object.fromEntries(
  RATE_KEYS.map((k) => [k, RATE_FIELDS[k].default])
) as unknown as Rates;

/** The value if it is valid for the field, else undefined. */
export function validRateValue(spec: RateFieldSpec, value: unknown): number | string | undefined {
  switch (spec.kind) {
    case "rate":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= spec.max
        ? value
        : undefined;
    case "cents":
    case "int":
      return typeof value === "number" && Number.isInteger(value) && value >= spec.min && value <= spec.max
        ? value
        : undefined;
    case "enum":
      return typeof value === "string" && spec.options.some((o) => o.value === value) ? value : undefined;
  }
}

/** Stored values merged over the defaults, field by field. */
export function resolveRates(data: Record<string, unknown>): Rates {
  // Before the split, one topupCommissionRate paid both directions.
  const legacy: Record<string, unknown> = {};
  if (data.topupCommissionRate !== undefined) {
    legacy.cashInCommissionRate = data.topupCommissionRate;
    legacy.cashOutCommissionRate = data.topupCommissionRate;
  }
  const merged = { ...legacy, ...data };
  const out: Record<string, unknown> = {};
  for (const key of RATE_KEYS) {
    out[key] = validRateValue(RATE_FIELDS[key], merged[key]) ?? RATE_FIELDS[key].default;
  }
  return out as unknown as Rates;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { rates: Rates; expiresAt: number } | null = null;

/** Drop the in-memory copy, so this instance reads the next change at once. */
export function clearRatesCache(): void {
  cached = null;
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
    const rates = resolveRates(snap.exists ? snap.data() ?? {} : {});
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
