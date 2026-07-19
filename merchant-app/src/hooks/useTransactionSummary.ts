import { useState, useEffect, useCallback } from 'react';
import { SummaryPeriod, TransactionSummary } from '../types';
import { useAuth } from './useAuth';
import { fetchTransactionSummary } from '../services/transaction.service';

export function useTransactionSummary(period: SummaryPeriod) {
  const { user } = useAuth();
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setSummary(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setSummary(await fetchTransactionSummary(period));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, period]);

  useEffect(() => {
    load();
  }, [load]);

  return { summary, loading, error, refresh: load };
}
