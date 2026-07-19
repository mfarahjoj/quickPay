import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import { colors, typography, spacing, borderRadius } from '../theme';
import { useAuth } from '../hooks/useAuth';

const STATIC_QR_KEY = '@quickpay_static_merchant_qr';

interface Props {
  merchantName?: string;
}

export function StaticMerchantQR({ merchantName }: Props) {
  const { user } = useAuth();
  const [qrData, setQrData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(STATIC_QR_KEY);
        if (cached) {
          setQrData(cached);
          setLoading(false);
        }

        if (user) {
          const data = JSON.stringify({
            type: 'quickpay_merchant',
            merchantId: user.uid,
            merchantName: merchantName || user.displayName || 'Merchant',
          });

          await AsyncStorage.setItem(STATIC_QR_KEY, data);
          setQrData(data);
        }
      } catch {
        // Fall through — cached data (if any) is already set
      } finally {
        setLoading(false);
      }
    })();
  }, [user, merchantName]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.action.primary} />
      </View>
    );
  }

  if (!qrData) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Sign in to generate your merchant QR code.</Text>
      </View>
    );
  }

  const displayName =
    merchantName || (qrData ? JSON.parse(qrData).merchantName : 'Merchant');

  return (
    <View style={styles.container}>
      <View style={styles.qrWrapper}>
        <QRCode value={qrData} size={200} backgroundColor={colors.background.primary} />
      </View>
      <Text style={styles.merchantName}>{displayName}</Text>
      <View style={styles.offlineBadge}>
        <Text style={styles.offlineBadgeText}>Works Offline</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  qrWrapper: {
    padding: spacing.md,
    backgroundColor: colors.background.primary,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
  },
  merchantName: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  offlineBadge: {
    backgroundColor: colors.action.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  offlineBadgeText: {
    ...typography.captionBold,
    color: colors.text.inverse,
  },
  errorText: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
