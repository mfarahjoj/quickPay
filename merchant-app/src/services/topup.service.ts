import { functions } from './firebase.config';
import { logger } from '../utils/logger';

export interface CustomerLookupResult {
  userId: string;
  phoneNumber: string;
  fullName: string;
  accountType: string;
}

export interface TopupRequest {
  userId: string;
  amount: number;
  agentPin: string;
  paymentMethod: 'cash' | 'zaad' | 'edahab';
  reference?: string;
  notes?: string;
  /** One per top-up, sent again on every retry of it (utils/idempotency.ts). */
  idempotencyKey: string;
}

export interface TopupResult {
  transactionId: string;
  userId: string;
  amount: number;
}

export async function lookupCustomer(phoneNumber: string): Promise<CustomerLookupResult> {
  try {
    const fn = functions().httpsCallable('lookupUserByPhone');
    const result = await fn({ phoneNumber });
    const data = result.data as { success: boolean; error?: string; data: CustomerLookupResult };

    if (!data.success) {
      throw new Error(data.error || 'Customer not found');
    }

    return data.data;
  } catch (error: any) {
    logger.error('Lookup customer error:', error);
    throw new Error(error.message || 'Failed to look up customer');
  }
}

export async function topupCustomer(request: TopupRequest): Promise<TopupResult> {
  try {
    const fn = functions().httpsCallable('manualTopup');
    const result = await fn(request);
    const data = result.data as { success: boolean; error?: string; data: TopupResult };

    if (!data.success) {
      throw new Error(data.error || 'Top-up failed');
    }

    return data.data;
  } catch (error: any) {
    logger.error('Top-up customer error:', error);
    // Rethrown untouched: the screen reads its code to word it, and sends
    // a wrong PIN back to the keypad.
    throw error;
  }
}
