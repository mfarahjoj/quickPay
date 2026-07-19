import { useState, useEffect, useCallback } from 'react';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';
import type {
  KycStatus,
  PreferredLanguage,
  UserAddress,
  NotificationPreferences,
  LinkedAccounts,
} from '../types';

export interface UserProfile {
  fullName: string;
  phoneNumber: string;
  email?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  address?: UserAddress;
  preferredLanguage: PreferredLanguage;
  accountType: 'customer' | 'merchant';
  kycStatus: KycStatus;
  notificationPreferences: NotificationPreferences;
  linkedAccounts: LinkedAccounts;
  dailyTransactionLimit: number;
  monthlyTransactionLimit: number;
  referralCode?: string;
  isActive: boolean;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  push: true,
  transactionAlerts: true,
  promotions: false,
};

export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
          setProfile({
            fullName: data?.fullName ?? '',
            phoneNumber: data?.phoneNumber ?? user.phoneNumber ?? '',
            email: data?.email ?? undefined,
            dateOfBirth: data?.dateOfBirth ?? undefined,
            gender: data?.gender ?? undefined,
            address: data?.address ?? undefined,
            preferredLanguage: data?.preferredLanguage ?? 'en',
            accountType: data?.accountType ?? 'customer',
            kycStatus: data?.kycStatus ?? 'pending',
            notificationPreferences:
              data?.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFS,
            linkedAccounts: data?.linkedAccounts ?? {},
            dailyTransactionLimit: data?.dailyTransactionLimit ?? 50000,
            monthlyTransactionLimit: data?.monthlyTransactionLimit ?? 500000,
            referralCode: data?.referralCode ?? undefined,
            isActive: data?.isActive ?? true,
          });
        },
        (err) => {
          logger.error('useUserProfile error:', err);
          setError(err);
        }
      );

    return unsubscribe;
  }, [user?.uid, retryCount]);

  const firstName = profile?.fullName?.split(' ')[0] ?? '';

  return {
    profile,
    firstName,
    error,
    retry,
  };
}
