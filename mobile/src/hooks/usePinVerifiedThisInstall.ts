import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Set after the user proves knowledge of their account PIN on THIS install —
// creating it (SetupPin), verifying it (WelcomeBack), resetting it (ResetPin),
// or unlocking the app. Returning users on a fresh install (where
// usePinSetupDone recovers "done" from the server) won't have it, which is
// what routes them through the welcome-back verification.
const PIN_VERIFIED_KEY = '@quickpay_pin_verified_this_install';

export async function markPinVerifiedThisInstall(): Promise<void> {
  try {
    await AsyncStorage.setItem(PIN_VERIFIED_KEY, 'true');
  } catch {
    // Non-fatal — worst case the user re-verifies their PIN next launch.
  }
}

export function usePinVerifiedThisInstall() {
  const [done, setDone] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(PIN_VERIFIED_KEY)
      .then((value) => setDone(value === 'true'))
      .catch(() => setDone(false));
  }, []);

  const refresh = () => {
    AsyncStorage.getItem(PIN_VERIFIED_KEY)
      .then((value) => setDone(value === 'true'))
      .catch(() => setDone(false));
  };

  // Synchronous optimistic update — see useBiometricSetupDone for rationale.
  const markDone = () => setDone(true);

  return { done, refresh, markDone };
}
