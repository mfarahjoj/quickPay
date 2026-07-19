import { useState, useEffect } from 'react';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';
import { hasStoredPinHash } from '../utils/pinHash';

function isMerchantAccountType(t: unknown): t is 'merchant' | 'topup_agent' | 'agent_merchant' {
  return t === 'merchant' || t === 'topup_agent' || t === 'agent_merchant';
}

/**
 * Merchant app: user must complete onboarding (PIN + merchant/topup_agent) before main tabs.
 */
export function useMerchantOnboardingGate() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user?.uid) {
      setLoading(false);
      setNeedsOnboarding(false);
      return;
    }

    setLoading(true);
    const ref = firestore().collection('users').doc(user.uid);
    const unsub = ref.onSnapshot(
      (docSnap) => {
        const data = docSnap.data();
        const hasPin = hasStoredPinHash(data?.pinHash);
        const okType = isMerchantAccountType(data?.accountType);
        setNeedsOnboarding(!(hasPin && okType));
        setLoading(false);
      },
      (err) => {
        logger.error('useMerchantOnboardingGate:', err);
        setLoading(false);
        setNeedsOnboarding(true);
      }
    );

    return unsub;
  }, [user?.uid, authLoading]);

  return {
    loading: authLoading || loading,
    needsOnboarding: !!user && needsOnboarding,
  };
}
