import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { Header } from '../../components/Header';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import {
  Bill,
  BillAutopay,
  BillSeries,
  formatDueDate,
  listMyBills,
} from '../../services/bills.service';
import { typography, spacing, borderRadius, makeStyles, useColors } from '../../theme';
import { formatMoney } from '../../utils/money';
import { logger } from '../../utils/logger';

/**
 * The receipt for a direct payment the shop has just approved: what was set
 * up, with whom, how often and when the next payment is. Read-only on
 * purpose: it is opened from the "approved" push, and a Pay button here read
 * as "you still owe something" to a customer who had only set it up. Paying
 * or changing it happens in Bills.
 */
type Params = { DirectPaymentReceipt: { seriesId: string; requestId?: string } };

interface Loaded {
  series: BillSeries | null;
  /** The earliest bill of this series still to be paid, if any. */
  nextBill: Bill | null;
  autopay: BillAutopay | null;
}

export default function DirectPaymentReceiptScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const { seriesId, requestId } = useRoute<RouteProp<Params, 'DirectPaymentReceipt'>>().params;

  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const mine = await listMyBills();
      const series = mine.series.find((s) => s.id === seriesId) ?? null;
      const nextBill =
        mine.bills
          .filter((b) => b.seriesId === seriesId && b.status === 'open')
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
      const autopay = series
        ? mine.autopay.find(
            (a) => a.merchantId === series.merchantId && a.currency === series.currency && a.maxAmount >= series.amount,
          ) ?? null
        : null;
      setData({ series, nextBill, autopay });
    } catch (err) {
      logger.error('Load direct payment failed:', err);
      setFailed(true);
    }
  }, [seriesId]);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Bills');
  };
  const openBills = () => navigation.navigate('Bills');

  const header = <Header title={t('bills.request.title')} onBack={close} />;

  if (failed) {
    return (
      <View style={styles.container}>
        {header}
        <View style={[styles.centered, styles.padded]}>
          <Text style={styles.body}>{t('bills.setUp.loadFailed')}</Text>
          <TouchableOpacity style={styles.primary} onPress={load} accessibilityRole="button">
            <Text style={styles.primaryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        {header}
        <ActivityIndicator size="large" color={colors.ui.accent} style={styles.spinner} />
      </View>
    );
  }

  const { series, nextBill, autopay } = data;

  // Stopped since (listMyBills only returns active ones), or not this customer's.
  if (!series) {
    return (
      <View style={styles.container}>
        {header}
        <View style={[styles.centered, styles.padded]}>
          <Text style={styles.body}>{t('bills.setUp.notActive')}</Text>
          <TouchableOpacity style={styles.primary} onPress={openBills} accessibilityRole="button">
            <Text style={styles.primaryText}>{t('bills.setUp.manage')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const amount = formatMoney(series.amount, series.currency);
  const nextDate = formatDueDate(nextBill?.dueDate ?? series.nextDueDate, i18n.language);

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.icon}><SuccessCheckIcon size={64} /></View>
        <Text style={[styles.title, styles.center]}>{t('bills.setUp.title')}</Text>
        <Text style={[styles.body, styles.center]}>
          {t('bills.setUp.approved', { merchant: series.merchantName })}
        </Text>
        <View style={styles.pill}>
          <View style={styles.dot} />
          <Text style={styles.pillText}>{t('bills.setUp.active')}</Text>
        </View>

        <View style={styles.card}>
          <Detail label={t('bills.request.shop')} value={series.merchantName} />
          <Detail label={t('bills.for')} value={series.description} />
          {series.reference ? <Detail label={t('bills.reference')} value={series.reference} /> : null}
          <Detail label={t('bills.request.amount')} value={t(`bills.every.${series.interval}`, { amount })} />
          <Detail label={t('bills.setUp.nextPayment')} value={nextDate} />
          <Detail
            label={t('bills.setUp.howPaid')}
            value={autopay ? t('bills.paidByAutopay') : t('bills.setUp.paidByYou')}
          />
          {requestId ? <Detail label={t('bills.setUp.id')} value={requestId} mono /> : null}
        </View>

        <Text style={styles.note}>
          {autopay
            ? t('bills.setUp.noteAutopay', { merchant: series.merchantName, date: nextDate })
            : t('bills.setUp.noteManual', { merchant: series.merchantName, date: nextDate })}
        </Text>

        <TouchableOpacity style={styles.primary} onPress={close} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('common.done')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={openBills} accessibilityRole="button">
          <Text style={styles.link}>{t('bills.setUp.manage')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.mono]} selectable={mono}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas },
  padded: { paddingHorizontal: spacing.lg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  center: { textAlign: 'center' },
  spinner: { marginTop: spacing.xxl },
  icon: { alignSelf: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
  title: { ...typography.h2, color: colors.ui.text, marginBottom: spacing.sm },
  body: { ...typography.body, color: colors.ui.textDim, textAlign: 'center', marginBottom: spacing.md },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    backgroundColor: colors.ui.incomingSoft,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.lg,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ui.incoming },
  pillText: { ...typography.caption, color: colors.ui.incoming },
  card: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  detailLabel: { ...typography.body, color: colors.ui.textFaint },
  detailValue: { ...typography.bodySemibold, color: colors.ui.text, flexShrink: 1, textAlign: 'right' },
  mono: { ...typography.caption, fontFamily: 'Menlo', color: colors.ui.textDim },
  note: { ...typography.caption, color: colors.ui.textDim, marginBottom: spacing.lg },
  primary: {
    backgroundColor: colors.ui.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: spacing.sm,
  },
  primaryText: { ...typography.h3, color: '#FFFFFF' },
  secondary: { paddingVertical: spacing.md, alignItems: 'center' },
  link: { ...typography.bodySemibold, color: colors.ui.accentText },
}));
