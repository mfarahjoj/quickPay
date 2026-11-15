/**
 * Cash-in and cash-out at agents in dollars or shillings (SHILLINGS.md,
 * CASH_IN_CASH_OUT.md).
 *
 * A request is in one currency from start to finish: the customer picks it,
 * the agent's float in that currency pays or receives it, and nothing is ever
 * converted. Limits stay in dollars, so a shilling amount is compared at
 * `slsPerUsd`.
 */

import { https } from "firebase-functions/v2";
import { Currency, formatAmount, parseCurrency, toLimitCents } from "../utils/money";

/** The currency a customer asked for: dollars when an older app sends none. */
export function requestCurrency(value: unknown): Currency {
  const currency = parseCurrency(value);
  if (!currency) {
    throw new https.HttpsError("invalid-argument", "Currency must be USD or SLS");
  }
  return currency;
}

/** The currency stored on a request; requests from before shillings say "USD". */
export function storedCurrency(value: unknown): Currency {
  return parseCurrency(value) ?? "USD";
}

/**
 * Refuse an amount outside [minCents, maxCents] dollars, comparing a shilling
 * amount at the limits rate. The message names the range in dollars, which
 * is how the limits are set.
 */
export function assertAmountInRange(
  amount: number,
  currency: Currency,
  slsPerUsd: number,
  minCents: number,
  maxCents: number,
  what: string
): void {
  const cents = toLimitCents(amount, currency, slsPerUsd);
  if (cents < minCents) {
    throw new https.HttpsError("invalid-argument", `Minimum ${what} is ${formatAmount(minCents, "USD")}`);
  }
  if (cents > maxCents) {
    throw new https.HttpsError("invalid-argument", `Maximum ${what} is ${formatAmount(maxCents, "USD")}`);
  }
}

/**
 * Agents' apps that understand shillings say so in every cash-in and cash-out
 * call (`currencies: ["USD", "SLS"]`). An older Zapp Pay Merchant reads every
 * amount as cents and would show 30,000 shillings as "$300.00", and the agent
 * hands over cash from that screen. So a shilling request is refused to an
 * app that hasn't said it reads shillings; dollars work as before.
 */
export function assertAgentAppReads(currency: Currency, currencies: unknown): void {
  if (currency === "USD") return;
  if (Array.isArray(currencies) && currencies.includes(currency)) return;
  throw new https.HttpsError(
    "failed-precondition",
    "This customer's request is in shillings. Update Zapp Pay Merchant to handle it.",
    { reason: "update_for_shillings" }
  );
}
