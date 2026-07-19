import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PIN_SETUP_DONE_KEY = '@quickpay_pin_setup_done';

async function isPinSetup(): Promise<boolean> {
  const val = await AsyncStorage.getItem(PIN_SETUP_DONE_KEY);
  return val === 'true';
}

export function useAppLock() {
  const [locked, setLocked] = useState(false);
  const shouldLockRef = useRef(false);

  const unlock = useCallback(() => {
    setLocked(false);
    shouldLockRef.current = false;
  }, []);

  // Lock on initial mount if PIN has been set up
  useEffect(() => {
    isPinSetup().then((setup) => {
      if (setup) setLocked(true);
    });
  }, []);

  // Lock on foreground-resume if PIN has been set up (regardless of biometric).
  // Only react to 'background' (the app was genuinely left), NOT 'inactive':
  // 'inactive' also fires for transient system overlays — the Face ID sheet,
  // control center, the notification shade, permission dialogs — and locking on
  // those caused an immediate re-lock (and repeat Face ID prompt) right after
  // enabling biometrics, since the enrollment sheet flips the app to 'inactive'.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'background') {
        shouldLockRef.current = true;
      } else if (nextState === 'active') {
        if (shouldLockRef.current) {
          shouldLockRef.current = false;
          isPinSetup().then((setup) => {
            if (setup) setLocked(true);
          });
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  return { locked, unlock };
}
