import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, I18nManager } from 'react-native';
import { DEFAULT_LANGUAGE, isRTL } from './languages';
import type { PreferredLanguage } from '../types';

import en from './locales/en.json';
import so from './locales/so.json';
import ar from './locales/ar.json';

const LANGUAGE_STORAGE_KEY = '@quickpay-merchant/language';

export async function getStoredLanguage(): Promise<PreferredLanguage> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'so' || stored === 'ar') {
      return stored;
    }
  } catch {
    // ignore
  }
  return DEFAULT_LANGUAGE;
}

export async function persistLanguage(language: PreferredLanguage): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

// The direction the running app is laid out in. RN reads it once at launch:
// forceRTL only changes the layout on the next launch.
const launchedRTL = I18nManager.isRTL;
// The direction last asked for in this session, so one switch gives one
// reopen notice even when several callers apply it (picker, profile sync).
let requestedRTL = launchedRTL;

/**
 * Switches language. Text changes at once; React Native only flips LTR/RTL on
 * the next launch. Returns true when this call moved the app to the other
 * direction from the one it launched in (once per switch), so callers tell
 * the person to reopen the app.
 */
export async function applyLanguage(language: PreferredLanguage): Promise<boolean> {
  const rtl = isRTL(language);
  const switched = rtl !== requestedRTL;
  requestedRTL = rtl;
  // Always persist the direction, even when it matches the launch direction:
  // ar -> en -> ar in one session has to leave RTL on for the next launch.
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  await i18n.changeLanguage(language);
  await persistLanguage(language);
  return switched && rtl !== launchedRTL;
}

/** Tells the person, in the new language, to reopen the app for the new layout. */
export function showRestartNotice(): void {
  Alert.alert(i18n.t('language.changedTitle'), i18n.t('language.reopenForLayout'));
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    so: { translation: so },
    ar: { translation: ar },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
  compatibilityJSON: 'v4',
});

I18nManager.allowRTL(true);

void getStoredLanguage().then((language) => {
  void applyLanguage(language);
});

export default i18n;
