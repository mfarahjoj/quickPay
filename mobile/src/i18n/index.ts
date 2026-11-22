import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager, NativeModules, Platform, Settings } from 'react-native';
import { DEFAULT_LANGUAGE, isRTL } from './languages';
import type { PreferredLanguage } from '../types';

import en from './locales/en.json';
import so from './locales/so.json';
import ar from './locales/ar.json';

// Older builds saved 'en' on every launch, so a stored 'en' there says nothing
// about what the person chose. Only explicit choices are saved, under v2.
const LEGACY_LANGUAGE_KEY = '@quickpay/language';
const LANGUAGE_STORAGE_KEY = '@quickpay/language/v2';

const asLanguage = (code: unknown): PreferredLanguage | null => {
  const base = typeof code === 'string' ? code.slice(0, 2).toLowerCase() : '';
  return base === 'en' || base === 'so' || base === 'ar' ? base : null;
};

/** The phone's own language, if it is one we ship; otherwise English. */
export function getDeviceLanguage(): PreferredLanguage {
  const preferred: unknown[] = [];
  try {
    if (Platform.OS === 'ios') {
      const langs = Settings.get('AppleLanguages');
      if (Array.isArray(langs)) preferred.push(...langs);
    } else {
      preferred.push(NativeModules.I18nManager?.getConstants?.().localeIdentifier);
    }
  } catch {
    // fall through to Intl
  }
  try {
    preferred.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // no Intl
  }
  for (const code of preferred) {
    const lang = asLanguage(code);
    if (lang) return lang;
  }
  return DEFAULT_LANGUAGE;
}

/** The language the person picked on this phone, else the phone's language. */
export async function getStoredLanguage(): Promise<PreferredLanguage> {
  try {
    const stored = asLanguage(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY));
    if (stored) return stored;
    const legacy = asLanguage(await AsyncStorage.getItem(LEGACY_LANGUAGE_KEY));
    if (legacy && legacy !== 'en') return legacy;
  } catch {
    // ignore
  }
  return getDeviceLanguage();
}

export async function persistLanguage(language: PreferredLanguage): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

/**
 * Switches language. Returns true when the layout direction changed: React
 * Native only flips LTR/RTL on the next launch, so callers tell the person to
 * reopen the app.
 */
export async function applyLanguage(
  language: PreferredLanguage,
  { persist = true }: { persist?: boolean } = {},
): Promise<boolean> {
  const rtl = isRTL(language);
  const directionChanged = I18nManager.isRTL !== rtl;
  if (directionChanged) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
  await i18n.changeLanguage(language);
  if (persist) await persistLanguage(language);
  return directionChanged;
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    so: { translation: so },
    ar: { translation: ar },
  },
  lng: getDeviceLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
  compatibilityJSON: 'v4',
});

I18nManager.allowRTL(true);

void getStoredLanguage().then((language) => {
  void applyLanguage(language, { persist: false });
});

export default i18n;
