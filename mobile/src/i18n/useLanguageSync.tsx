import { useEffect } from 'react';
import { applyLanguage, getStoredLanguage, showRestartNotice } from './index';
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
        // e.g. signing in to a profile whose language reads the other way.
        const directionChanged = await applyLanguage(language, { persist: Boolean(profileLanguage) });
        if (directionChanged && !cancelled) {
          showRestartNotice();
        }
      }
    }

    void syncLanguage();

    return () => {
      cancelled = true;
    };
  }, [profile?.preferredLanguage]);

  return null;
}
