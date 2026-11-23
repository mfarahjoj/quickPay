import { functions } from './firebase.config';

/**
 * Linked apps: a partner (Ridy) asks once to take payments from the wallet,
 * each one approved in the partner's app with Face ID or the phone's passcode.
 * The customer reaches the request through zapppay://agreement/{id}, opened by
 * the partner's app, and approves it here with their PIN.
 */

export type AgreementStatus = 'pending' | 'active' | 'revoked' | 'expired';

export interface AgreementDetails {
  agreementId: string;
  merchantName: string;
  status: AgreementStatus;
  deviceLabel: string | null;
  /** US cents. */
  maxChargeUsdCents: number;
  dailyUsdCents: number;
  expiresAt: string | null;
  approvedAt: string | null;
}

const AGREEMENT_ID = /^agr_[A-Za-z0-9_-]{16,64}$/;

/** The agreement ID behind zapppay://agreement/{id}, or null. Our scheme only. */
export function parseAgreementLink(raw: string): string | null {
  const m = /^zapppay:\/\/agreement\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(raw.trim());
  return m && AGREEMENT_ID.test(m[1]) ? m[1] : null;
}

async function call<T>(name: string, data: unknown): Promise<T> {
  const result = await functions().httpsCallable(name)(data);
  const body = result.data as { success: boolean; error?: string; data: T };
  if (!body.success) throw new Error(body.error || 'Request failed');
  return body.data;
}

export const getApiAgreement = (agreementId: string) =>
  call<AgreementDetails>('getApiAgreement', { agreementId });

/** The limits are the ones the customer was shown; the server refuses if they changed. */
export const approveApiAgreement = (a: AgreementDetails, pin: string) =>
  call<AgreementDetails>('approveApiAgreement', {
    agreementId: a.agreementId,
    pin,
    expectedMaxChargeUsdCents: a.maxChargeUsdCents,
    expectedDailyUsdCents: a.dailyUsdCents,
  });

export const listMyAgreements = () => call<AgreementDetails[]>('listMyAgreements', {});

export const revokeMyAgreement = (agreementId: string) =>
  call<unknown>('revokeMyAgreement', { agreementId });
