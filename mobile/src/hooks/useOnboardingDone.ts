import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

const ONBOARDING_DONE_KEY = '@quickpay_onboarding_done';

export function useOnboardingDone() {
  const [done, setDone] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_DONE_KEY).then((value) => {
      setDone(value === 'true');
    });
  }, []);

  const complete = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_DONE_KEY, 'true');
      setDone(true);
    } catch (err) {
      logger.error('Onboarding complete error:', err);
      setDone(true);
    }
  };

  return { done, complete };
}
