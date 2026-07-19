import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTransactions } from '../../hooks/useTransactions';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { Transaction } from '../../types';

// ─── Period ───────────────────────────────────────────────────

type Period = '7d' | '30d' | '3m';

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '3m': 90 };

// ─── Computation helpers ───────────────────────────────────────

function cutoff(period: Period): Date {
  const d = new Date();
  d.setDate(d.getDate() - PERIOD_DAYS[period]);
  d.setHours(0, 0, 0, 0);
  return d;
}

function filterPeriod(txs: Transaction[], period: Period): Transaction[] {
  const from = cutoff(period);
  return txs.filter(tx => tx.status === 'completed' && new Date(tx.createdAt) >= from);
}

function computeSummary(txs: Transaction[]) {
  let out = 0;
  let income = 0;
  for (const tx of txs) {
    if (tx.isIncoming) income += tx.amount;
    else out += tx.amount;
  }
  return { out, income, net: income - out };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildTrendBuckets(period: Period) {
  const now = new Date();
  const weekly = period === '3m';
  const count = weekly ? 13 : PERIOD_DAYS[period];
  const buckets: { label: string; start: Date; end: Date; value: number }[] = [];

  for (let i = count - 1; i >= 0; i--) {
    if (weekly) {
      const end = new Date(now);
      end.setDate(now.getDate() - i * 7);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      buckets.push({ label: `${start.getMonth() + 1}/${start.getDate()}`, start, end, value: 0 });
    } else {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const start = new Date(day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(day);
      end.setHours(23, 59, 59, 999);
      const label = i === 0 ? 'Today' : DAY_NAMES[day.getDay()];
      buckets.push({ label, start, end, value: 0 });
    }
  }
  return buckets;
}

function computeTrend(txs: Transaction[], period: Period) {
  const buckets = buildTrendBuckets(period);
  for (const tx of txs) {
    if (tx.isIncoming) continue;
    const d = new Date(tx.createdAt);
    for (const b of buckets) {
      if (d >= b.start && d <= b.end) {
        b.value += tx.amount;
        break;
      }
    }
  }
  return buckets;
}

const TYPE_LABELS: Record<string, string> = {
  payment: 'Payments',
  withdrawal: 'Cash-outs',
  topup: 'Top-ups',
  refund: 'Refunds',
  referral: 'Referral',
};

function computeBreakdown(txs: Transaction[]) {
  const outgoing = txs.filter(tx => !tx.isIncoming);
  const total = outgoing.reduce((s, tx) => s + tx.amount, 0);
  const byType: Record<string, number> = {};
  for (const tx of outgoing) byType[tx.type] = (byType[tx.type] || 0) + tx.amount;
  return Object.entries(byType)
    .map(([type, amount]) => ({
      type,
      label: TYPE_LABELS[type] ?? type,
      amount,
      pct: total > 0 ? amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function computeTopRecipients(txs: Transaction[]) {
  const map: Record<string, { name: string; count: number; total: number }> = {};
  for (const tx of txs) {
    const name = tx.counterpartyName;
    if (tx.isIncoming || !name) continue;
    if (!map[name]) map[name] = { name, count: 0, total: 0 };
    map[name].count++;
    map[name].total += tx.amount;
  }
  return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
}

const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;

function initials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─── Bar chart ────────────────────────────────────────────────

const BAR_MAX_H = 54;

function TrendChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map(d => d.value), 0.01);
  const showLabels = data.length <= 7;

  return (
    <View>
      <View style={chart.bars}>
        {data.map((d, i) => (
          <View key={i} style={chart.col}>
            <View style={chart.track}>
              <View
                style={[
                  chart.bar,
                  { height: d.value > 0 ? Math.max((d.value / max) * BAR_MAX_H, 3) : 0 },
                ]}
              />
            </View>
            {showLabels && <Text style={chart.label}>{d.label}</Text>}
          </View>
        ))}
      </View>
      {!showLabels && (
        <View style={chart.axis}>
          <Text style={chart.axisLabel}>{data[0]?.label}</Text>
          <Text style={chart.axisLabel}>Today</Text>
        </View>
      )}
    </View>
  );
}

const chart = StyleSheet.create({
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BAR_MAX_H + 20,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  track: {
    width: '68%',
    height: BAR_MAX_H,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 3,
    backgroundColor: colors.dark.accent,
    opacity: 0.85,
  },
  label: {
    fontSize: 9,
    color: colors.dark.textFaint,
    marginTop: 4,
    textAlign: 'center',
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  axisLabel: {
    ...typography.caption,
    color: colors.dark.textFaint,
  },
});

// ─── Screen ───────────────────────────────────────────────────

export default function InsightsScreen() {
  const { t } = useTranslation();
  const { transactions, loading } = useTransactions(undefined, 100);
  const [period, setPeriod] = useState<Period>('30d');

  const filtered = useMemo(() => filterPeriod(transactions, period), [transactions, period]);
  const summary = useMemo(() => computeSummary(filtered), [filtered]);
  const trend = useMemo(() => computeTrend(filtered, period), [filtered, period]);
  const breakdown = useMemo(() => computeBreakdown(filtered), [filtered]);
  const topRecipients = useMemo(() => computeTopRecipients(filtered), [filtered]);
  const hasData = filtered.length > 0;

  const PERIODS: { key: Period; label: string }[] = [
    { key: '7d', label: t('insights.period7d') },
    { key: '30d', label: t('insights.period30d') },
    { key: '3m', label: t('insights.period3m') },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* Period selector */}
      <View style={styles.pillRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.pill, period === p.key && styles.pillActive]}
            onPress={() => setPeriod(p.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.pillText, period === p.key && styles.pillTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.dark.accent} style={styles.loader} />
      ) : (
        <>
          {/* Summary row */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text
                style={[styles.summaryAmt, { color: colors.dark.error }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {fmt(summary.out)}
              </Text>
              <Text style={styles.summaryLabel}>{t('insights.moneyOut')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text
                style={[styles.summaryAmt, { color: colors.dark.incoming }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {fmt(summary.income)}
              </Text>
              <Text style={styles.summaryLabel}>{t('insights.moneyIn')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text
                style={[
                  styles.summaryAmt,
                  { color: summary.net >= 0 ? colors.dark.incoming : colors.dark.error },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {summary.net >= 0 ? '+' : '-'}{fmt(summary.net)}
              </Text>
              <Text style={styles.summaryLabel}>{t('insights.net')}</Text>
            </View>
          </View>

          {!hasData ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('insights.noData')}</Text>
            </View>
          ) : (
            <>
              {/* Spending trend */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('insights.spendTrend')}</Text>
                <TrendChart data={trend} />
              </View>

              {/* Where it goes */}
              {breakdown.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('insights.whereItGoes')}</Text>
                  <View style={styles.breakdownList}>
                    {breakdown.map(b => (
                      <View key={b.type} style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>{b.label}</Text>
                        <View style={styles.breakdownTrack}>
                          <View
                            style={[
                              styles.breakdownFill,
                              { width: `${Math.round(b.pct * 100)}%` as `${number}%` },
                            ]}
                          />
                        </View>
                        <Text style={styles.breakdownAmt}>{fmt(b.amount)}</Text>
                        <Text style={styles.breakdownPct}>{Math.round(b.pct * 100)}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Top recipients */}
              {topRecipients.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('insights.topRecipients')}</Text>
                  {topRecipients.map((r, i) => (
                    <View
                      key={r.name}
                      style={[
                        styles.recipientRow,
                        i === topRecipients.length - 1 && styles.recipientRowLast,
                      ]}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initials(r.name)}</Text>
                      </View>
                      <View style={styles.recipientInfo}>
                        <Text style={styles.recipientName}>{r.name}</Text>
                        <Text style={styles.recipientCount}>
                          {t(
                            r.count === 1
                              ? 'insights.paymentCount_one'
                              : 'insights.paymentCount_other',
                            { count: r.count },
                          )}
                        </Text>
                      </View>
                      <Text style={styles.recipientTotal}>{fmt(r.total)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  loader: {
    marginTop: spacing.xxl,
  },

  // Period pills
  pillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  pill: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
  pillActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  pillText: {
    ...typography.captionBold,
    color: colors.dark.textDim,
  },
  pillTextActive: {
    color: '#fff',
  },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  summaryAmt: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.dark.textFaint,
    textAlign: 'center',
  },

  // Cards
  card: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    ...typography.captionBold,
    color: colors.dark.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.md,
  },

  // Empty state
  emptyCard: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.dark.textFaint,
  },

  // Breakdown
  breakdownList: {
    gap: spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breakdownLabel: {
    ...typography.caption,
    color: colors.dark.textDim,
    width: 76,
  },
  breakdownTrack: {
    flex: 1,
    height: 6,
    backgroundColor: `${colors.dark.glassBorder}`,
    borderRadius: 3,
    marginHorizontal: spacing.sm,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
    backgroundColor: colors.dark.accent,
    borderRadius: 3,
  },
  breakdownAmt: {
    ...typography.caption,
    color: colors.dark.text,
    width: 48,
    textAlign: 'right',
  },
  breakdownPct: {
    ...typography.caption,
    color: colors.dark.textFaint,
    width: 34,
    textAlign: 'right',
  },

  // Top recipients
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.dark.divider,
  },
  recipientRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.dark.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    ...typography.captionBold,
    color: colors.dark.accentText,
  },
  recipientInfo: {
    flex: 1,
  },
  recipientName: {
    ...typography.body,
    color: colors.dark.text,
  },
  recipientCount: {
    ...typography.caption,
    color: colors.dark.textFaint,
  },
  recipientTotal: {
    ...typography.bodySemibold,
    color: colors.dark.text,
  },
});
