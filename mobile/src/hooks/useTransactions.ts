import { useState, useEffect } from 'react';
import { functions } from '../services/firebase.config';
import { Transaction, TransactionStatus } from '../types';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';

export function useTransactions(status?: TransactionStatus, limit: number = 50) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTransactions = async () => {
    if (!user) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const getTransactionsFunction = functions().httpsCallable('getTransactions');
      const result = await getTransactionsFunction({ limit, status });

      const data = result.data as { success: boolean; data: Transaction[] };
      if (data.success) {
        setTransactions(data.data);
        setError(null);
      }
    } catch (err: any) {
      logger.error('Load transactions error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, status]);

  return {
    transactions,
    loading,
    error,
    refresh: loadTransactions,
  };
}
