import { functions } from './firebase.config';

/**
 * Charges merchants raise through the Zapp Merchant Payments API — an online
 * checkout or a shop's till. The customer reaches one by scanning the checkout
 * QR, tapping "Open Zapp Pay" on the checkout page (zapppay://charge/{id}), or
 * from a push when the merchant addressed the charge to their phone number.
 */

export type ApiChargeStatus = 'pending' | 'succeeded' | 'expired' | 'canceled';

export interface ApiChargeDetails {
  chargeId: string;
  merchantName: string;
  amount: number; // cents
  currency: string;
  reference?: string;
  status: ApiChargeStatus;
  paidByYou: boolean;
  transactionId?: string;
  expiresAt: string;
  expiresInSeconds: number;
}

const CHARGE_ID = /^ch_[A-Za-z0-9_-]{16,64}$/;

/**
 * The charge ID behind a scanned code or an opened link, or null.
 *
 * Accepts the deep link and the hosted checkout URL (which is what the QR
 * encodes, so a phone camera without Zapp Pay still lands somewhere useful).
 * Only our own hosts count — a look-alike URL on another domain is not ours.
 */
export function parseChargeLink(raw: string): string | null {
  const text = raw.trim();
  const deep = /^zapppay:\/\/charge\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(text);
  if (deep) return CHARGE_ID.test(deep[1]) ? deep[1] : null;

  const web = /^https:\/\/([^/?#]+)\/checkout\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(text);
  if (web && isCheckoutHost(web[1].toLowerCase())) {
    return CHARGE_ID.test(web[2]) ? web[2] : null;
  }
  return null;
}

function isCheckoutHost(host: string): boolean {
  return (
    host === 'quickpay-485417.web.app' ||
    host === 'quickpay-485417.firebaseapp.com' ||
    host === 'quickpay-staging.web.app' ||
    host === 'quickpay-staging.firebaseapp.com'
  );
}

export async function getApiCharge(chargeId: string): Promise<ApiChargeDetails> {
  const fn = functions().httpsCallable('getApiCharge');
  const result = await fn({ chargeId });
  const data = result.data as { success: boolean; error?: string; data: ApiChargeDetails };
  if (!data.success) {
    throw new Error(data.error || 'Failed to load payment request');
  }
  return data.data;
}

/**
 * Pay a merchant's API charge. `expectedAmount` is the amount the customer was
 * shown; the server refuses if the charge says anything else.
 */
export async function approveApiCharge(
  chargeId: string,
  pin: string,
  expectedAmount: number,
): Promise<{ transactionId: string; amount: number; merchantName: string }> {
  const fn = functions().httpsCallable('approveApiCharge');
  const result = await fn({ chargeId, pin, expectedAmount });
  const data = result.data as {
    success: boolean;
    error?: string;
    data: { transactionId: string; amount: number; merchantName: string };
  };
  if (!data.success) {
    throw new Error(data.error || 'Failed to approve payment');
  }
  return data.data;
}
