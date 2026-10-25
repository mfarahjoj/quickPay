import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firestore } from '../services/firebase.config';
import { signOut } from '../services/auth.service';
import { idleLimitMs } from '../services/idleLimit';
import { logger } from '../utils/logger';

/**
 * Sign out after the console's "Sign out after this long unused"
 * (sessionIdleDays, default 30). The server ends idle sessions too
 * (expireIdleSessions); this makes it happen the moment an idle phone is
 * opened, rather than whenever the daily job reaches it. The setting is
 * mirrored into the public config/app_client, which apps can read.
 */
const KEY = '@zapp_last_active_at';

let cachedDays: { value: unknown; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

async function sessionIdleDays(): Promise<unknown> {
  if (cachedDays && Date.now() - cachedDays.at < CACHE_MS) return cachedDays.value;
  try {
    const snap = await firestore().collection('config').doc('app_client').get();
    cachedDays = { value: snap.data()?.sessionIdleDays, at: Date.now() };
  } catch {
    // Offline: the default (or the last value read) applies.
    cachedDays = { value: cachedDays?.value, at: Date.now() };
  }
  return cachedDays.value;
}

async function checkAndTouch(): Promise<void> {
  try {
    const last = Number(await AsyncStorage.getItem(KEY));
    if (last && Date.now() - last > idleLimitMs(await sessionIdleDays())) {
      await AsyncStorage.removeItem(KEY);
      await signOut();
      return;
    }
    await AsyncStorage.setItem(KEY, String(Date.now()));
  } catch (err) {
    logger.warn('Idle sign-out check failed:', err);
  }
}

export function useIdleSignOut(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    checkAndTouch();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndTouch();
    });
    return () => sub.remove();
  }, [signedIn]);
}
