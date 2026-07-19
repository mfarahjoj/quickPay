import { useEffect } from 'react';
import { applyLanguage, getStoredLanguage } from './index';
import { useMerchantProfile } from '../hooks/useMerchantProfile';
import type { PreferredLanguage } from '../types';

export function LanguageSync() {
  const { profile } = useMerchantProfile();

  useEffect(() => {
    let cancelled = false;

    async function syncLanguage() {
      const profileLanguage = profile?.preferredLanguage;
      const storedLanguage = await getStoredLanguage();
      const language: PreferredLanguage = profileLanguage ?? storedLanguage;

      if (!cancelled) {
        await applyLanguage(language);
      }
    }

    void syncLanguage();

    return () => {
      cancelled = true;
    };
  }, [profile?.preferredLanguage]);

  return null;
}
