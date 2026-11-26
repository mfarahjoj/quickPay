import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { DarkScreen, GlassCard, PillButton, PinInput, ScreenHeader } from '../../components';
import {
  capCents,
  refundForShop,
  staffErrorReason,
  type StaffPayment,
  type StaffRefundLimits,
} from '../../services/staff.service';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { newIdempotencyKey } from '../../utils/idempotency';
import { formatAmount, formatCents, isShillings, sanitizeAmountFor, toAmount } from '../../utils/money';
import { logger } from '../../utils/logger';
import { makeStyles, useColors } from '../../theme';

type Params = { payment: StaffPayment; limits: StaffRefundLimits };

/**
 * A manager refunding one of the shop's payments (STAFF_ACCESS.md): how much,
 * then their own PIN. The money comes from the shop's wallet, never the
 * manager's, and the shop is told. The server holds anything over the limits;
 * this screen only warns first.
 */
export default function StaffRefundScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { payment, limits } = useRoute<any>().params as Params;
  const sls = isShillings(payment.currency);
  const fmt = (amount: number) => formatAmount(amount, payment.currency);

  const [step, setStep] = useState<'amount' | 'pin' | 'sending'>('amount');
  const [text, setText] = useState(() => (sls ? String(payment.remaining) : (payment.remaining / 100).toFixed(2)));
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  // One key per attempt, kept across a retry so a dropped answer can't refund twice.
  const [key] = useState(newIdempotencyKey);

  const amount = toAmount(text, payment.currency);
  const partial = amount < payment.amount || payment.refunded > 0;
  const inLimits = capCents(amount, payment.currency, limits.slsPerUsd);
  const leftToday = Math.max(limits.dayCapCents - limits.usedTodayCents, 0);

  const warning = useMemo(() => {
    if (amount <= 0) return '';
    if (amount > payment.remaining) return t('transactions.refund.amountTooHigh', { amount: fmt(payment.remaining) });
    if (inLimits > limits.capCents) return t('staffRefund.overCap', { amount: formatCents(limits.capCents) });
    if (inLimits > leftToday) return t('staffRefund.overDay', { amount: formatCents(leftToday) });
    return '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, inLimits, leftToday]);

  const valid = amount > 0 && !warning;

  const send = async (entered: string) => {
    setStep('sending');
    setError('');
    try {
      const out = await refundForShop(payment.id, entered, amount, partial, key);
      Alert.alert(
        t('staffRefund.doneTitle'),
        out.remainingCents > 0
          ? t('transactions.refund.partialSuccess', { amount: fmt(amount), left: fmt(out.remainingCents) })
          : t('transactions.refund.successMessage', { amount: fmt(amount) }),
        [{ text: t('common.done'), onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      logger.error('Staff refund failed:', err);
      setPin('');
      if (isWrongPin(err)) {
        setError(t('errors.wrongPin'));
        setStep('pin');
        return;
      }
      const reason = staffErrorReason(err);
      const d = err?.details ?? {};
      const message =
        reason === 'staff_refund_over_cap'
          ? t('staffRefund.overCap', { amount: formatCents(d.capCents ?? limits.capCents) })
          : reason === 'staff_refund_day_cap'
            ? t('staffRefund.overDay', { amount: formatCents(Math.max((d.dayCapCents ?? 0) - (d.usedCents ?? 0), 0)) })
            : reason === 'staff_refund_own_payment'
            ? t('staffRefund.ownPayment')
            : reason === 'staff_access_denied'
              ? t('staffRefund.noAccess')
              : reason === 'not_refundable'
                ? t('transactions.refund.notRefundable')
                : reason === 'refund_key_reused'
                ? t('transactions.refund.alreadyMade')
                : reason === 'refund_window_closed'
                  ? t('transactions.refund.windowClosed', { days: d.refundWindowDays ?? limits.refundWindowDays })
                  : reason === 'refund_amount'
                    ? t('transactions.refund.amountTooHigh', { amount: fmt(d.remainingCents ?? 0) })
                    : t(pinActionErrorKey(err));
      setError(message);
      setStep('amount');
    }
  };

  if (step !== 'amount') {
    return (
      <DarkScreen keyboard contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('transactions.refund.confirmTitle')}</Text>
        <Text style={styles.sub}>{t('staffRefund.pinSubtitle', { amount: fmt(amount) })}</Text>
        {step === 'sending' ? (
          <ActivityIndicator size="large" color={colors.ui.accent} style={styles.spinner} />
        ) : (
          <>
            <PinInput
              value={pin}
              onChange={(v) => {
                setPin(v);
                if (error) setError('');
              }}
              onComplete={send}
              style={styles.pinInput}
              autoFocus
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.block}>
              <PillButton label={t('common.cancel')} variant="glass" onPress={() => { setPin(''); setStep('amount'); }} />
            </View>
          </>
        )}
      </DarkScreen>
    );
  }

  return (
    <DarkScreen keyboard scroll contentStyle={styles.content}>
      <ScreenHeader title={t('staffRefund.refundTitle')} onBack={() => navigation.goBack()} />
      <GlassCard style={styles.card}>
        <Text style={styles.hint}>{payment.customerName ?? t('staffRefund.customer')}</Text>
        <Text style={styles.total}>{fmt(payment.amount)}</Text>
        {payment.refunded > 0 ? (
          <Text style={styles.meta}>{t('staffRefund.refundedSome', { amount: fmt(payment.refunded) })}</Text>
        ) : null}
        {payment.receiptNumber ? <Text style={styles.meta}>{payment.receiptNumber}</Text> : null}
      </GlassCard>

      <Text style={styles.label}>{t('transactions.refund.amountTitle')}</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={(v) => {
          setText(sanitizeAmountFor(v, payment.currency));
          if (error) setError('');
        }}
        keyboardType={sls ? 'number-pad' : 'decimal-pad'}
        selectTextOnFocus
        accessibilityLabel={t('transactions.refund.amountTitle')}
      />
      <Text style={styles.help}>
        {t('transactions.refund.amountHint', { amount: fmt(payment.remaining) })}
      </Text>
      <Text style={styles.help}>
        {t('staffRefund.limitsLine', { each: formatCents(limits.capCents), left: formatCents(leftToday) })}
        {sls ? ` ${t('staffRefund.shillingsNote', { rate: limits.slsPerUsd.toLocaleString('en-US') })}` : ''}
      </Text>
      {warning || error ? <Text style={styles.formError}>{error || warning}</Text> : null}
      <Text style={styles.help}>{t('staffRefund.fromShop')}</Text>

      <View style={styles.buttons}>
        <PillButton label={t('common.continue')} disabled={!valid} onPress={() => setStep('pin')} />
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  pinInput: { marginTop: 32 },
  spinner: { marginTop: 32 },
  error: { fontSize: 14, color: colors.ui.error, marginTop: 16, textAlign: 'center' },
  block: { alignSelf: 'stretch', marginTop: 32 },
  card: { marginHorizontal: 20, marginBottom: 8, padding: 18 },
  hint: { fontSize: 13, color: colors.ui.textFaint },
  total: { fontSize: 28, fontWeight: '800', color: colors.ui.text, marginTop: 4 },
  meta: { fontSize: 13, color: colors.ui.textFaint, marginTop: 6 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ui.textFaint,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 10,
  },
  input: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.ui.divider,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: '700',
    color: colors.ui.text,
  },
  help: { fontSize: 13, color: colors.ui.textFaint, lineHeight: 18, marginHorizontal: 24, marginTop: 8 },
  formError: { fontSize: 14, color: colors.ui.error, marginHorizontal: 24, marginTop: 12, lineHeight: 20 },
  buttons: { marginHorizontal: 20, marginTop: 24 },
}));
