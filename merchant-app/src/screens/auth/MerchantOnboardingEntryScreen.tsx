import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { colors } from '../../theme';
import { auth, firestore } from '../../services/firebase.config';
import { hasStoredPinHash } from '../../utils/pinHash';
import type { MerchantOnboardingParamList } from '../../navigation/MerchantOnboardingNavigator';

type Nav = StackNavigationProp<MerchantOnboardingParamList, 'MerchantOnboardingEntry'>;

export default function MerchantOnboardingEntryScreen({ navigation }: { navigation: Nav }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = auth().currentUser?.uid;
      if (!uid) {
        return;
      }
      try {
        const snap = await firestore().collection('users').doc(uid).get();
        const d = snap.data();
        const hasPin = hasStoredPinHash(d?.pinHash);
        const name = typeof d?.fullName === 'string' ? d.fullName : '';
        if (cancelled) {
          return;
        }
        if (hasPin) {
          navigation.replace('MerchantRoleSelect', { fullName: name, pin: undefined });
        } else {
          navigation.replace('MerchantBasics', name.trim().length >= 2 ? { prefilledName: name } : undefined);
        }
      } catch {
        if (!cancelled) {
          navigation.replace('MerchantBasics', undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.action.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
});
