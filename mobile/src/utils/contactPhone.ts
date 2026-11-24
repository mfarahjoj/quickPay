/**
 * Numbers from the phone's contacts, for Send money and Invite.
 *
 * People save numbers however they like ("063 412 3456", "+252 63 412 3456",
 * "00252634123456", "634123456"). Zapp stores E.164 (+252634123456), which is
 * what `lookupRecipient` takes, so each number is turned into that or dropped.
 * Nothing here leaves the phone: the app looks up only the one number the
 * customer picks, exactly as if they had typed it.
 */

const SOMALIA = '252';

/** A contact's number as E.164, or null when it isn't one Zapp could send to. */
export function contactNumberToE164(raw: string): string | null {
  const cleaned = (raw ?? '').replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  let digits: string;
  if (cleaned.startsWith('+')) digits = cleaned.slice(1);
  else if (cleaned.startsWith('00')) digits = cleaned.slice(2);
  else if (cleaned.startsWith(SOMALIA) && cleaned.length === 12) digits = cleaned;
  // 063 412 3456: the leading 0 is dialled at home, never after +252.
  else if (/^0[1-9]\d{8}$/.test(cleaned)) digits = SOMALIA + cleaned.slice(1);
  // 63 412 3456 with nothing in front.
  else if (/^[1-9]\d{8}$/.test(cleaned)) digits = SOMALIA + cleaned;
  else return null;

  // +252 0 63 412 3456, as some people write it.
  if (digits.startsWith(`${SOMALIA}0`) && digits.length === 13) digits = SOMALIA + digits.slice(4);
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  // A Somali number has nine digits after +252.
  if (digits.startsWith(SOMALIA) && digits.length !== 12) return null;
  return `+${digits}`;
}

/** The fields of a phone contact this needs (react-native-contacts' Contact). */
export interface PhoneContact {
  recordID: string;
  displayName?: string | null;
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  company?: string | null;
  phoneNumbers?: { label?: string; number?: string }[];
}

/** One number of one contact: a row in the picker. */
export interface ContactEntry {
  key: string;
  name: string;
  /** E.164. */
  phone: string;
  /** "mobile", "work"…, as the phone labels it. */
  label: string;
}

function contactName(c: PhoneContact): string {
  const display = c.displayName?.trim();
  if (display) return display;
  const parts = [c.givenName, c.middleName, c.familyName].map((p) => p?.trim()).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return c.company?.trim() ?? '';
}

/**
 * Every usable number of every contact, one row each, sorted by name. A
 * number saved twice on one contact shows once; the customer's own number,
 * which they can't send to, doesn't show at all.
 */
export function contactEntries(contacts: PhoneContact[], ownPhone?: string | null): ContactEntry[] {
  const out: ContactEntry[] = [];
  for (const c of contacts) {
    const seen = new Set<string>();
    for (const n of c.phoneNumbers ?? []) {
      const phone = contactNumberToE164(n.number ?? '');
      if (!phone || phone === ownPhone || seen.has(phone)) continue;
      seen.add(phone);
      out.push({ key: `${c.recordID}:${phone}`, name: contactName(c) || phone, phone, label: n.label ?? '' });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Rows whose name, or number in any of the forms people type, matches the search. */
export function filterContacts(entries: ContactEntry[], query: string): ContactEntry[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return entries;
  const qDigits = q.replace(/\D/g, '');
  // "0634…" and "634…" both find +252634…
  const local = qDigits.replace(/^0+/, '');
  return entries.filter(
    (e) =>
      e.name.toLocaleLowerCase().includes(q) ||
      (qDigits.length >= 3 && (e.phone.includes(qDigits) || (local.length >= 3 && e.phone.includes(local))))
  );
}
