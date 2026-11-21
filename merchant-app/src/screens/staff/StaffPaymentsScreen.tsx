import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { DarkScreen, GlassCard, PillButton, ScreenHeader } from '../../components';
import {
  listShopPayments,
  staffErrorReason,
  type StaffPayment,
  type StaffRefundLimits,
} from '../../services/staff.service';
import { formatAmount, formatCents } from '../../utils/money';
import { logger } from '../../utils/logger';
import { makeStyles, useColors } from '../../theme';

/**
 * Staff mode, managers (STAFF_ACCESS.md): the shop's recent counter payments,
 * to refund from within the limits the shop set. Customer names show only if
 * the shop lets this manager see customers. The shop's balance never shows.
 */
export default function StaffPaymentsScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const [payments, setPayments] = useState<StaffPayment[] | null>(null);
  const [limits, setLimits] = useState<StaffRefundLimits | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const out = await listShopPayments();
      setPayments(out.payments);
      setLimits(out.refunds);
    } catch (err) {
      logger.error('Staff payments failed:', err);
      setError(t(staffErrorReason(err) === 'staff_access_denied' ? 'staffRefund.noAccess' : 'staffRefund.loadFailed'));
      setPayments((p) => p ?? []);
    }
  }, [t]);

  // Fresh on every visit: a refund just made, or the shop changing the limits.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const when = (ms: number) =>
    new Date(ms).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const leftToday = limits ? Math.max(limits.dayCapCents - limits.usedTodayCents, 0) : 0;

  return (
    <DarkScreen contentStyle={styles.flex}>
      <ScreenHeader title={t('staffRefund.title')} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ui.text} />}
      >
        {limits ? (
          <GlassCard style={styles.card}>
            {limits.enabled ? (
              <>
                <Text style={styles.hint}>{t('staffRefund.limitsTitle')}</Text>
                <Text style={styles.limitLine}>{t('staffRefund.perRefund', { amount: formatCents(limits.capCents) })}</Text>
                <Text style={styles.limitLine}>
                  {t('staffRefund.leftToday', { left: formatCents(leftToday), cap: formatCents(limits.dayCapCents) })}
                </Text>
                <Text style={styles.body}>{t('staffRefund.limitsHelp', { days: limits.refundWindowDays })}</Text>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>{t('staffRefund.offTitle')}</Text>
                <Text style={styles.body}>{t('staffRefund.offBody')}</Text>
              </>
            )}
          </GlassCard>
        ) : null}

        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.error}>{error}</Text>
            <PillButton label={t('staffRefund.retry')} variant="glass" onPress={load} />
          </View>
        ) : null}

        {payments === null ? (
          <ActivityIndicator color={colors.ui.text} style={styles.spinner} />
        ) : payments.length === 0 && !error ? (
          <Text style={styles.empty}>{t('staffRefund.none')}</Text>
        ) : (
          payments.map((p) => {
            const done = p.remaining <= 0;
            const tappable = !!limits?.enabled && !done;
            return (
              <TouchableOpacity
                key={p.id}
                disabled={!tappable}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('StaffRefund', { payment: p, limits })}
                accessibilityRole="button"
                accessibilityState={{ disabled: !tappable }}
              >
                <GlassCard style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.name} numberOfLines={1}>
                      {p.customerName ?? t('staffRefund.customer')}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {when(p.createdAtMs)}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </Text>
                    {p.refunded > 0 ? (
                      <Text style={styles.refunded}>
                        {done
                          ? t('staffRefund.refundedAll')
                          : t('staffRefund.refundedSome', { amount: formatAmount(p.refunded, p.currency) })}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.amount, done && styles.amountDone]}>{formatAmount(p.amount, p.currency)}</Text>
                </GlassCard>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 48 },
  card: { marginHorizontal: 20, marginBottom: 16, padding: 18 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ui.text },
  hint: { fontSize: 13, color: colors.ui.textFaint, marginBottom: 6 },
  limitLine: { fontSize: 16, fontWeight: '700', color: colors.ui.text, marginTop: 4 },
  body: { fontSize: 14, color: colors.ui.textDim, lineHeight: 20, marginTop: 10 },
  spinner: { marginTop: 24 },
  empty: { fontSize: 15, color: colors.ui.textFaint, marginHorizontal: 24, lineHeight: 21 },
  errorBlock: { marginHorizontal: 20, marginBottom: 16 },
  error: { fontSize: 14, color: colors.ui.error, marginBottom: 12, lineHeight: 20 },
  row: { marginHorizontal: 20, marginBottom: 10, padding: 16, flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  meta: { fontSize: 13, color: colors.ui.textFaint, marginTop: 4 },
  refunded: { fontSize: 13, fontWeight: '600', color: colors.ui.accent, marginTop: 4 },
  amount: { fontSize: 17, fontWeight: '800', color: colors.ui.text, marginLeft: 12 },
  amountDone: { color: colors.ui.textFaint, textDecorationLine: 'line-through' },
}));
