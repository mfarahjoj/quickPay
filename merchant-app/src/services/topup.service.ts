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
}

export interface TopupResult {
  transactionId: string;
  userId: string;
  amount: number;
  newBalance: number;
}

export interface TopupRecord {
  id: string;
  userId: string;
  agentId: string;
  amount: number;
  amountDollars: number;
  currency: string;
  paymentMethod: string;
  reference: string;
  notes: string;
  status: string;
  transactionId: string;
  createdAt: Date;
  completedAt?: Date;
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
    throw new Error(error.message || 'Failed to top up customer');
  }
}

export async function getTopupHistory(limit: number = 50): Promise<TopupRecord[]> {
  try {
    const fn = functions().httpsCallable('getAgentTopupHistory');
    const result = await fn({ limit });
    const data = result.data as { success: boolean; error?: string; data: TopupRecord[] };

    if (!data.success) {
      throw new Error(data.error || 'Failed to load history');
    }

    return data.data;
  } catch (error: any) {
    logger.error('Get topup history error:', error);
    throw new Error(error.message || 'Failed to load top-up history');
  }
}
