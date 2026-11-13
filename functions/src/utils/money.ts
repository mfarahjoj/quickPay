/**
 * Amounts in more than one currency (SHILLINGS.md).
 *
 * Every amount is an integer in its currency's smallest unit: cents for USD,
 * whole shillings for SLS (the shilling has no coins in use). Nothing here
 * converts money: Zapp never exchanges a wallet's shillings for dollars.
 * `toLimitCents` exists only so a shilling payment counts against limits,
 * which are set in dollars.
 */

import { LedgerCurrency, isLedgerCurrency } from "../ledger";

export type Currency = LedgerCurrency;

/** What the Merchant API and partners call each currency. */
export const API_CURRENCY_CODES: Readonly<Record<Currency, string>> = { USD: "USD", SLS: "SLSH" };

/** The ledger currency for an API code: "USD", "SLSH" (and "SLS"). */
export function currencyFromApiCode(code: unknown): Currency | null {
  if (code === "USD") return "USD";
  if (code === "SLSH" || code === "SLS") return "SLS";
  return null;
}

/** A currency a callable may be asked for. */
export function parseCurrency(value: unknown, fallback: Currency = "USD"): Currency | null {
  if (value === undefined || value === null || value === "") return fallback;
  return isLedgerCurrency(value) ? value : currencyFromApiCode(value);
}

/**
 * [amount] in US cents, for limits only. A shilling amount is rounded up, so
 * splitting a payment in two can never slip under a limit.
 */
export function toLimitCents(amount: number, currency: Currency, slsPerUsd: number): number {
  if (currency === "USD") return amount;
  return Math.ceil((amount * 100) / slsPerUsd);
}

/**
 * A dollar limit expressed in [currency], for telling people what they may
 * send. Shillings are rounded to the nearest 500 (the smallest note in common
 * use), up for a minimum and down for a maximum, so the shown range always
 * sits inside the real one.
 */
export function fromLimitCents(
  cents: number,
  currency: Currency,
  slsPerUsd: number,
  direction: "up" | "down"
): number {
  if (currency === "USD") return cents;
  const exact = (cents * slsPerUsd) / 100;
  const round = direction === "up" ? Math.ceil : Math.floor;
  return round(exact / 500) * 500;
}

/**
 * An amount as pushes have always written it: "USD 12.50", and
 * "SLSH 30,000" for whole shillings.
 */
export function pushAmount(amount: number, currency: string): string {
  if (parseCurrency(currency) === "SLS") return `SLSH ${Math.round(amount).toLocaleString("en-US")}`;
  return `${currency} ${(amount / 100).toFixed(2)}`;
}

/** "$12.50" or "30,000 SLSH": for push messages, receipts and errors. */
export function formatAmount(amount: number, currency: Currency): string {
  if (currency === "SLS") {
    return `${Math.round(amount).toLocaleString("en-US")} SLSH`;
  }
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${(Math.abs(amount) / 100).toFixed(2)}`;
}
