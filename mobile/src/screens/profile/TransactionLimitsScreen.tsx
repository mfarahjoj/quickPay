import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { functions } from '../../services/firebase.config';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface Props {
  navigation: any;
}

interface LimitsData {
  kycStatus: string;
  dailyLimit: number;
  monthlyLimit: number;
  dailyUsed: number;
  monthlyUsed: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  perTransactionLimit: number;
}

const KYC_LABEL_KEYS: Record<string, string> = {
  pending: 'profile.limits.unverified',
  submitted: 'profile.limits.underReview',
  verified: 'profile.limits.verified',
  rejected: 'profile.limits.rejected',
};

function ProgressBar({
  used,
  total,
  color,
}: {
  used: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <View style={progressStyles.track}>
      <View
        style={[progressStyles.fill, { width: `${pct * 100}%`, backgroundColor: color }]}
      />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.dark.glassBorder,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
});

export default function TransactionLimitsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [limits, setLimits] = useState<LimitsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLimits = async () => {
    try {
      setLoading(true);
      setError(null);
      const fn = functions().httpsCallable('getAccountLimits');
      const result = await fn({});
      const data = result.data as { success: boolean; data?: LimitsData; error?: string };
      if (data.success && data.data) {
        setLimits(data.data);
      } else {
        setError(data.error ?? t('profile.limits.loadFailed'));
      }
    } catch (err: any) {
      setError(err.message ?? t('profile.limits.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLimits();
  }, []);

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <View style={styles.container}>
      <Header title={t('profile.limits.title')} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.dark.accent} style={styles.loader} />
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Button title={t('common.retry')} onPress={fetchLimits} variant="outline" />
          </View>
        ) : limits ? (
          <>
            <View style={styles.tierCard}>
              <Text style={styles.tierLabel}>{t('profile.limits.accountTier')}</Text>
              <Text style={styles.tierValue}>
                {t(KYC_LABEL_KEYS[limits.kycStatus] ?? limits.kycStatus)}
              </Text>
              {limits.kycStatus !== 'verified' && (
                <Button
                  title={t('profile.limits.verifyIdentity')}
                  onPress={() => navigation.navigate('KYC')}
                  variant="outline"
                  style={styles.verifyButton}
                />
              )}
            </View>

            <View style={styles.limitCard}>
              <Text style={styles.limitTitle}>{t('profile.limits.dailyLimit')}</Text>
              <View style={styles.limitRow}>
                <Text style={styles.limitUsed}>{fmt(limits.dailyUsed)}</Text>
                <Text style={styles.limitOf}>{t('common.of')} {fmt(limits.dailyLimit)}</Text>
              </View>
              <ProgressBar
                used={limits.dailyUsed}
                total={limits.dailyLimit}
                color={colors.dark.accent}
              />
              <Text style={styles.remaining}>
                {t('profile.limits.remainingToday', { amount: fmt(limits.dailyRemaining) })}
              </Text>
            </View>

            <View style={styles.limitCard}>
              <Text style={styles.limitTitle}>{t('profile.limits.monthlyLimit')}</Text>
              <View style={styles.limitRow}>
                <Text style={styles.limitUsed}>{fmt(limits.monthlyUsed)}</Text>
                <Text style={styles.limitOf}>{t('common.of')} {fmt(limits.monthlyLimit)}</Text>
              </View>
              <ProgressBar
                used={limits.monthlyUsed}
                total={limits.monthlyLimit}
                color={colors.dark.accent}
              />
              <Text style={styles.remaining}>
                {t('profile.limits.remainingMonth', { amount: fmt(limits.monthlyRemaining) })}
              </Text>
            </View>

            <View style={styles.limitCard}>
              <Text style={styles.limitTitle}>{t('profile.limits.perTransaction')}</Text>
              <Text style={styles.perTxValue}>
                {fmt(limits.perTransactionLimit)}
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  loader: { marginTop: spacing.xxl },
  errorCard: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  errorText: { ...typography.body, color: colors.dark.error, textAlign: 'center' },
  tierCard: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  tierLabel: { ...typography.caption, color: colors.dark.textDim },
  tierValue: {
    ...typography.h2,
    color: colors.dark.text,
    marginTop: spacing.xs,
  },
  verifyButton: { marginTop: spacing.md },
  limitCard: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  limitTitle: {
    ...typography.captionBold,
    color: colors.dark.textDim,
    marginBottom: spacing.sm,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  limitUsed: { ...typography.h2, color: colors.dark.text },
  limitOf: { ...typography.body, color: colors.dark.textFaint },
  remaining: {
    ...typography.caption,
    color: colors.dark.textDim,
    marginTop: spacing.sm,
  },
  perTxValue: {
    ...typography.h2,
    color: colors.dark.text,
  },
});
