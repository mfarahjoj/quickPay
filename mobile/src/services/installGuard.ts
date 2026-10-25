import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import auth from '@react-native-firebase/auth';
import { INSTALL_MARKER_KEY, installKind } from './installGuard.utils';
import { logger } from '../utils/logger';

/**
 * A reinstalled app starts signed out (login-flow review, finding 3).
 *
 * On iOS, deleting the app removes its files but not its Keychain, where
 * Firebase keeps the session and this app keeps the PIN key and the
 * trusted-phone credential — so a reinstall opened already signed in. People
 * delete an app to sign out, or before passing the phone on. Local storage
 * goes with the app on both platforms (Android: allowBackup and
 * dataExtractionRules keep it from coming back), so its being empty marks a
 * fresh install. Then whatever the Keychain kept is cleared.
 */
const KEYCHAIN_SERVICES = ['com.quickpay.pin', 'com.quickpay.device'];

function firstAuthState(): Promise<unknown> {
  return new Promise((resolve) => {
    const unsubscribe = auth().onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export async function guardFreshInstall(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const kind = installKind(keys.includes(INSTALL_MARKER_KEY), keys.filter((k) => k !== INSTALL_MARKER_KEY).length);
    if (kind === 'fresh') {
      const user = await firstAuthState();
      if (user) await auth().signOut();
      await Promise.all(
        KEYCHAIN_SERVICES.map((service) => Keychain.resetGenericPassword({ service }).catch(() => false))
      );
      logger.warn('Fresh install: cleared any session and Keychain items left from before');
    }
    if (kind !== 'known') await AsyncStorage.setItem(INSTALL_MARKER_KEY, '1');
  } catch (error) {
    // Never block the app from opening over this.
    logger.warn('Install guard failed:', error);
  }
}
