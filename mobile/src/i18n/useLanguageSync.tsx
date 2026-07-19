import { useEffect } from 'react';
import { applyLanguage, getStoredLanguage } from './index';
import { useUserProfile } from '../hooks/useUserProfile';
import type { PreferredLanguage } from '../types';

export function LanguageSync() {
  const { profile } = useUserProfile();

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
