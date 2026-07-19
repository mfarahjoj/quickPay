import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';
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

export async function applyLanguage(language: PreferredLanguage): Promise<void> {
  const rtl = isRTL(language);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
  await i18n.changeLanguage(language);
  await persistLanguage(language);
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
