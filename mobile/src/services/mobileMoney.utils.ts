/** Pure helpers for Zaad / eDahab top-ups (no React Native, so they're unit-tested). */

/**
 * A `tel:` URL that opens the dialer with a USSD code typed in. `#` has to be
 * escaped or the dialer drops everything after it.
 */
export function ussdUrl(code: string): string {
  return `tel:${code.replace(/#/g, '%23')}`;
}

/**
 * iOS won't let an app dial a code containing `*` or `#`; there the code is
 * shown to copy instead.
 */
export function canDialUssd(os: string): boolean {
  return os === 'android';
}

/** "+252634123456" → "063 412 3456", the way people read Zaad numbers. */
export function formatLocal(msisdn: string): string {
  const m = /^\+252(\d{2})(\d{3})(\d{4})$/.exec(msisdn);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : msisdn;
}

/** "12.5" → 1250; null for anything that isn't a positive amount with ≤ 2 decimals. */
export function amountCents(text: string): number | null {
  if (!/^\d+(\.\d{0,2})?$/.test(text.trim())) return null;
  const cents = Math.round(parseFloat(text) * 100);
  return cents > 0 ? cents : null;
}

/** "$5.00". */
export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
