import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * App lock (review A3): anyone who picks up an unlocked merchant phone sees
 * sales and customers, so the app asks for the PIN when it comes back after
 * a while away. On unless the merchant turns it off in Settings, Security.
 */
const KEY = '@zapp_merchant_app_lock';

/** Away this long (in the background) and the app locks. */
export const LOCK_AFTER_MS = 60 * 1000;

export async function isAppLockEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'off';
  } catch {
    return true;
  }
}

export async function setAppLockEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, on ? 'on' : 'off');
}
