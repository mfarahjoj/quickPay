import { useState, useEffect, useCallback } from 'react';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';
import type { PreferredLanguage } from '../types';

export interface MerchantProfile {
  businessName: string;
  phoneNumber: string;
  email?: string;
  preferredLanguage: PreferredLanguage;
  accountType: 'merchant' | 'topup_agent' | 'agent_merchant';
  isActive: boolean;
  createdAt?: Date;
}

export function useMerchantProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const retry = useCallback(() => setRetryCount((c) => c + 1), []);

  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      setError(null);
      return;
    }

    setError(null);

    const unsubscribe = firestore()
      .collection('users')
      .doc(user.uid)
      .onSnapshot(
        (doc) => {
          const data = doc.exists ? doc.data() : null;
          setError(null);
          const rawType = data?.accountType;
          const accountType: 'merchant' | 'topup_agent' | 'agent_merchant' =
            rawType === 'topup_agent' ? 'topup_agent' :
            rawType === 'agent_merchant' ? 'agent_merchant' : 'merchant';

          setProfile({
            businessName: data?.fullName ?? data?.businessName ?? '',
            phoneNumber: data?.phoneNumber ?? user.phoneNumber ?? '',
            email: data?.email ?? undefined,
            preferredLanguage: data?.preferredLanguage ?? 'en',
            accountType,
            isActive: data?.isActive ?? true,
            createdAt: data?.createdAt?.toDate() ?? undefined,
          });
        },
        (err) => {
          logger.error('useMerchantProfile error:', err);
          setError(err);
        }
      );

    return unsubscribe;
  }, [user?.uid, retryCount]);

  return {
    profile,
    error,
    retry,
  };
}
