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

export async function createPaymentRequest(
  tokenId: string,
  amount: number,
  currency: string,
  reference?: string
): Promise<{ requestId: string }> {
  try {
    const fn = functions().httpsCallable('createPaymentRequest');
    const result = await fn({ tokenId, amount, currency, ...(reference ? { reference } : {}) });
    const data = result.data as {
      success: boolean;
      error?: string;
      data: { requestId: string };
    };

    if (!data.success) {
      throw new Error(data.error || 'Failed to create payment request');
    }

    return data.data;
  } catch (error: any) {
    logger.error('Create payment request error:', error);
    throw new Error(error.message || 'Failed to create payment request');
  }
}
