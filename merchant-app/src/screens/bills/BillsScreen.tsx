import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { DarkScreen, GlassCard, PillButton, ScreenHeader } from '../../components';
import {
  answerDirectPaymentRequest,
  Bill,
  BillSeries,
  cancelBill,
  DirectPaymentRequest,
  formatDueDate,
  hargeisaToday,
  merchantListBills,
  stopBillSeries,
} from '../../services/bills.service';
import { formatAmount } from '../../utils/money';
import { makeStyles, useColors } from '../../theme';

type Filter = 'open' | 'paid' | 'closed';

/**
 * The bills this shop has sent: unpaid, paid, and declined or withdrawn, and
 * the repeating bills still running. Withdrawing a bill or stopping a
 * repeating one moves no money and needs no PIN.
 */
export default function BillsScreen({ navigation }: { navigation: any }) {
  const colors = useColors();
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [series, setSeries] = useState<BillSeries[]>([]);
  const [requests, setRequests] = useState<DirectPaymentRequest[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await merchantListBills();
      setBills(res.bills);
      setSeries(res.series);
      setRequests(res.requests ?? []);
    } catch {
      setError(t('bills.loadFailed'));
      setBills((b) => b ?? []);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
  const shown = (bills ?? []).filter((b) =>
    filter === 'open' ? b.status === 'open' : filter === 'paid' ? b.status === 'paid' : b.status === 'declined' || b.status === 'cancelled',
  );
  const unpaidTotal = (bills ?? []).filter((b) => b.status === 'open' && b.currency === 'USD').reduce((s, b) => s + b.amount, 0);
  const day = (d: string) => formatDueDate(d, i18n.language);

  const answer = async (r: DirectPaymentRequest, approve: boolean) => {
    try {
      setBusy(r.id);
      await answerDirectPaymentRequest(r.id, approve);
      await load();
    } catch {
      Alert.alert(t('common.error'), t('bills.actionFailed'));
    } finally {
      setBusy(null);
    }
  };

  const statusLine = (b: Bill) => {
    if (b.status === 'open') {
      return b.dueDate < today ? t('bills.overdueSince', { date: day(b.dueDate) }) : t('bills.dueOn', { date: day(b.dueDate) });
    }
    if (b.status === 'paid') return b.paidBy === 'autopay' ? t('bills.paidAutomatically') : t('bills.status.paid');
    return t(`bills.status.${b.status}`);
  };

  return (
    <DarkScreen scroll>
      <ScreenHeader title={t('bills.title')} subtitle={t('bills.subtitle')} onBack={() => navigation.goBack()} />

      <View style={styles.pad}>
      <PillButton label={t('bills.send')} onPress={() => navigation.navigate('SendBill')} />

      {unpaidTotal > 0 ? (
        <Text style={styles.summary}>{t('bills.unpaidTotal', { amount: formatAmount(unpaidTotal, 'USD') })}</Text>
      ) : null}

      {requests.length > 0 ? (
        <>
          <Text style={styles.section}>{t('bills.requests.title')}</Text>
          {requests.map((r) => (
            <GlassCard key={r.id} style={styles.requestCard}>
              <Text style={styles.name}>{r.customerName}</Text>
              <Text style={styles.requestAmount}>
                {t(`bills.every.${r.interval}`, { amount: formatAmount(r.amount, r.currency) })}
              </Text>
              <Text style={styles.meta}>
                {r.description}{r.reference ? ` · ${r.reference}` : ''}
              </Text>
              <Text style={styles.meta}>{t('bills.requests.first', { date: day(r.firstDueDate) })}</Text>
              <Text style={styles.meta}>
                {r.autopay ? t('bills.requests.autopay') : t('bills.requests.manual')}
              </Text>
              {busy === r.id ? (
                <ActivityIndicator color={colors.ui.text} style={styles.requestSpinner} />
              ) : (
                <View style={styles.requestActions}>
                  <PillButton
                    label={t('bills.requests.decline')}
                    variant="glass"
                    onPress={() =>
                      confirmThen(
                        t('bills.requests.declineTitle'),
                        t('bills.requests.declineMessage', { customer: r.customerName }),
                        t('bills.requests.decline'),
                        r.id,
                        () => answerDirectPaymentRequest(r.id, false),
                      )
                    }
                    style={styles.requestButton}
                  />
                  <PillButton label={t('bills.requests.approve')} onPress={() => answer(r, true)} style={styles.requestButton} />
                </View>
              )}
            </GlassCard>
          ))}
        </>
      ) : null}

      <View style={styles.tabs}>
        {(['open', 'paid', 'closed'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabOn]}
            onPress={() => setFilter(f)}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextOn]}>{t(`bills.filter.${f}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {bills === null ? (
        <ActivityIndicator color={colors.ui.text} style={styles.spinner} />
      ) : shown.length === 0 ? (
        <Text style={styles.empty}>{t(`bills.empty.${filter}`)}</Text>
      ) : (
        <GlassCard style={styles.card}>
          {shown.map((b, i) => {
            const overdue = b.status === 'open' && b.dueDate < today;
            return (
              <View key={b.id}>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>{b.customerName}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {b.description}{b.reference ? ` · ${b.reference}` : ''}
                    </Text>
                    <Text style={[styles.meta, overdue && styles.overdue]}>
                      {statusLine(b)}{b.seriesId ? ` · ${t('bills.repeatingShort')}` : ''}
                    </Text>
                  </View>
                  <View style={styles.rowEnd}>
                    <Text style={[styles.amount, b.status === 'paid' && styles.paid]}>{formatAmount(b.amount, b.currency)}</Text>
                    {b.status === 'open' ? (
                      busy === b.id ? (
                        <ActivityIndicator color={colors.ui.text} />
                      ) : (
                        <TouchableOpacity
                          onPress={() =>
                            confirmThen(t('bills.withdrawTitle'), t('bills.withdrawMessage', { customer: b.customerName }), t('bills.withdraw'), b.id, () => cancelBill(b.id))
                          }
                          hitSlop={8}
                          accessibilityRole="button"
                        >
                          <Text style={styles.danger}>{t('bills.withdraw')}</Text>
                        </TouchableOpacity>
                      )
                    ) : null}
                  </View>
                </View>
                {i === shown.length - 1 ? null : <View style={styles.divider} />}
              </View>
            );
          })}
        </GlassCard>
      )}

      {series.length > 0 ? (
        <>
          <Text style={styles.section}>{t('bills.repeating')}</Text>
          <GlassCard style={styles.card}>
            {series.map((s, i) => (
              <View key={s.id}>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{s.customerName}</Text>
                    <Text style={styles.meta}>
                      {t(`bills.every.${s.interval}`, { amount: formatAmount(s.amount, s.currency) })} · {s.description}
                    </Text>
                    <Text style={styles.meta}>{t('bills.nextBill', { date: day(s.nextDueDate) })}</Text>
                  </View>
                  {busy === s.id ? (
                    <ActivityIndicator color={colors.ui.text} />
                  ) : (
                    <TouchableOpacity
                      onPress={() =>
                        confirmThen(t('bills.stopTitle'), t('bills.stopMessage', { customer: s.customerName }), t('bills.stop'), s.id, () => stopBillSeries(s.id))
                      }
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.danger}>{t('bills.stop')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {i === series.length - 1 ? null : <View style={styles.divider} />}
              </View>
            ))}
          </GlassCard>
        </>
      ) : null}
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  // DarkScreen leaves the sides to each screen; match the header's 24pt gutter.
  pad: { paddingHorizontal: 24, paddingBottom: 24 },
  summary: { fontSize: 14, color: colors.ui.textDim, marginTop: 14, textAlign: 'center' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: 14,
    padding: 4,
    marginTop: 20,
    marginBottom: 14,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabOn: { backgroundColor: colors.ui.accentSoft },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.ui.textDim },
  tabTextOn: { color: colors.ui.accentText },
  spinner: { marginTop: 32 },
  error: { fontSize: 14, color: colors.ui.error, marginBottom: 12 },
  empty: { fontSize: 15, color: colors.ui.textFaint, textAlign: 'center', marginTop: 24 },
  section: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.ui.textDim,
    marginTop: 22,
    marginBottom: 8,
  },
  card: { paddingHorizontal: 16, paddingVertical: 4 },
  requestCard: { padding: 16, marginBottom: 10 },
  requestAmount: { fontSize: 18, fontWeight: '700', color: colors.ui.text, marginTop: 4 },
  requestActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  requestButton: { flex: 1 },
  requestSpinner: { marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rowText: { flex: 1 },
  rowEnd: { alignItems: 'flex-end', gap: 6 },
  name: { fontSize: 16, fontWeight: '600', color: colors.ui.text },
  meta: { fontSize: 13, color: colors.ui.textFaint, marginTop: 2 },
  overdue: { color: colors.ui.error },
  amount: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  paid: { color: colors.ui.incoming },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.divider },
  danger: { fontSize: 14, fontWeight: '600', color: colors.ui.error },
}));
