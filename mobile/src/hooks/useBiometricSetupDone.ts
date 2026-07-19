import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BIOMETRIC_SETUP_DONE_KEY = '@quickpay_biometric_setup_done';

export function useBiometricSetupDone() {
  const [done, setDone] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(BIOMETRIC_SETUP_DONE_KEY).then((value) => {
      setDone(value === 'true');
    });
  }, []);

  const refresh = () => {
    AsyncStorage.getItem(BIOMETRIC_SETUP_DONE_KEY).then((value) => {
      setDone(value === 'true');
    });
  };

  // Synchronous optimistic update for completion handlers that already know the
  // value (it was just written to storage). Avoids the async refresh race that
  // briefly renders the wrong gate screen between two independent refreshes.
  const markDone = () => setDone(true);

  return { done, refresh, markDone };
}
