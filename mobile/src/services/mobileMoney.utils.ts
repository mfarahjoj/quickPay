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

/**
 * "063 412 3456", "0634123456", "+252 63 412 3456" → "+252634123456"; null
 * for anything else. The same rule as the server's (functions/src/mobileMoney/core.ts).
 */
export function normaliseSomaliMsisdn(raw: string): string | null {
  let digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('00252')) digits = digits.slice(5);
  else if (digits.startsWith('252') && digits.length === 12) digits = digits.slice(3);
  if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  return /^[1-9]\d{8}$/.test(digits) ? `+252${digits}` : null;
}

/**
 * A full name as a Zaad account shows it: two or more words of letters, 60
 * characters at most, spaces tidied. Null otherwise. Mirrors the server
 * (functions/src/auth/zaadAccount.ts).
 */
export function normaliseZaadName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length > 60) return null;
  const words = name.split(' ');
  return words.length >= 2 && words.every((w) => /^\p{L}[\p{L}\p{M}'’.-]*$/u.test(w)) ? name : null;
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

/**
 * Whether the app offers Zaad top-ups, from the public config/app_client doc:
 * `{ customer: { zaadTopups: true } }`. Anything else (no doc, no field, a
 * string) is off, so a build that ships before the Zaad functions are
 * deployed never leads anyone to their screens.
 */
export function zaadTopupsOn(appClient: unknown): boolean {
  return (appClient as { customer?: { zaadTopups?: unknown } } | undefined)?.customer?.zaadTopups === true;
}
