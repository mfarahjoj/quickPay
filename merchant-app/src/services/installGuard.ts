import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from './firebase.config';
import { INSTALL_MARKER_KEY, installKind } from './installGuard.utils';
import { logger } from '../utils/logger';

/**
 * A reinstalled app starts signed out (login-flow review, finding 3).
 *
 * On iOS, deleting the app removes its files but not its Keychain, where
 * Firebase keeps the session, so a reinstall opened already signed in.
 * Local storage goes with the app on both platforms (Android: allowBackup
 * and dataExtractionRules keep it from coming back), so its being empty
 * marks a fresh install, and a session found then is signed out.
 */
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
      logger.warn('Fresh install: signed out a session left from before');
    }
    if (kind !== 'known') await AsyncStorage.setItem(INSTALL_MARKER_KEY, '1');
  } catch (error) {
    // Never block the app from opening over this.
    logger.warn('Install guard failed:', error);
  }
}
