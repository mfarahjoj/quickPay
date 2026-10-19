import { useState, useEffect, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PIN_SETUP_DONE_KEY = '@quickpay_pin_setup_done';

async function isPinSetup(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PIN_SETUP_DONE_KEY)) === 'true';
  } catch {
    return false;
  }
}

/**
 * `locked` is null until the first read settles. The navigator treats null as
 * still loading: starting at false let the wallet mount for a frame on a cold
 * start and then be torn down for the lock screen, which flashed the balance
 * and swapped the root under react-native-screens mid-mount.
 */
export function useAppLock() {
  const [locked, setLocked] = useState<boolean | null>(null);

  const unlock = useCallback(() => setLocked(false), []);

  useEffect(() => {
    let cancelled = false;
    isPinSetup().then((setup) => {
      if (!cancelled) setLocked(setup);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Lock as the app goes to the background, so the wallet is swapped for the
  // lock screen while nobody can see it and the lock screen is already up
  // when the app returns. Only 'background' counts, not 'inactive': the Face
  // ID sheet, control center and permission dialogs all pass through
  // 'inactive', and locking on those re-prompted Face ID right after it
  // succeeded.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;
      isPinSetup().then((setup) => {
        if (setup) setLocked(true);
      });
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  return { locked, unlock };
}
