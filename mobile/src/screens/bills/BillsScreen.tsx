import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { Header } from '../../components/Header';
import { BillIcon, ChevronIcon } from '../../components/icons/LineIcons';
import { typography, spacing, borderRadius, makeStyles, useColors } from '../../theme';
import { triggerHaptic } from '../../services/haptics.service';
import {
  Bill,
  MyBills,
  autopayCovers,
  cancelDirectPaymentRequest,
  disableBillAutopay,
  formatDueDate,
  hargeisaToday,
  listMyBills,
  stopBillSeries,
} from '../../services/bills.service';
import { formatMoney } from '../../utils/money';
import { logger } from '../../utils/logger';

/**
 * Bills from shops: what is due, which shops are on auto-pay, repeating
 * bills, and what was paid. Turning auto-pay off or stopping a repeating bill
 * needs no PIN: taking a permission away should always be easy.
 */
export default function BillsScreen({ navigation }: any) {
  const colors = useColors();
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<MyBills | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await listMyBills());
    } catch (err) {
      logger.error('List bills failed:', err);
      setError(t('bills.loadFailed'));
      setData((d) => d ?? { bills: [], series: [], autopay: [] });
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const confirmThen = (title: string, message: string, action: string, key: string, run: () => Promise<unknown>) => {
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: action,
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(key);
            await run();
            triggerHaptic('success');
            await load();
          } catch {
            Alert.alert(t('common.error'), t('bills.actionFailed'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const today = hargeisaToday();
  const due = (data?.bills ?? []).filter((b) => b.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const history = (data?.bills ?? []).filter((b) => b.status !== 'open');
  const dueDate = (d: string) => formatDueDate(d, i18n.language);
  const requests = data?.requests ?? [];
  // Shops that have billed this customer, to pick from instead of typing a number.
  const recentShops = Array.from(
    new Map((data?.bills ?? []).map((b) => [b.merchantId, { merchantId: b.merchantId, name: b.merchantName }])).values(),
  ).slice(0, 5);

  const billRow = (b: Bill, last: boolean) => {
    const overdue = b.status === 'open' && b.dueDate < today;
    const auto = b.status === 'open' && autopayCovers(b, data?.autopay ?? []);
    const sub =
      b.status === 'open'
        ? t(overdue ? 'bills.overdueSince' : 'bills.dueOn', { date: dueDate(b.dueDate) })
        : t(`bills.status.${b.status}`) +
          (b.status === 'paid' && b.paidBy === 'autopay' ? ` · ${t('bills.autopayShort')}` : '');
    return (
      <View key={b.id}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => { triggerHaptic('light'); navigation.navigate('BillDetail', { billId: b.id }); }}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <View style={[styles.icon, { backgroundColor: colors.tints.blue.fill }]}>
            <BillIcon size={19} color={colors.tints.blue.mark} strokeWidth={1.9} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>{b.merchantName}</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{b.description}</Text>
            <Text style={[styles.rowSub, overdue && styles.overdue]} numberOfLines={1}>{sub}</Text>
          </View>
          <View style={styles.rowEnd}>
            <Text style={[styles.amount, b.status !== 'open' && b.status !== 'paid' && styles.struck]}>
              {formatMoney(b.amount, b.currency)}
            </Text>
            {auto ? <Text style={styles.badge}>{t('bills.autopayShort')}</Text> : null}
          </View>
          <ChevronIcon size={18} color={colors.ui.textFaint} />
        </TouchableOpacity>
        {last ? null : <View style={styles.divider} />}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Header title={t('bills.title')} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ui.text} />}
      >
        {data === null ? (
          <ActivityIndicator color={colors.ui.text} style={styles.spinner} />
        ) : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={styles.setup}
              onPress={() => { triggerHaptic('light'); navigation.navigate('RequestDirectPayment', { shops: recentShops }); }}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={styles.setupTitle}>{t('bills.request.cta')}</Text>
              <Text style={styles.setupSub}>{t('bills.request.ctaSub')}</Text>
            </TouchableOpacity>

            {requests.length > 0 ? (
              <>
                <Text style={styles.section}>{t('bills.request.waiting')}</Text>
                <View style={styles.card}>
                  {requests.map((r, i) => (
                    <View key={r.id}>
                      <View style={styles.settingRow}>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle}>{r.merchantName}</Text>
                          <Text style={styles.rowSub}>
                            {t(`bills.every.${r.interval}`, { amount: formatMoney(r.amount, r.currency) })} · {r.description}
                          </Text>
                          <Text style={styles.rowSub}>
                            {r.autopay ? t('bills.request.waitingAutopay') : t('bills.request.waitingManual')}
                          </Text>
                        </View>
                        {busy === r.id ? (
                          <ActivityIndicator color={colors.ui.text} />
                        ) : (
                          <TouchableOpacity
                            onPress={() =>
                              confirmThen(
                                t('bills.request.cancelTitle'),
                                t('bills.request.cancelMessage', { merchant: r.merchantName }),
                                t('bills.request.cancel'),
                                r.id,
                                () => cancelDirectPaymentRequest(r.id),
                              )
                            }
                            accessibilityRole="button"
                            hitSlop={8}
                          >
                            <Text style={styles.danger}>{t('bills.request.cancel')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {i === requests.length - 1 ? null : <View style={styles.divider} />}
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <Text style={styles.section}>{t('bills.due')}</Text>
            <View style={styles.card}>
              {due.length === 0 ? (
                <Text style={styles.empty}>{data.bills.length === 0 ? t('bills.emptyAll') : t('bills.emptyDue')}</Text>
              ) : (
                due.map((b, i) => billRow(b, i === due.length - 1))
              )}
            </View>

            {data.autopay.length > 0 ? (
              <>
                <Text style={styles.section}>{t('bills.autopay')}</Text>
                <View style={styles.card}>
                  {data.autopay.map((a, i) => (
                    <View key={a.merchantId}>
                      <View style={styles.settingRow}>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle}>{a.merchantName}</Text>
                          <Text style={styles.rowSub}>
                            {t('bills.autopayUpTo', { amount: formatMoney(a.maxAmount, a.currency) })}
                          </Text>
                        </View>
                        {busy === a.merchantId ? (
                          <ActivityIndicator color={colors.ui.text} />
                        ) : (
                          <TouchableOpacity
                            onPress={() =>
                              confirmThen(
                                t('bills.autopayOffTitle', { merchant: a.merchantName }),
                                t('bills.autopayOffMessage', { merchant: a.merchantName }),
                                t('bills.turnOff'),
                                a.merchantId,
                                () => disableBillAutopay(a.merchantId),
                              )
                            }
                            accessibilityRole="button"
                            hitSlop={8}
                          >
                            <Text style={styles.danger}>{t('bills.turnOff')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {i === data.autopay.length - 1 ? null : <View style={styles.divider} />}
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {data.series.length > 0 ? (
              <>
                <Text style={styles.section}>{t('bills.repeating')}</Text>
                <View style={styles.card}>
                  {data.series.map((s, i) => (
                    <View key={s.id}>
                      <View style={styles.settingRow}>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle}>{s.merchantName}</Text>
                          <Text style={styles.rowSub}>
                            {t(`bills.every.${s.interval}`, { amount: formatMoney(s.amount, s.currency) })} · {s.description}
                          </Text>
                          <Text style={styles.rowSub}>{t('bills.nextBill', { date: dueDate(s.nextDueDate) })}</Text>
                        </View>
                        {busy === s.id ? (
                          <ActivityIndicator color={colors.ui.text} />
                        ) : (
                          <TouchableOpacity
                            onPress={() =>
                              confirmThen(
                                t('bills.stopTitle', { merchant: s.merchantName }),
                                t('bills.stopMessage', { merchant: s.merchantName }),
                                t('bills.stop'),
                                s.id,
                                () => stopBillSeries(s.id),
                              )
                            }
                            accessibilityRole="button"
                            hitSlop={8}
                          >
                            <Text style={styles.danger}>{t('bills.stop')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {i === data.series.length - 1 ? null : <View style={styles.divider} />}
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {history.length > 0 ? (
              <>
                <Text style={styles.section}>{t('bills.history')}</Text>
                <View style={styles.card}>{history.map((b, i) => billRow(b, i === history.length - 1))}</View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  spinner: { marginTop: spacing.xl },
  error: { ...typography.body, color: colors.ui.error, marginBottom: spacing.md },
  section: {
    ...typography.caption,
    color: colors.ui.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  empty: { ...typography.body, color: colors.ui.textFaint, paddingVertical: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.md },
  icon: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  rowText: { flex: 1 },
  rowTitle: { ...typography.bodySemibold, color: colors.ui.text },
  rowSub: { ...typography.caption, color: colors.ui.textFaint, marginTop: 2 },
  overdue: { color: colors.ui.error },
  rowEnd: { alignItems: 'flex-end' },
  amount: { ...typography.bodySemibold, color: colors.ui.text },
  struck: { color: colors.ui.textFaint, textDecorationLine: 'line-through' },
  badge: {
    ...typography.caption,
    color: colors.ui.incoming,
    backgroundColor: colors.ui.incomingSoft,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginTop: 4,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.divider },
  setup: {
    backgroundColor: colors.ui.accentSoft,
    borderWidth: 1,
    borderColor: colors.ui.accentBorder,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  setupTitle: { ...typography.bodySemibold, color: colors.ui.accentText },
  setupSub: { ...typography.caption, color: colors.ui.textDim, marginTop: 2 },
  danger: { ...typography.bodySemibold, color: colors.ui.error },
}));
