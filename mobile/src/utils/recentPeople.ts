/**
 * The people this customer last sent money to or got money from, newest
 * first, for one-tap picks on the Send screen. Read off the history the app
 * already loads, so there is nothing extra to store or keep in sync.
 */

export interface RecentPerson {
  /** E.164, as the server stores it: what `lookupRecipient` takes. */
  phoneNumber: string;
  name: string;
}

interface Row {
  kind?: string;
  status?: string;
  counterpartyPhone?: string | null;
  counterpartyName?: string | null;
}

export function recentPeople(rows: Row[], max = 8, ownPhone?: string | null): RecentPerson[] {
  const seen = new Set<string>();
  const out: RecentPerson[] = [];
  for (const row of rows) {
    if (row.kind !== 'p2p' || row.status === 'failed') continue;
    const phone = row.counterpartyPhone?.trim();
    if (!phone || !phone.startsWith('+') || phone === ownPhone || seen.has(phone)) continue;
    seen.add(phone);
    out.push({ phoneNumber: phone, name: row.counterpartyName?.trim() || phone });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A local number that is complete: nine digits, as Somali numbers are after
 * +252 (63 123 4567). Lets the Send screen look the person up as soon as the
 * last digit is typed, without a Continue tap.
 */
export function isCompleteLocalNumber(input: string): boolean {
  const trimmed = input.replace(/\s+/g, '');
  return /^[1-9]\d{8}$/.test(trimmed);
}

/** "Amina Yusuf" → "AY"; a phone number → its last two digits. */
export function personInitials(name: string): string {
  if (name.startsWith('+')) return name.slice(-2);
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return (first + last).toLocaleUpperCase();
}
