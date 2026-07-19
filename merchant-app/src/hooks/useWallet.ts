import { useState, useEffect } from 'react';
import { firestore, functions } from '../services/firebase.config';
import { Wallet } from '../types';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';

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

    const unsubscribe = firestore()
      .collection('wallets')
      .doc(user.uid)
      .onSnapshot(
        (doc) => {
          if (doc.exists) {
            const data = doc.data();
            setWallet({
              balance: data!.balance / 100,
              balanceCents: data!.balance,
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

      const data = result.data as { success: boolean; data: Wallet };
      if (data.success) {
        setWallet(data.data);
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
