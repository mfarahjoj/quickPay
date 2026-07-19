import { useState, useEffect, useCallback } from 'react';
import { Transaction, TransactionStatus } from '../types';
import { useAuth } from './useAuth';
import { fetchTransactions } from '../services/transaction.service';

export function useTransactions(status?: TransactionStatus, pageSize: number = 25) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setTransactions([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const page = await fetchTransactions({ status, limit: pageSize });
      setTransactions(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, status, pageSize]);

  const loadMore = useCallback(async () => {
    if (!user || cursor === null || loadingMore) return;
    try {
      setLoadingMore(true);
      const page = await fetchTransactions({ status, limit: pageSize, cursor });
      setTransactions((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [user, status, pageSize, cursor, loadingMore]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    transactions,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh: load,
    loadMore,
  };
}
