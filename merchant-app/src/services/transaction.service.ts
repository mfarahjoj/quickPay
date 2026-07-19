import { functions } from './firebase.config';
import { Transaction, TransactionStatus, TransactionSummary, SummaryPeriod } from '../types';
import { logger } from '../utils/logger';

interface RawTransaction extends Omit<Transaction, 'createdAt' | 'completedAt' | 'refundedAt'> {
  createdAt: string | number | Date;
  completedAt?: string | number | Date;
  refundedAt?: string | number | Date;
}

function toDate(value: string | number | Date | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  return value instanceof Date ? value : new Date(value);
}

function hydrate(raw: RawTransaction): Transaction {
  return {
    ...raw,
    createdAt: toDate(raw.createdAt) ?? new Date(),
    completedAt: toDate(raw.completedAt),
    refundedAt: toDate(raw.refundedAt),
  };
}

export interface TransactionPage {
  items: Transaction[];
  nextCursor: number | null;
}

export async function fetchTransactions(params: {
  limit?: number;
  status?: TransactionStatus;
  cursor?: number | null;
}): Promise<TransactionPage> {
  try {
    const fn = functions().httpsCallable('getTransactions');
    const result = await fn({
      limit: params.limit ?? 25,
      status: params.status,
      cursor: params.cursor ?? undefined,
    });
    const data = result.data as {
      success: boolean;
      error?: string;
      data: RawTransaction[];
      nextCursor: number | null;
    };
    if (!data.success) {
      throw new Error(data.error || 'Failed to load transactions');
    }
    return {
      items: (data.data || []).map(hydrate),
      nextCursor: data.nextCursor ?? null,
    };
  } catch (error: any) {
    logger.error('Fetch transactions error:', error);
    throw new Error(error.message || 'Failed to load transactions');
  }
}

export async function fetchTransactionSummary(
  period: SummaryPeriod
): Promise<TransactionSummary> {
  try {
    const fn = functions().httpsCallable('getTransactionSummary');
    const result = await fn({
      period,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    const data = result.data as {
      success: boolean;
      error?: string;
      data: TransactionSummary;
    };
    if (!data.success) {
      throw new Error(data.error || 'Failed to load summary');
    }
    return data.data;
  } catch (error: any) {
    logger.error('Fetch transaction summary error:', error);
    throw new Error(error.message || 'Failed to load summary');
  }
}

export async function refundPayment(
  transactionId: string,
  pin: string
): Promise<{ refundTransactionId: string; amount: number }> {
  try {
    const fn = functions().httpsCallable('refundPayment');
    const result = await fn({ transactionId, pin });
    const data = result.data as {
      success: boolean;
      error?: string;
      data: { refundTransactionId: string; amount: number };
    };
    if (!data.success) {
      throw new Error(data.error || 'Refund failed');
    }
    return data.data;
  } catch (error: any) {
    logger.error('Refund payment error:', error);
    throw new Error(error.message || 'Failed to refund payment');
  }
}
