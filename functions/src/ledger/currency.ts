/**
 * Currencies in the ledger (SHILLINGS.md).
 *
 * Every journal entry is in one currency, and amounts are that currency's
 * smallest unit: cents for USD, whole shillings for SLS. An account holds a
 * separate balance per currency. Dollar balances keep the projections they
 * always had, so nothing written before shillings moves:
 *
 *   USD  user:{uid}  → wallets/{uid}.balance
 *        other       → ledger_balances/{account}
 *   SLS  user:{uid}  → wallets/{uid}.sls.balance
 *        other       → ledger_balances/{account}@SLS
 */

import { LedgerCurrency } from "./types";

export const LEDGER_CURRENCIES: readonly LedgerCurrency[] = ["USD", "SLS"];

export function isLedgerCurrency(value: unknown): value is LedgerCurrency {
  return typeof value === "string" && (LEDGER_CURRENCIES as readonly string[]).includes(value);
}

/**
 * The key one account's balance in one currency is kept under: the
 * `ledger_balances` doc id, and the invariant check's replay key.
 */
export function balanceKey(account: string, currency: LedgerCurrency): string {
  return currency === "USD" ? account : `${account}@${currency}`;
}

/** The account and currency behind a balance key. */
export function parseBalanceKey(key: string): { account: string; currency: LedgerCurrency } {
  const at = key.lastIndexOf("@");
  if (at > 0) {
    const currency = key.slice(at + 1);
    if (isLedgerCurrency(currency)) return { account: key.slice(0, at), currency };
  }
  return { account: key, currency: "USD" };
}
