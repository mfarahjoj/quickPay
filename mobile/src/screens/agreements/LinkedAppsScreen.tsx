import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { typography, spacing, makeStyles, useColors } from '../../theme';
import { AgreementDetails, listMyAgreements, revokeMyAgreement } from '../../services/apiAgreement.service';
import { formatMoney } from '../../utils/money';
import { logger } from '../../utils/logger';

/**
 * Profile → Linked apps: the apps that may take payments from this wallet,
 * each payment approved on the phone (apiAgreement.service). Switching one off
 * needs no PIN: taking a permission away should always be easy.
 */
export default function LinkedAppsScreen({ navigation }: any) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const [rows, setRows] = useState<AgreementDetails[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setRows(await listMyAgreements());
    } catch (err) {
      logger.error('List agreements failed:', err);
      setError(t('agreements.linked.loadFailed'));
      setRows([]);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const switchOff = (a: AgreementDetails) => {
    Alert.alert(
      t('agreements.linked.offTitle', { merchant: a.merchantName }),
      t('agreements.linked.offMessage', { merchant: a.merchantName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('agreements.linked.off'),
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(a.agreementId);
              await revokeMyAgreement(a.agreementId);
              await load();
            } catch {
              Alert.alert(t('common.error'), t('agreements.linked.offFailed'));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <Header title={t('agreements.linked.title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('agreements.linked.intro')}</Text>
        {rows === null ? (
          <ActivityIndicator color={colors.ui.text} style={styles.spinner} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>{t('agreements.linked.empty')}</Text>
        ) : (
          rows.map((a) => (
            <View key={a.agreementId} style={styles.card}>
              <Text style={styles.name}>{a.merchantName}</Text>
              <Text style={styles.meta}>
                {t('agreements.linked.limits', {
                  perPayment: formatMoney(a.maxChargeUsdCents, 'USD'),
                  perDay: formatMoney(a.dailyUsdCents, 'USD'),
                })}
              </Text>
              <Text style={styles.meta}>
                {a.deviceLabel ? `${a.deviceLabel} · ` : ''}
                {t('agreements.linked.since', { date: when(a.approvedAt) })}
              </Text>
              {busy === a.agreementId ? (
                <ActivityIndicator color={colors.ui.text} style={styles.rowSpinner} />
              ) : (
                <TouchableOpacity onPress={() => switchOff(a)} style={styles.actionWrap} accessibilityRole="button">
                  <Text style={styles.danger}>{t('agreements.linked.off')}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { ...typography.body, color: colors.ui.textDim, marginBottom: spacing.lg },
  spinner: { marginTop: spacing.xl },
  rowSpinner: { marginTop: spacing.md, alignSelf: 'flex-start' },
  error: { ...typography.body, color: colors.ui.error },
  empty: { ...typography.body, color: colors.ui.textFaint },
  card: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  name: { ...typography.bodySemibold, color: colors.ui.text },
  meta: { ...typography.caption, color: colors.ui.textFaint, marginTop: 4 },
  actionWrap: { marginTop: spacing.md, alignSelf: 'flex-start' },
  danger: { ...typography.bodySemibold, color: colors.ui.error },
}));
