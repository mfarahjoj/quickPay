/**
 * Chart of accounts — see LEDGER_ARCHITECTURE.md §3.1.
 *
 * Account IDs are `kind:identifier` strings. `user:{uid}` accounts project
 * onto the existing `wallets/{uid}` docs; every other account projects onto
 * `ledger_balances/{accountId}`.
 */

/** Platform revenue: payment fees in, agent commissions out. */
export const PLATFORM_FEES = "platform:fees";

/** Platform marketing spend: referral / signup bonuses. */
export const PLATFORM_PROMO = "platform:promo";

/** Real value held by the agent network backing wallet liabilities. */
export const FLOAT_AGENTS = "float:agents";

/** Money in the company bank account (Stripe payouts land here). */
export const FLOAT_BANK = "float:bank";

/** Value in the company's own Zaad account (none yet — future rail). */
export const FLOAT_ZAAD = "float:zaad";

/** Value in the company's own eDahab account (none yet — future rail). */
export const FLOAT_EDAHAB = "float:edahab";

/** Float account for a mobile-money rail. */
export function mobileMoneyFloat(method: "zaad" | "edahab"): string {
  return method === "zaad" ? FLOAT_ZAAD : FLOAT_EDAHAB;
}

/**
 * How an agent actually paid for float, and therefore which asset account the
 * value landed in.
 *
 * This distinction is the whole point of the float desk: the retired
 * `seed-agent-float.js` script always debited `float:agents` regardless of how
 * the money arrived, so the books could not be reconciled against a real bank
 * or Zaad statement.
 */
export type FloatRoute = "cash" | "zaad" | "edahab" | "bank";

export const FLOAT_ROUTES: readonly FloatRoute[] = ["cash", "zaad", "edahab", "bank"];

export function isFloatRoute(value: unknown): value is FloatRoute {
  return (
    typeof value === "string" && (FLOAT_ROUTES as readonly string[]).includes(value)
  );
}

export function floatAccountForRoute(route: FloatRoute): string {
  switch (route) {
    case "zaad":
      return FLOAT_ZAAD;
    case "edahab":
      return FLOAT_EDAHAB;
    case "bank":
      return FLOAT_BANK;
    case "cash":
      return FLOAT_AGENTS;
  }
}

/** Pass-through leg for no-custody settlements on external rails. */
export const EXTERNAL_CLEARING = "external:clearing";

/**
 * Value deducted from a customer for a pending cash-out, held until the agent
 * confirms (moves to the agent's float) or the request is cancelled/expired
 * (returned to the customer). Must trend to zero.
 */
export const CASHOUT_HOLD = "platform:cashout_hold";

/**
 * Takings a merchant has asked to be paid out, held from the moment they ask
 * until ops has actually sent the transfer. Holding at request time — rather
 * than debiting when the transfer goes out — stops a merchant spending money
 * that is already on its way to their bank, which would leave ops paying out
 * value the wallet no longer has. Must trend to zero: a balance sitting here
 * is money owed to merchants that nobody has sent yet.
 */
export const SETTLEMENT_HOLD = "platform:settlement_hold";

/** Ledger account for a user/merchant/agent wallet. */
export function userAccount(uid: string): string {
  return `user:${uid}`;
}

export function isUserAccount(account: string): boolean {
  return account.startsWith("user:");
}

/** The uid behind a `user:{uid}` account. */
export function userIdOf(account: string): string {
  return account.slice("user:".length);
}

/**
 * User accounts are liabilities and can never go negative (no overdrafts).
 * Platform/float/clearing accounts may swing negative (e.g. promo deficit).
 */
export function enforcesNonNegative(account: string): boolean {
  return isUserAccount(account);
}

const ACCOUNT_RE = /^(user|platform|float|external):[A-Za-z0-9_-]+$/;

export function isValidAccount(account: string): boolean {
  return ACCOUNT_RE.test(account);
}
