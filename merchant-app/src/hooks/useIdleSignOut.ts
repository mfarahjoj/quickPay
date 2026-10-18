import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut } from '../services/auth.service';
import { logger } from '../utils/logger';

/**
 * Sign out after 30 days unused (review C10, O2). The server ends idle
 * sessions too (expireIdleSessions, editable as sessionIdleDays); this makes
 * it happen the moment an idle phone is opened, rather than whenever the
 * daily job reaches it.
 */
const KEY = '@zapp_last_active_at';
const IDLE_MS = 30 * 24 * 60 * 60 * 1000;

async function checkAndTouch(): Promise<void> {
  try {
    const last = Number(await AsyncStorage.getItem(KEY));
    if (last && Date.now() - last > IDLE_MS) {
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
