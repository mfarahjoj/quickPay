import type { PreferredLanguage } from '../types';

export interface LanguageOption {
  code: PreferredLanguage;
  label: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', nativeName: 'English', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'so', label: 'Somali', nativeName: 'Soomaali', flag: '\u{1F1F8}\u{1F1F4}' },
  { code: 'ar', label: 'Arabic', nativeName: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629', flag: '\u{1F1F8}\u{1F1E6}' },
];

export const DEFAULT_LANGUAGE: PreferredLanguage = 'en';

export function isRTL(language: PreferredLanguage): boolean {
  return language === 'ar';
}
