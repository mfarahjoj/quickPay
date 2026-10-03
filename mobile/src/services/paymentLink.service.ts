/**
 * Payment links: `zapppay://send?to=%2B252634120987&amount=4.70&note=Ridy%20ride`
 *
 * A link only PRE-FILLS the send flow. The recipient is still resolved by
 * phone through `lookupUserByPhone`, so the payer sees the real account name;
 * the payer still reviews the amount and enters their PIN; and `sendP2P` still
 * runs every server-side check. A link can never move money on its own —
 * which matters, because any app or web page can open one.
 *
 * Partner apps (Ridy, for fares) use this to hand a payment over to Zapp.
 */

export interface PaymentLink {
  /** E.164 (`+252…`) or local digits; the send screen adds the prefix. */
  to: string;
  /** Dollars, at most two decimals, e.g. "4.70". */
  amount?: string;
  note?: string;
}

/** Anything above this is not a fare or a bill; refuse to pre-fill it. */
const MAX_LINK_AMOUNT = 1000;
const MAX_NOTE_LENGTH = 60;

function decode(value: string): string | null {
  try {
    // Form encoding (Dart's Uri, URLSearchParams) writes spaces as '+'.
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** Normalise to `+<digits>` or bare local digits; null if it is not a phone. */
export function normaliseLinkPhone(raw: string): string | null {
  let p = raw.replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  // A '+' decoded as a space by form encoding leaves "252…" with no plus.
  if (!p.startsWith('+') && p.startsWith('252') && p.length >= 11) p = `+${p}`;
  if (/^\+\d{8,15}$/.test(p)) return p;
  if (/^\d{7,10}$/.test(p)) return p;
  return null;
}

/** Parse a `zapppay://send?…` URL. Returns null for anything else or anything malformed. */
export function parsePaymentLink(url: string | null | undefined): PaymentLink | null {
  if (!url) return null;
  const match = /^zapppay:\/\/send\/?\?(.*)$/i.exec(url.trim());
  if (!match) return null;

  const params: Record<string, string> = {};
  for (const part of match[1].split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decode(eq === -1 ? part : part.slice(0, eq));
    const value = decode(eq === -1 ? '' : part.slice(eq + 1));
    if (key === null || value === null) return null;
    params[key] = value;
  }

  const to = params.to ? normaliseLinkPhone(params.to) : null;
  if (!to) return null;

  const link: PaymentLink = { to };

  const amount = params.amount?.trim();
  if (amount && /^\d{1,4}(\.\d{1,2})?$/.test(amount)) {
    const value = Number(amount);
    if (value > 0 && value <= MAX_LINK_AMOUNT) link.amount = amount;
  }

  const note = params.note
    // Control characters have no business in a payment note.
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NOTE_LENGTH);
  if (note) link.note = note;

  return link;
}
