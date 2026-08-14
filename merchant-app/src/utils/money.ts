import { CURRENCY_SYMBOL } from '../config/constants';

/**
 * Money helpers for the merchant app. Amounts are integer cents everywhere —
 * these convert to and from the text a merchant actually types.
 */

/**
 * Constrain free text to a well-formed amount: digits, at most one decimal
 * point, at most two decimals. Typing "10.999" at the till should be
 * impossible, not silently rounded somewhere downstream.
 */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned.slice(0, 9);

  const whole = cleaned.slice(0, firstDot).slice(0, 9);
  const decimals = cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
  return `${whole}.${decimals}`;
}

/**
 * Text to integer cents, without going through a float. `parseFloat('0.29') *
 * 100` is 28.999999999999996 — rounding hides it most of the time, but the
 * string path is exact and there is no reason to gamble on the money path.
 */
export function toCents(text: string): number {
  const cleaned = sanitizeAmountInput(text ?? '');
  if (!cleaned || cleaned === '.') return 0;

  const [whole = '', decimals = ''] = cleaned.split('.');
  const wholeCents = (parseInt(whole, 10) || 0) * 100;
  const fractionCents = parseInt(decimals.padEnd(2, '0'), 10) || 0;
  return wholeCents + fractionCents;
}

/** Integer cents to a display string, e.g. 1234 → "$12.34". */
export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return `${CURRENCY_SYMBOL}${(safe / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
