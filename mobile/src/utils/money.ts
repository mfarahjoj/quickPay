/**
 * Amounts in dollars and shillings (SHILLINGS.md in the repo root).
 *
 * The server sends every amount in its currency's smallest unit: cents for
 * USD, whole shillings for SLS. The two balances never convert into each
 * other; each payment comes out of the balance in its own currency.
 */

export type Currency = 'USD' | 'SLS';

/** "SLSH" and "SLS" are both shillings; anything else is read as dollars. */
export function toCurrency(code: unknown): Currency {
  return code === 'SLS' || code === 'SLSH' ? 'SLS' : 'USD';
}

const withCommas = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "$12.50" or "30,000 SLSH". */
export function formatMoney(amount: number, currency: unknown): string {
  const sign = amount < 0 ? '-' : '';
  if (toCurrency(currency) === 'SLS') {
    return `${sign}${withCommas(String(Math.round(Math.abs(amount))))} SLSH`;
  }
  const [whole, cents] = (Math.abs(amount) / 100).toFixed(2).split('.');
  return `${sign}$${withCommas(whole)}.${cents}`;
}

/**
 * [amount] in whole units of [currency], as getTransactions sends them
 * (12.5 dollars, or 30000 shillings): "$12.50" or "30,000 SLSH".
 */
export function formatMajor(amount: number, currency: unknown): string {
  return toCurrency(currency) === 'SLS'
    ? formatMoney(amount, 'SLS')
    : formatMoney(Math.round(amount * 100), 'USD');
}

/**
 * A balance split for a large display: dollars as "$12" + ".50", shillings
 * as "30,000" + " SLSH".
 */
export function moneyParts(amount: number, currency: Currency): { main: string; tail: string } {
  if (currency === 'SLS') {
    return { main: withCommas(String(Math.round(amount))), tail: ' SLSH' };
  }
  const [whole, cents] = (amount / 100).toFixed(2).split('.');
  return { main: `$${withCommas(whole)}`, tail: `.${cents}` };
}

/**
 * Which balance leads on Home. Shillings are the main currency; someone who
 * only ever held dollars keeps seeing their dollars first.
 */
export function leadCurrency(usdCents: number, slsBalance: number): Currency {
  return usdCents > 0 && slsBalance <= 0 ? 'USD' : 'SLS';
}

/** The balance a payment in [currency] comes out of. */
export function balanceIn(
  wallet: { balanceCents: number; slsBalance: number } | null | undefined,
  currency: Currency
): number {
  if (!wallet) return 0;
  return currency === 'SLS' ? wallet.slsBalance : wallet.balanceCents;
}
