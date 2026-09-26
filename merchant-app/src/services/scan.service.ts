import { functions } from './firebase.config';
import { logger } from '../utils/logger';

export interface ScanResult {
  valid: boolean;
  tokenId: string;
  customerName: string;
  customerId: string;
}

export async function scanCustomerToken(tokenData: string): Promise<ScanResult> {
  try {
    const fn = functions().httpsCallable('scanCustomerToken');
    const result = await fn({ tokenData });
    const data = result.data as { success: boolean; error?: string; data: ScanResult };

    if (!data.success) {
      throw new Error(data.error || 'Failed to scan token');
    }

    return data.data;
  } catch (error: any) {
    logger.error('Scan customer token error:', error);
    throw new Error(error.message || 'Failed to scan token');
  }
}

export type ChargeStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface ChargeResult {
  requestId: string;
  /** What the customer is being asked to pay, in cents, as the server stored it. */
  amount: number;
  status: ChargeStatus;
  /** Seconds the customer has left to approve, measured by the server. */
  expiresInSeconds: number;
}

/**
 * Raise a charge against a scanned customer. Calling again for the same scan
 * returns the same charge rather than a second one, so a retry is safe.
 *
 * Errors are rethrown untouched: the screen maps their `code` to a message in
 * the merchant's language, which a wrapped Error would lose.
 */
export async function createPaymentRequest(
  tokenId: string,
  amount: number,
  currency: string,
  reference?: string
): Promise<ChargeResult> {
  try {
    const fn = functions().httpsCallable('createPaymentRequest');
    const result = await fn({ tokenId, amount, currency, ...(reference ? { reference } : {}) });
    const data = result.data as { success: boolean; error?: string; data: ChargeResult };

    if (!data.success) {
      throw new Error(data.error || 'Failed to create payment request');
    }

    return data.data;
  } catch (error: any) {
    logger.error('Create payment request error:', error);
    throw error;
  }
}

/**
 * Withdraw a charge the customer has not approved. Resolves to the charge's
 * final status: 'approved' when the customer's approval got there first, so
 * the caller must treat that as paid, not cancelled.
 */
export async function cancelPaymentRequest(requestId: string): Promise<ChargeStatus> {
  try {
    const fn = functions().httpsCallable('cancelPaymentRequest');
    const result = await fn({ requestId });
    const data = result.data as { success: boolean; data: { status: ChargeStatus } };
    return data.data.status;
  } catch (error: any) {
    logger.error('Cancel payment request error:', error);
    throw error;
  }
}
