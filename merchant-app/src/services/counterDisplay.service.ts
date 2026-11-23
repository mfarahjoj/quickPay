import { functions } from './firebase.config';

/**
 * Counter displays: a customer-facing tablet on the shop counter that shows
 * the shop's QR and follows the sale typed here (COUNTER_DISPLAY.md). The
 * tablet pairs by showing a QR and an 8-digit code; the shop claims it here
 * with the PIN, then confirms on the tablet.
 */
export interface CounterDisplay {
  displayId: string;
  name: string;
  /** pending_confirm: claimed here, not yet confirmed on the tablet. */
  status: 'pending_confirm' | 'active';
  /** Checked in within the last 2½ minutes. */
  online: boolean;
  lastSeenAtMs: number | null;
  createdAtMs: number | null;
}

/** What the tablet's pairing QR holds. */
export interface PairingCode {
  pairingId?: string;
  code: string;
}

const PAIRING_ID = /^dp_[a-f0-9]{24}$/;
const CODE = /^[0-9]{8}$/;

/**
 * Read a scanned or typed pairing code. The tablet's QR is
 * `{"type":"zapp_display_pair","v":1,"id":"dp_…","code":"12345678"}`; typed,
 * it is the 8 digits, which may come with the space the tablet shows.
 * Anything else is null.
 */
export function parsePairingCode(raw: string): PairingCode | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text) as { type?: unknown; v?: unknown; id?: unknown; code?: unknown };
      if (data.type !== 'zapp_display_pair' || data.v !== 1) return null;
      if (typeof data.id !== 'string' || !PAIRING_ID.test(data.id)) return null;
      if (typeof data.code !== 'string' || !CODE.test(data.code)) return null;
      return { pairingId: data.id, code: data.code };
    } catch {
      return null;
    }
  }
  const digits = text.replace(/[\s-]/g, '');
  return CODE.test(digits) ? { code: digits } : null;
}

export async function listMyDisplays(): Promise<CounterDisplay[]> {
  const result = await functions().httpsCallable('listMyDisplays')({});
  return (result.data as { data?: { displays?: CounterDisplay[] } }).data?.displays ?? [];
}

export async function linkDisplay(input: PairingCode & { name: string; pin: string }): Promise<{ displayId: string; merchantName: string }> {
  const result = await functions().httpsCallable('linkDisplay')(input);
  return (result.data as { data: { displayId: string; merchantName: string } }).data;
}

export async function renameDisplay(displayId: string, name: string): Promise<void> {
  await functions().httpsCallable('renameDisplay')({ displayId, name });
}

export async function unlinkDisplay(displayId: string): Promise<void> {
  await functions().httpsCallable('unlinkDisplay')({ displayId });
}
