import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { functions } from '../services/firebase.config';
import { logger } from '../utils/logger';

/**
 * An agent's float (AGENT_FLOAT_SEPARATION.md): dollars in cents, and
 * shillings in whole shillings, held apart and never converted. Float lives in
 * server-only agent:{uid} accounts rather than the wallet doc the app listens
 * to, so it's read through getBalance: on focus, and again whenever
 * `refreshKey` changes (pass the wallet's last movement time).
 */
export function useFloat(isAgent: boolean, refreshKey?: unknown) {
  const [floatCents, setFloatCents] = useState<number | null>(null);
  const [floatSls, setFloatSls] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!isAgent) return;
    try {
      const res = await functions().httpsCallable('getBalance')();
      const data = (res.data as any)?.data;
      setFloatCents(typeof data?.floatCents === 'number' ? data.floatCents : 0);
      // Servers from before shillings send none: no shilling float.
      setFloatSls(typeof data?.floatSls === 'number' ? data.floatSls : 0);
    } catch (err) {
      logger.error('Float load error:', err);
    }
  }, [isAgent]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return { floatCents, floatSls, reloadFloat: load };
}
