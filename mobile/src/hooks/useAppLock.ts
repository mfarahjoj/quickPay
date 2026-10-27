import { useState, useEffect, useCallback } from 'react';
import { AppState, AppStateStatus, Keyboard } from 'react-native';
import { pinSetupDoneFlag, useFlag } from '../services/signInFlags';

/**
 * `locked` is null until the first read settles. The navigator treats null as
 * still loading: starting at false let the wallet show for a frame on a cold
 * start before the lock screen went over it, which flashed the balance.
 */
export function useAppLock() {
  const pinSetUp = useFlag(pinSetupDoneFlag);
  const [locked, setLocked] = useState<boolean | null>(null);

  const unlock = useCallback(() => setLocked(false), []);

  // Locked at launch when this phone has a PIN set up. Decided once: setting
  // a PIN later (signing up) mustn't lock the app.
  useEffect(() => {
    if (locked === null && pinSetUp !== null) setLocked(pinSetUp);
  }, [locked, pinSetUp]);

  // Lock as the app goes to the background, so the lock screen is already
  // up when the app returns. Only 'background' counts, not 'inactive': the
  // Face ID sheet, control center and permission dialogs all pass through
  // 'inactive', and locking on those re-prompted Face ID right after it
  // succeeded.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== 'background' || pinSetupDoneFlag.get() !== true) return;
      // The lock covers the app rather than replacing it, so a field that
      // had the keyboard up would bring it back over the PIN pad.
      Keyboard.dismiss();
      setLocked(true);
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  return { locked, unlock };
}
