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
 * Which balance Home shows until the customer picks one (`useHomeCurrency`).
 * Shillings are the main currency; someone who only ever held dollars sees
 * their dollars first.
 */
export function leadCurrency(usdCents: number, slsBalance: number): Currency {
  return usdCents > 0 && slsBalance <= 0 ? 'USD' : 'SLS';
}

/** Dollars for shillings, shillings for dollars. */
export function otherCurrency(currency: Currency): Currency {
  return currency === 'SLS' ? 'USD' : 'SLS';
}

/** The balance a payment in [currency] comes out of. */
export function balanceIn(
  wallet: { balanceCents: number; slsBalance: number } | null | undefined,
  currency: Currency
): number {
  if (!wallet) return 0;
  return currency === 'SLS' ? wallet.slsBalance : wallet.balanceCents;
}

/*
 * An amount being typed on the keypad (`pressAmountKey`), in whole units:
 * "12.5" dollars or "30000" shillings. Shillings have no decimal point.
 */

/** The typed amount in the smallest unit: cents, or whole shillings. */
export function amountInputUnits(text: string, currency: Currency): number {
  const value = Number(text || '0');
  if (!Number.isFinite(value) || value <= 0) return 0;
  return currency === 'SLS' ? Math.floor(value) : Math.round(value * 100);
}

/** The typed amount as it shows while typing: "$12.5" or "30,000 SLSH". */
export function amountInputLabel(text: string, currency: Currency): string {
  if (currency === 'SLS') return `${withCommas(String(amountInputUnits(text, 'SLS')))} SLSH`;
  const [whole, decimals] = (text || '0').split('.');
  return `$${withCommas(whole || '0')}${decimals === undefined ? '' : `.${decimals}`}`;
}
