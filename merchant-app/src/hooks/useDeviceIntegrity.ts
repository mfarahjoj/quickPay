import { useEffect } from 'react';
import { Platform } from 'react-native';
import JailMonkey from 'jail-monkey';
import { functions } from '../services/firebase.config';
import { logger } from '../utils/logger';

/**
 * Device-integrity signal (review B7, E14): once per launch, once signed
 * in, report whether this phone looks rooted or jailbroken, or has hooking
 * tools loaded. The server records it for ops; nothing is blocked.
 */
let reported = false;

export function useDeviceIntegrity(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn || reported || __DEV__) return;
    reported = true;
    (async () => {
      try {
        const rooted = JailMonkey.isJailBroken();
        const hooked = JailMonkey.hookDetected();
        await functions().httpsCallable('reportDeviceRisk')({
          rooted,
          hooked,
          platform: Platform.OS,
          app: 'merchant',
        });
      } catch (err) {
        reported = false;
        logger.warn('Device integrity report failed:', err);
      }
    })();
  }, [signedIn]);
}
