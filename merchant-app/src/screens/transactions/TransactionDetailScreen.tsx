import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, ActivityIndicator, Share, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Transaction } from '../../types';
import { DarkScreen, GlassCard, PinInput } from '../../components';
import { functions } from '../../services/firebase.config';
import { newIdempotencyKey } from '../../utils/idempotency';
import { formatAmount, formatMajor, isShillings, sanitizeAmountFor, toAmount } from '../../utils/money';
import { pinActionErrorKey } from '../../utils/errors';
import { makeStyles, useColors, type Colors } from '../../theme';

interface Props {
  route: { params: { transaction: Transaction } };
  navigation: any;
}

const TYPE_KEYS: Record<string, string> = {
  payment: 'transactions.kind.payment',
  topup: 'transactions.kind.topup',
  withdrawal: 'transactions.kind.withdrawal',
  refund: 'transactions.kind.refund',
};

function statusStyle(status: string, colors: Colors) {
  switch (status) {
    case 'completed': return { color: colors.ui.incoming, bg: 'rgba(52,199,123,0.15)', border: 'rgba(52,199,123,0.3)' };
    case 'pending': return { color: colors.ui.warning, bg: 'rgba(255,176,46,0.15)', border: 'rgba(255,176,46,0.3)' };
    case 'failed': return { color: colors.ui.error, bg: 'rgba(255,59,48,0.15)', border: 'rgba(255,59,48,0.3)' };
    default: return { color: colors.ui.textDim, bg: colors.ui.divider, border: colors.ui.ink(0.12) };
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
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const { transaction } = route.params;

  const [refunded, setRefunded] = useState(!!transaction.refundedAt);
  const [refundStep, setRefundStep] = useState<'idle' | 'amount' | 'pin' | 'processing'>('idle');
  // Partial refunds (plan 3.3): cents given back so far, the amount being
  // refunded now, and one idempotency key per refund attempt.
  const [refundedCents, setRefundedCents] = useState(transaction.refundedCents ?? 0);
  // Refunds are in the payment's own currency. History rows carry whole
  // units (12.5 dollars, 30000 shillings); the server takes the smallest unit.
  const sls = isShillings(transaction.currency);
  const units = (n: number) => formatAmount(n, transaction.currency);
  const totalCents = sls ? Math.round(transaction.amount) : Math.round(transaction.amount * 100);
  const remainingCents = totalCents - refundedCents;
  const [refundText, setRefundText] = useState('');
  const [refundKey, setRefundKey] = useState(newIdempotencyKey);
  const refundCents = toAmount(refundText, transaction.currency);
  const refundValid = refundCents > 0 && refundCents <= remainingCents;
  const [pin, setPin] = useState('');

  const commission = transaction.type === 'topup' && !transaction.isIncoming && transaction.commission > 0;
  const incoming = transaction.isIncoming;
  const ss = statusStyle(transaction.status, colors);
  const statusLabel = t(`transaction.status.${transaction.status}`, transaction.status);
  // `kind` says what the row really is (a shop payment, P2P, payroll...);
  // `type` is the coarse fallback for rows from before it existed.
  const typeLabel = transaction.kind
    ? t(`transactions.kindLabel.${transaction.kind}`)
    : TYPE_KEYS[transaction.type]
      ? t(TYPE_KEYS[transaction.type])
      : transaction.type;

  const canRefund =
    transaction.type === 'payment' &&
    (!transaction.kind || transaction.kind === 'merchant_payment') &&
    transaction.isIncoming &&
    transaction.status === 'completed' &&
    !refunded &&
    remainingCents > 0;

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
  const heroColor = commission ? colors.ui.warning : incoming ? colors.ui.incoming : colors.ui.text;
  const heroSign = commission || incoming ? '+' : '−';

  const method = transaction.type === 'topup' ? parseMethod(transaction.description) : null;

  const shareReceipt = async () => {
    const lines = [
      t('transactions.receipt.title'),
      '',
      `${t('transactions.detail.type')}: ${typeLabel}`,
      transaction.counterpartyName ? `${t('transactions.receipt.party')}: ${transaction.counterpartyName}` : '',
      `${t('transactions.detail.amount')}: ${formatMajor(transaction.amount, transaction.currency)}`,
      transaction.fee > 0 ? `${t('transactions.detail.fee')}: ${formatMajor(transaction.fee, transaction.currency)}` : '',
      commission
        ? `${t('transactions.detail.commission')}: ${formatMajor(transaction.commission, transaction.currency)}`
        : `${t('transactions.detail.netReceived')}: ${formatMajor(transaction.net, transaction.currency)}`,
      `${t('transactions.detail.date')}: ${fmtDate(transaction.createdAt)}`,
      transaction.reference ? `${t('transactions.detail.reference')}: ${transaction.reference}` : '',
      // The number to quote back to the customer or to support; the raw id
      // only for payments made before receipt numbers existed.
      transaction.receiptNumber
        ? `${t('transactions.detail.receiptNumber')}: ${transaction.receiptNumber}`
        : `${t('transactions.detail.transactionId')}: ${transaction.id}`,
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // user dismissed the share sheet
    }
  };

  // A disputed transaction carries the id of the latest dispute on it; the
  // report screen checks with the server whether this shop already raised one.
  const reportProblem = () =>
    transaction.disputeId
      ? navigation.navigate('DisputeDetail', { disputeId: transaction.disputeId })
      : navigation.navigate('ReportProblem', { transactionId: transaction.id });

  const startRefund = () => {
    setRefundText(sls ? String(remainingCents) : (remainingCents / 100).toFixed(2));
    setRefundKey(newIdempotencyKey());
    setRefundStep('amount');
  };

  const handleRefund = async (enteredPin: string) => {
    setRefundStep('processing');
    const partial = refundCents < remainingCents || refundedCents > 0;
    try {
      const res = await functions().httpsCallable('refundPayment')({
        transactionId: transaction.id,
        pin: enteredPin,
        ...(partial ? { amountCents: refundCents, idempotencyKey: refundKey } : {}),
      });
      const left = (res.data as any)?.data?.remainingCents ?? 0;
      setRefundedCents(totalCents - left);
      if (left === 0) setRefunded(true);
      setRefundStep('idle');
      setPin('');
      Alert.alert(
        t('common.success'),
        left === 0
          ? t('transactions.refund.successMessage', { amount: units(refundCents) })
          : t('transactions.refund.partialSuccess', { amount: units(refundCents), left: units(left) }),
        left === 0 ? [{ text: t('common.ok'), onPress: () => navigation.goBack() }] : undefined
      );
    } catch (e: any) {
      const reason = e?.details?.reason;
      setPin('');
      // None of these changes with another PIN, so leave the keypad.
      if (reason === 'not_refundable' || reason === 'refund_window_closed' || reason === 'refund_amount') {
        Alert.alert(
          t('common.error'),
          reason === 'not_refundable'
            ? t('transactions.refund.notRefundable')
            : reason === 'refund_window_closed'
              ? t('transactions.refund.windowClosed', { days: e.details.refundWindowDays })
              : t('transactions.refund.amountTooHigh', { amount: units(e.details.remainingCents ?? 0) })
        );
        setRefundStep('idle');
        return;
      }
      Alert.alert(t('common.error'), t(pinActionErrorKey(e, 'transactions.refund.failed')));
      setRefundStep('pin');
    }
  };

  // ── How much to refund ──
  if (refundStep === 'amount') {
    return (
      <DarkScreen edges={[]} keyboard contentStyle={styles.pinWrap}>
        <Text style={styles.pinTitle}>{t('transactions.refund.amountTitle')}</Text>
        <Text style={styles.pinSubtitle}>
          {t('transactions.refund.amountHint', { amount: units(remainingCents) })}
        </Text>
        <TextInput
          style={styles.refundInput}
          value={refundText}
          onChangeText={(v) => setRefundText(sanitizeAmountFor(v, transaction.currency))}
          keyboardType={sls ? 'number-pad' : 'decimal-pad'}
          selectTextOnFocus
          accessibilityLabel={t('transactions.refund.amountTitle')}
        />
        <TouchableOpacity
          style={[styles.refundContinue, !refundValid && { opacity: 0.4 }]}
          disabled={!refundValid}
          onPress={() => setRefundStep('pin')}
        >
          <Text style={styles.refundContinueText}>{t('common.continue')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={() => setRefundStep('idle')}>
          <Text style={styles.backLinkText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </DarkScreen>
    );
  }

  // ── PIN entry for refund ──
  if (refundStep === 'pin' || refundStep === 'processing') {
    return (
      <DarkScreen edges={[]} keyboard contentStyle={styles.pinWrap}>
        <Text style={styles.pinTitle}>{t('transactions.refund.confirmTitle')}</Text>
        <Text style={styles.pinSubtitle}>
          {t('transactions.refund.confirmSubtitle', { amount: units(refundCents) })}
        </Text>
        {refundStep === 'processing' ? (
          <ActivityIndicator size="large" color={colors.ui.accent} style={{ marginTop: 32 }} />
        ) : (
          <>
            <PinInput value={pin} onChange={setPin} onComplete={handleRefund} style={styles.pinInput} autoFocus />
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
          {heroSign}{formatMajor(heroValue, transaction.currency)}
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
            <DetailRow label={t('transactions.detail.topupAmount')} value={formatMajor(transaction.amount, transaction.currency)} />
            <DetailRow label={t('transactions.detail.commission')} value={`+${formatMajor(transaction.commission, transaction.currency)}`} valueColor={colors.ui.warning} last />
          </>
        ) : transaction.type === 'payment' || transaction.type === 'refund' ? (
          <>
            <DetailRow label={t('transactions.detail.amount')} value={formatMajor(transaction.amount, transaction.currency)} />
            {transaction.fee > 0 && (
              <DetailRow label={t('transactions.detail.fee')} value={`−${formatMajor(transaction.fee, transaction.currency)}`} valueColor={colors.ui.textDim} />
            )}
            <DetailRow
              label={transaction.type === 'refund' ? t('transactions.detail.refundNet') : t('transactions.detail.netReceived')}
              value={`${incoming ? '+' : '−'}${formatMajor(transaction.net, transaction.currency)}`}
              valueColor={incoming ? colors.ui.incoming : colors.ui.error}
              last
            />
          </>
        ) : (
          <DetailRow label={t('transactions.detail.amount')} value={formatMajor(transaction.amount, transaction.currency)} last />
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
        {refundedCents > 0 && (
          <DetailRow
            label={t('transactions.refund.refundedLabel')}
            value={t('transactions.refund.refundedOf', { refunded: units(refundedCents), total: formatMajor(transaction.amount, transaction.currency) })}
          />
        )}
        {!!method && <DetailRow label={t('transactions.detail.method')} value={method} />}
        {!commission && !!transaction.description && (
          <DetailRow label={t('transactions.detail.description')} value={transaction.description} />
        )}
        {!!transaction.receiptNumber && (
          <DetailRow label={t('transactions.detail.receiptNumber')} value={transaction.receiptNumber} mono />
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
            tint={colors.ui.error}
            onPress={startRefund}
          />
        )}
        <ActionButton
          glyph="⚑"
          label={transaction.disputeId ? t('transactions.actions.viewDispute') : t('transactions.actions.report')}
          onPress={reportProblem}
        />
      </View>
    </DarkScreen>
  );
}

function TimelineRow({ label, time, last }: { label: string; time: string; last?: boolean }) {
  const styles = useStyles();
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
  const styles = useStyles();
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.75}>
      <Text style={[styles.actionGlyph, tint ? { color: tint } : null]}>{glyph}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function DetailRow({ label, value, valueColor, mono, last }: { label: string; value: string; valueColor?: string; mono?: boolean; last?: boolean }) {
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingVertical: 20, marginBottom: 20 },
  heroName: { fontSize: 18, fontWeight: '700', color: colors.ui.text, marginBottom: 2 },
  heroPhone: { fontSize: 13, color: colors.ui.textFaint, marginBottom: 14 },
  amountLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.ui.textFaint,
    marginBottom: 10,
  },
  amount: { fontSize: 46, fontWeight: '800', letterSpacing: -2, color: colors.ui.text, marginBottom: 16 },
  statusPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 9999, borderWidth: 1 },
  statusText: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  refundedPill: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 9999,
    backgroundColor: colors.ui.errorSoft,
    borderWidth: 1,
    borderColor: colors.ui.errorSoft,
  },
  refundedText: { fontSize: 12, fontWeight: '700', color: colors.ui.error },

  detailsCard: { paddingHorizontal: 16, marginBottom: 14 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ui.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 14, fontWeight: '500', color: colors.ui.ink(0.5) },
  rowValue: { fontSize: 14, fontWeight: '600', color: colors.ui.text, textAlign: 'right', flex: 1 },
  rowValueMono: { fontSize: 12, fontWeight: '500', color: colors.ui.textFaint },

  // timeline
  tlRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ui.divider,
  },
  tlDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.ui.incoming, marginTop: 4 },
  tlText: { flex: 1 },
  tlLabel: { fontSize: 14, fontWeight: '600', color: colors.ui.text },
  tlTime: { fontSize: 12, color: colors.ui.textFaint, marginTop: 2 },

  // actions
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: 14,
    paddingVertical: 14,
  },
  actionGlyph: { fontSize: 20, color: colors.ui.accentText, fontWeight: '700' },
  actionLabel: { fontSize: 12, color: colors.ui.ink(0.7), fontWeight: '600' },

  // pin
  pinWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  pinTitle: { fontSize: 22, fontWeight: '800', color: colors.ui.text, marginBottom: 8, textAlign: 'center' },
  pinSubtitle: { fontSize: 14, color: colors.ui.textDim, textAlign: 'center', marginBottom: 28, lineHeight: 20 },
  pinInput: { width: '100%' },
  backLink: { marginTop: 28, padding: 8 },
  refundInput: {
    marginTop: 28,
    minWidth: 200,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.ink(0.12),
    color: colors.ui.text,
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
  },
  refundContinue: { marginTop: 24, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 999, backgroundColor: colors.ui.accent },
  refundContinueText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  backLinkText: { fontSize: 14, color: colors.ui.textDim, fontWeight: '600' },
}));
