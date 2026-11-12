import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { functions } from '../services/firebase.config';
import { logger } from '../utils/logger';

/**
 * An agent's float, in cents (AGENT_FLOAT_SEPARATION.md). Float lives in the
 * server-only agent:{uid} account rather than the wallet doc the app
 * listens to, so it's read through getBalance: on focus, and again whenever
 * `refreshKey` changes (pass the wallet's last movement time).
 */
export function useFloat(isAgent: boolean, refreshKey?: unknown) {
  const [floatCents, setFloatCents] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!isAgent) return;
    try {
      const res = await functions().httpsCallable('getBalance')();
      const cents = (res.data as any)?.data?.floatCents;
      setFloatCents(typeof cents === 'number' ? cents : 0);
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

  return { floatCents, reloadFloat: load };
}
