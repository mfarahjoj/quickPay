import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { Transaction } from '../../types';
import { DarkScreen, GlassCard, PinInput, ACCENT, TEXT_DIM, TEXT_FAINT } from '../../components';
import { refundPayment } from '../../services/transaction.service';

interface Props {
  route: { params: { transaction: Transaction } };
  navigation: any;
}

const GREEN = '#34C77B';
const GOLD = '#F5B544';
const RED = '#FF6961';

const TYPE_KEYS: Record<string, string> = {
  payment: 'transactions.kind.payment',
  topup: 'transactions.kind.topup',
  withdrawal: 'transactions.kind.withdrawal',
  refund: 'transactions.kind.refund',
};

function money(n: number) {
  return `${CURRENCY_SYMBOL}${(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusStyle(status: string) {
  switch (status) {
    case 'completed': return { color: GREEN, bg: 'rgba(52,199,123,0.15)', border: 'rgba(52,199,123,0.3)' };
    case 'pending': return { color: '#FFB02E', bg: 'rgba(255,176,46,0.15)', border: 'rgba(255,176,46,0.3)' };
    case 'failed': return { color: RED, bg: 'rgba(255,59,48,0.15)', border: 'rgba(255,59,48,0.3)' };
    default: return { color: TEXT_DIM, bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)' };
  }
}

/** Pull the payment method out of "Manual top-up by agent (cash)" style text. */
function parseMethod(description?: string): string | null {
  const m = description?.match(/\(([^)]+)\)/);
  if (!m) return null;
  const raw = m[1].trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function fmtDate(d?: Date) {
  return d instanceof Date ? d.toLocaleString() : '';
}

export default function TransactionDetailScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { transaction } = route.params;

  const [refunded, setRefunded] = useState(!!transaction.refundedAt);
  const [refundStep, setRefundStep] = useState<'idle' | 'pin' | 'processing'>('idle');
  const [pin, setPin] = useState('');

  const commission = transaction.type === 'topup' && !transaction.isIncoming && transaction.commission > 0;
  const incoming = transaction.isIncoming;
  const ss = statusStyle(transaction.status);
  const statusLabel = t(`transaction.status.${transaction.status}`, transaction.status);
  const typeLabel = TYPE_KEYS[transaction.type] ? t(TYPE_KEYS[transaction.type]) : transaction.type;

  const canRefund =
    transaction.type === 'payment' &&
    transaction.isIncoming &&
    transaction.status === 'completed' &&
    !refunded;

  const heroLabel = commission
    ? t('transactions.detail.commissionEarned')
    : transaction.type === 'payment' && incoming
    ? t('transactions.detail.netReceived')
    : incoming
    ? t('transactions.detail.received')
    : t('transactions.detail.sent');

  const heroValue = commission
    ? transaction.commission
    : transaction.type === 'payment' || transaction.type === 'refund'
    ? transaction.net
    : transaction.amount;
  const heroColor = commission ? GOLD : incoming ? GREEN : '#FFFFFF';
  const heroSign = commission || incoming ? '+' : '−';

  const method = transaction.type === 'topup' ? parseMethod(transaction.description) : null;

  const shareReceipt = async () => {
    const lines = [
      t('transactions.receipt.title'),
      '',
      `${t('transactions.detail.type')}: ${typeLabel}`,
      transaction.counterpartyName ? `${t('transactions.receipt.party')}: ${transaction.counterpartyName}` : '',
      `${t('transactions.detail.amount')}: ${money(transaction.amount)}`,
      transaction.fee > 0 ? `${t('transactions.detail.fee')}: ${money(transaction.fee)}` : '',
      commission
        ? `${t('transactions.detail.commission')}: ${money(transaction.commission)}`
        : `${t('transactions.detail.netReceived')}: ${money(transaction.net)}`,
      `${t('transactions.detail.date')}: ${fmtDate(transaction.createdAt)}`,
      transaction.reference ? `${t('transactions.detail.reference')}: ${transaction.reference}` : '',
      `${t('transactions.detail.transactionId')}: ${transaction.id}`,
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // user dismissed the share sheet
    }
  };

  const reportProblem = () => {
    Alert.alert(
      t('transactions.report.title'),
      t('transactions.report.message', { id: transaction.id })
    );
  };

  const handleRefund = async (enteredPin: string) => {
    setRefundStep('processing');
    try {
      await refundPayment(transaction.id, enteredPin);
      setRefunded(true);
      setRefundStep('idle');
      Alert.alert(
        t('common.success'),
        t('transactions.refund.successMessage', { amount: money(transaction.amount) }),
        [{ text: t('common.ok'), onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      Alert.alert(t('common.error'), e.message || t('transactions.refund.failed'));
      setPin('');
      setRefundStep('pin');
    }
  };

  // ── PIN entry for refund ──
  if (refundStep === 'pin' || refundStep === 'processing') {
    return (
      <DarkScreen edges={[]} keyboard contentStyle={styles.pinWrap}>
        <Text style={styles.pinTitle}>{t('transactions.refund.confirmTitle')}</Text>
        <Text style={styles.pinSubtitle}>
          {t('transactions.refund.confirmSubtitle', { amount: money(transaction.amount) })}
        </Text>
        {refundStep === 'processing' ? (
          <ActivityIndicator size="large" color={ACCENT} style={{ marginTop: 32 }} />
        ) : (
          <>
            <PinInput value={pin} onChange={setPin} onComplete={handleRefund} style={styles.pinInput} />
            <TouchableOpacity
              style={styles.backLink}
              onPress={() => { setPin(''); setRefundStep('idle'); }}
            >
              <Text style={styles.backLinkText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </>
        )}
      </DarkScreen>
    );
  }

  return (
    <DarkScreen edges={[]} scroll contentStyle={styles.content}>
      {/* Amount hero */}
      <View style={styles.hero}>
        {!!transaction.counterpartyName && (
          <Text style={styles.heroName}>{transaction.counterpartyName}</Text>
        )}
        {!!transaction.counterpartyPhone && (
          <Text style={styles.heroPhone}>{transaction.counterpartyPhone}</Text>
        )}
        <Text style={styles.amountLabel}>{heroLabel}</Text>
        <Text style={[styles.amount, { color: heroColor }]}>
          {heroSign}{money(heroValue)}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: ss.bg, borderColor: ss.border }]}>
          <Text style={[styles.statusText, { color: ss.color }]}>{statusLabel}</Text>
        </View>
        {refunded && (
          <View style={styles.refundedPill}>
            <Text style={styles.refundedText}>{t('transactions.detail.refundedBadge')}</Text>
          </View>
        )}
      </View>

      {/* Money breakdown */}
      <GlassCard style={styles.detailsCard}>
        {commission ? (
          <>
            <DetailRow label={t('transactions.detail.topupAmount')} value={money(transaction.amount)} />
            <DetailRow label={t('transactions.detail.commission')} value={`+${money(transaction.commission)}`} valueColor={GOLD} last />
          </>
        ) : transaction.type === 'payment' || transaction.type === 'refund' ? (
          <>
            <DetailRow label={t('transactions.detail.amount')} value={money(transaction.amount)} />
            {transaction.fee > 0 && (
              <DetailRow label={t('transactions.detail.fee')} value={`−${money(transaction.fee)}`} valueColor={TEXT_DIM} />
            )}
            <DetailRow
              label={transaction.type === 'refund' ? t('transactions.detail.refundNet') : t('transactions.detail.netReceived')}
              value={`${incoming ? '+' : '−'}${money(transaction.net)}`}
              valueColor={incoming ? GREEN : RED}
              last
            />
          </>
        ) : (
          <DetailRow label={t('transactions.detail.amount')} value={money(transaction.amount)} last />
        )}
      </GlassCard>

      {/* Status timeline */}
      <GlassCard style={styles.detailsCard}>
        <TimelineRow
          label={t('transactions.timeline.initiated')}
          time={fmtDate(transaction.createdAt)}
        />
        {!!transaction.completedAt && (
          <TimelineRow
            label={
              transaction.type === 'topup'
                ? t('transactions.timeline.credited')
                : transaction.type === 'refund'
                ? t('transactions.timeline.refunded')
                : t('transactions.timeline.completed')
            }
            time={fmtDate(transaction.completedAt)}
            last
          />
        )}
      </GlassCard>

      {/* Meta */}
      <GlassCard style={styles.detailsCard}>
        <DetailRow label={t('transactions.detail.type')} value={typeLabel} />
        {!!method && <DetailRow label={t('transactions.detail.method')} value={method} />}
        {!commission && !!transaction.description && (
          <DetailRow label={t('transactions.detail.description')} value={transaction.description} />
        )}
        {!!transaction.reference && (
          <DetailRow label={t('transactions.detail.reference')} value={transaction.reference} />
        )}
        <DetailRow
          label={t('transactions.detail.date')}
          value={transaction.createdAt instanceof Date ? transaction.createdAt.toLocaleString() : String(transaction.createdAt)}
        />
        <DetailRow label={t('transactions.detail.transactionId')} value={transaction.id} mono last />
      </GlassCard>

      {/* Actions */}
      <View style={styles.actions}>
        <ActionButton glyph="↗" label={t('transactions.actions.receipt')} onPress={shareReceipt} />
        {canRefund && (
          <ActionButton
            glyph="↩"
            label={t('transactions.refund.action')}
            tint={RED}
            onPress={() =>
              Alert.alert(
                t('transactions.refund.confirmTitle'),
                t('transactions.refund.confirmSubtitle', { amount: money(transaction.amount) }),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('transactions.refund.action'), style: 'destructive', onPress: () => setRefundStep('pin') },
                ]
              )
            }
          />
        )}
        <ActionButton glyph="⚑" label={t('transactions.actions.report')} onPress={reportProblem} />
      </View>
    </DarkScreen>
  );
}

function TimelineRow({ label, time, last }: { label: string; time: string; last?: boolean }) {
  return (
    <View style={[styles.tlRow, last && styles.rowLast]}>
      <View style={styles.tlDot} />
      <View style={styles.tlText}>
        <Text style={styles.tlLabel}>{label}</Text>
        <Text style={styles.tlTime}>{time}</Text>
      </View>
    </View>
  );
}

function ActionButton({ glyph, label, onPress, tint }: { glyph: string; label: string; onPress: () => void; tint?: string }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.75}>
      <Text style={[styles.actionGlyph, tint ? { color: tint } : null]}>{glyph}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function DetailRow({ label, value, valueColor, mono, last }: { label: string; value: string; valueColor?: string; mono?: boolean; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, valueColor ? { color: valueColor } : null, mono && styles.rowValueMono]}
        numberOfLines={mono ? 1 : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingVertical: 20, marginBottom: 20 },
  heroName: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 },
  heroPhone: { fontSize: 13, color: TEXT_FAINT, marginBottom: 14 },
  amountLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: TEXT_FAINT,
    marginBottom: 10,
  },
  amount: { fontSize: 46, fontWeight: '800', letterSpacing: -2, color: '#FFFFFF', marginBottom: 16 },
  statusPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 9999, borderWidth: 1 },
  statusText: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  refundedPill: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,105,97,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,105,97,0.3)',
  },
  refundedText: { fontSize: 12, fontWeight: '700', color: RED },

  detailsCard: { paddingHorizontal: 16, marginBottom: 14 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.5)' },
  rowValue: { fontSize: 14, fontWeight: '600', color: '#FFFFFF', textAlign: 'right', flex: 1 },
  rowValueMono: { fontSize: 12, fontWeight: '500', color: TEXT_FAINT },

  // timeline
  tlRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tlDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: GREEN, marginTop: 4 },
  tlText: { flex: 1 },
  tlLabel: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  tlTime: { fontSize: 12, color: TEXT_FAINT, marginTop: 2 },

  // actions
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingVertical: 14,
  },
  actionGlyph: { fontSize: 20, color: '#FF8A7A', fontWeight: '700' },
  actionLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },

  // pin
  pinWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  pinTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginBottom: 8, textAlign: 'center' },
  pinSubtitle: { fontSize: 14, color: TEXT_DIM, textAlign: 'center', marginBottom: 28, lineHeight: 20 },
  pinInput: { width: '100%' },
  backLink: { marginTop: 28, padding: 8 },
  backLinkText: { fontSize: 14, color: TEXT_DIM, fontWeight: '600' },
});
