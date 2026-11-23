/** Zaad numbers and names, checked the way the server checks them (functions/src/auth/zaadAccount.ts). */

/** "063 412 3456", "0634123456", "+252 63 412 3456" → "+252634123456"; null for anything else. */
export function normaliseSomaliMsisdn(raw: string): string | null {
  let digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('00252')) digits = digits.slice(5);
  else if (digits.startsWith('252') && digits.length === 12) digits = digits.slice(3);
  if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  return /^[1-9]\d{8}$/.test(digits) ? `+252${digits}` : null;
}

/** A full name as a Zaad account shows it: two or more words of letters, 60 characters at most. */
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
