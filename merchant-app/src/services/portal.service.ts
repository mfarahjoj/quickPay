import { functions } from './firebase.config';

/**
 * Zapp Business on the web (MERCHANT_INSIGHTS.md): a computer shows a QR,
 * the shop scans it here and approves with the PIN, and that computer can
 * then view the shop's figures, never move money. Sessions are listed and
 * signed out from Settings → Zapp Business.
 */

/** What the sign-in QR holds: `{"type":"zapp_portal_login","v":1,"id":"pl_…","code":"…"}`. */
export interface PortalLoginCode {
  loginId: string;
  code: string;
}

const LOGIN_ID = /^pl_[0-9a-f]{24}$/;
const CODE = /^[0-9a-f]{32}$/;

/** Read a scanned Zapp Business sign-in QR. Anything else is null. */
export function parsePortalLogin(raw: string): PortalLoginCode | null {
  const text = (raw ?? '').trim();
  if (!text.startsWith('{')) return null;
  try {
    const data = JSON.parse(text) as { type?: unknown; v?: unknown; id?: unknown; code?: unknown };
    if (data.type !== 'zapp_portal_login' || data.v !== 1) return null;
    if (typeof data.id !== 'string' || !LOGIN_ID.test(data.id)) return null;
    if (typeof data.code !== 'string' || !CODE.test(data.code)) return null;
    return { loginId: data.id, code: data.code };
  } catch {
    return null;
  }
}

export interface PortalSessionSummary {
  sessionId: string;
  /** "Chrome on macOS" */
  browser: string;
  createdAtMs: number;
  expiresAtMs: number;
  lastSeenAtMs: number | null;
}

/** Which browser is asking, so the shop can check it's the computer in front of them. */
export async function describePortalLogin(login: PortalLoginCode): Promise<{ browser: string; expiresAtMs: number }> {
  const result = await functions().httpsCallable('describePortalLogin')(login);
  return (result.data as { data: { browser: string; expiresAtMs: number } }).data;
}

export async function approvePortalLogin(login: PortalLoginCode, pin: string): Promise<void> {
  await functions().httpsCallable('approvePortalLogin')({ ...login, pin });
}

export async function declinePortalLogin(login: PortalLoginCode): Promise<void> {
  await functions().httpsCallable('approvePortalLogin')({ ...login, decline: true });
}

export async function listPortalSessions(): Promise<PortalSessionSummary[]> {
  const result = await functions().httpsCallable('listPortalSessions')({});
  return (result.data as { data?: { sessions?: PortalSessionSummary[] } }).data?.sessions ?? [];
}

/** Sign one computer out, or every one with "all". */
export async function revokePortalSession(sessionId: string | 'all'): Promise<void> {
  await functions().httpsCallable('revokePortalSession')({ sessionId });
}
