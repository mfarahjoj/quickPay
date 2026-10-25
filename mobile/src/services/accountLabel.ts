/**
 * How the PIN sign-in screen names the account a phone signs in to:
 * a first name and a masked number. Pure, so it's unit-tested.
 */

/** "+252634123864" → "063 ••• 3864"; other numbers keep their last four. */
export function maskPhone(e164: string | null | undefined): string | undefined {
  if (!e164) return undefined;
  const so = /^\+252(\d{2})\d{3}(\d{4})$/.exec(e164);
  if (so) return `0${so[1]} ••• ${so[2]}`;
  const digits = e164.replace(/\D/g, '');
  return digits.length >= 4 ? `••• ${digits.slice(-4)}` : undefined;
}

/** "Hodan Ali Warsame" → "Hodan". */
export function firstName(fullName: string | null | undefined): string | undefined {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first.slice(0, 30) : undefined;
}

/** "Hodan · 063 ••• 3864", or whichever half is known. */
export function accountLine(label: { name?: string; phone?: string } | undefined): string | null {
  const parts = [label?.name, label?.phone].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
