import { useState, useEffect } from 'react';
import { firestore, functions } from '../services/firebase.config';
import { Wallet } from '../types';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';

/**
 * getBalance sends lastTransactionAt as an ISO string; older servers sent a
 * Date, which a callable delivers as {}. Anything unreadable is null, never
 * an object that throws on getTime().
 */
function readDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function useWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setWallet(null);
      setLoading(false);
      return;
    }

    // Real-time listener for wallet
    const unsubscribe = firestore()
      .collection('wallets')
      .doc(user.uid)
      .onSnapshot(
        (doc) => {
          if (doc.exists) {
            const data = doc.data();
            setWallet({
              balance: data!.balance / 100, // Convert cents to dollars
              balanceCents: data!.balance,
              slsBalance: data!.sls?.balance ?? 0,
              currency: data!.currency,
              totalReceived: data!.totalReceived / 100,
              totalSent: data!.totalSent / 100,
              lastTransactionAt: data!.lastTransactionAt?.toDate() || null,
            });
          }
          setError(null);
          setLoading(false);
        },
        (err) => {
          logger.error('Wallet listener error:', err);
          setError(err.message);
          setLoading(false);
        }
      );

    return unsubscribe;
  }, [user]);

  const refreshBalance = async () => {
    if (!user) {
      return;
    }

    try {
      setLoading(true);
      const getBalanceFunction = functions().httpsCallable('getBalance');
      const result = await getBalanceFunction();

      const data = result.data as {
        success: boolean;
        data: Omit<Wallet, 'lastTransactionAt'> & { lastTransactionAt?: unknown };
      };
      if (data.success) {
        const fresh = data.data;
        // The wallet listener already holds the real time; keep it if this
        // response's can't be read.
        setWallet((prev) => ({
          ...fresh,
          lastTransactionAt: readDate(fresh.lastTransactionAt) ?? prev?.lastTransactionAt ?? null,
        }));
        setError(null);
      }
    } catch (err: any) {
      logger.error('Refresh balance error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    wallet,
    loading,
    error,
    refreshBalance,
  };
}
