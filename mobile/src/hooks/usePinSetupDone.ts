import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './useAuth';

const PIN_SETUP_DONE_KEY = '@quickpay_pin_setup_done';

export function usePinSetupDone() {
  const { user } = useAuth();
  const [done, setDone] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setDone(null);
      return;
    }

    let cancelled = false;

    // The SERVER is authoritative: a PIN is only "set up" if the user doc
    // actually holds a pinHash. Trusting the local flag alone traps users
    // whose Firestore doc is missing/incomplete (e.g. account never finished
    // setup, or data was wiped) on the "enter PIN" screen, where every PIN
    // reads as wrong because validateUserPin throws "User not found". We fall
    // back to the local flag only when the read fails (offline).
    (async () => {
      try {
        const doc = await firestore().collection('users').doc(user.uid).get();
        const hasPin = doc.exists && !!doc.data()?.pinHash;
        if (cancelled) return;
        await AsyncStorage.setItem(PIN_SETUP_DONE_KEY, hasPin ? 'true' : 'false').catch(() => {});
        setDone(hasPin);
      } catch {
        // Offline / read failed — trust the last known local value.
        try {
          const value = await AsyncStorage.getItem(PIN_SETUP_DONE_KEY);
          if (!cancelled) setDone(value === 'true');
        } catch {
          if (!cancelled) setDone(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const refresh = () => {
    AsyncStorage.getItem(PIN_SETUP_DONE_KEY)
      .then((value) => setDone(value === 'true'))
      .catch(() => setDone(false));
  };

  // Synchronous optimistic update — see useBiometricSetupDone for rationale.
  const markDone = () => setDone(true);

  return { done, refresh, markDone };
}
