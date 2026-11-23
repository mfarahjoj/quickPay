import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { Header } from '../../components/Header';
import { PinInput } from '../../components/PinInput';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { triggerHaptic } from '../../services/haptics.service';
import { useBiometricApproval } from '../../hooks/useBiometricApproval';
import {
  Bill,
  BillAutopay,
  BillSeries,
  autopayCovers,
  declineBill,
  disableBillAutopay,
  formatDueDate,
  hargeisaToday,
  listMyBills,
  payBill,
  setBillAutopay,
  stopBillSeries,
} from '../../services/bills.service';
import { typography, spacing, borderRadius, makeStyles, useColors } from '../../theme';
import { amountInputLabel, amountInputUnits, formatMoney } from '../../utils/money';
import { cooldownMessage } from '../../utils/cooldownMessage';
import { logger } from '../../utils/logger';

/**
 * One bill: pay it (Face ID in one tap, else the PIN), decline it, or have
 * this shop's bills paid automatically up to a limit. Reached from Bills and
 * from the push a shop's bill sends.
 */
type Params = { BillDetail: { billId: string } };
type Step = 'view' | 'pay' | 'autopayLimit' | 'autopayPin' | 'paid';

export default function BillDetailScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const { billId } = useRoute<RouteProp<Params, 'BillDetail'>>().params;
  const biometric = useBiometricApproval();
  const { prepare: prepareBiometric } = biometric;

  const [bill, setBill] = useState<Bill | null>(null);
  const [autopay, setAutopay] = useState<BillAutopay[]>([]);
  const [series, setSeries] = useState<BillSeries | null>(null);
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState<Step>('view');
  const [pin, setPin] = useState('');
  const [limitText, setLimitText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const mine = await listMyBills();
      const found = mine.bills.find((b) => b.id === billId) ?? null;
      setBill(found);
      setMissing(!found);
      setAutopay(mine.autopay);
      setSeries(found?.seriesId ? mine.series.find((s) => s.id === found.seriesId) ?? null : null);
    } catch (err) {
      logger.error('Load bill failed:', err);
      setMissing(true);
    }
  }, [billId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    prepareBiometric();
  }, [prepareBiometric]);

  /** The server's refusal in the customer's words. */
  const explain = (e: any, fallback: string): string => {
    const m: string = typeof e?.message === 'string' ? e.message : '';
    if (e?.code === 'functions/permission-denied' && /invalid pin/i.test(m)) return t('auth.pinLogin.invalidPin');
    if (/insufficient balance/i.test(m)) return t('bills.errors.balance');
    const cooldown = cooldownMessage(e, t);
    if (cooldown) return cooldown;
    if (e?.code === 'functions/resource-exhausted' && e?.details?.hardLocked) return t('pin.hardLocked');
    if (e?.code === 'functions/resource-exhausted' && e?.details?.secondsLeft) {
      return t('pin.lockedOut', { seconds: e.details.secondsLeft });
    }
    if (/limit/i.test(m)) return t('bills.errors.limit');
    if (/does not match|is (paid|declined|cancelled)/i.test(m)) return t('bills.errors.changed');
    if (/frozen|unavailable|closed/i.test(m)) return t('bills.errors.unavailable');
    return fallback;
  };

  const pay = async (credential: string) => {
    if (!bill || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await payBill(bill, credential);
      triggerHaptic('success');
      setReceipt(res.receiptNumber ?? null);
      setStep('paid');
    } catch (e: any) {
      triggerHaptic('medium');
      setPin('');
      // Shown where the customer is: under the Pay button after Face ID, or
      // under the PIN pad.
      setError(explain(e, t('bills.errors.payFailed')));
      if (/does not match|is (paid|declined|cancelled)/i.test(e?.message ?? '')) load();
    } finally {
      setBusy(false);
    }
  };

  /** Face ID in one deliberate tap when it is set up; the PIN otherwise or if cancelled. */
  const startPay = async () => {
    if (!bill || busy) return;
    triggerHaptic('medium');
    setError('');
    if (!biometric.available) {
      setStep('pay');
      return;
    }
    const token = await biometric.approve(
      t('common.confirmPaymentAmount', { amount: formatMoney(bill.amount, bill.currency) }),
    );
    if (token) await pay(token);
    else setStep('pay');
  };

  const limitUnits = bill ? amountInputUnits(limitText, bill.currency) : 0;

  const turnOnAutopay = async (credential: string) => {
    if (!bill || busy) return;
    setBusy(true);
    setError('');
    try {
      await setBillAutopay(bill.merchantId, limitUnits, bill.currency, credential);
      triggerHaptic('success');
      setPin('');
      setStep('view');
      await load();
    } catch (e: any) {
      triggerHaptic('medium');
      setPin('');
      setStep('autopayPin');
      setError(explain(e, t('bills.errors.autopayFailed')));
    } finally {
      setBusy(false);
    }
  };

  const confirmAutopay = async () => {
    if (!bill || limitUnits <= 0) return;
    triggerHaptic('medium');
    setError('');
    if (!biometric.available) {
      setStep('autopayPin');
      return;
    }
    const token = await biometric.approve(
      t('bills.autopayPrompt', { merchant: bill.merchantName }),
    );
    if (token) await turnOnAutopay(token);
    else setStep('autopayPin');
  };

  const decline = () => {
    if (!bill) return;
    Alert.alert(
      t('bills.declineTitle'),
      t('bills.declineMessage', { merchant: bill.merchantName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('bills.decline'),
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await declineBill(bill.id);
              await load();
            } catch (e) {
              Alert.alert(t('common.error'), explain(e, t('bills.actionFailed')));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const removeAutopay = () => {
    if (!bill) return;
    Alert.alert(
      t('bills.autopayOffTitle', { merchant: bill.merchantName }),
      t('bills.autopayOffMessage', { merchant: bill.merchantName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('bills.turnOff'),
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await disableBillAutopay(bill.merchantId);
              await load();
            } catch {
              Alert.alert(t('common.error'), t('bills.actionFailed'));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const stopRepeating = () => {
    if (!series) return;
    Alert.alert(
      t('bills.stopTitle', { merchant: series.merchantName }),
      t('bills.stopMessage', { merchant: series.merchantName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('bills.stop'),
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await stopBillSeries(series.id);
              await load();
            } catch {
              Alert.alert(t('common.error'), t('bills.actionFailed'));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const header = <Header title={t('bills.billTitle')} onBack={() => navigation.goBack()} />;

  if (missing) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centered}>
          <Text style={styles.body}>{t('bills.notFound')}</Text>
        </View>
      </View>
    );
  }

  if (!bill) {
    return (
      <View style={styles.container}>
        {header}
        <ActivityIndicator size="large" color={colors.ui.accent} style={styles.spinner} />
      </View>
    );
  }

  const amount = formatMoney(bill.amount, bill.currency);
  const setting = autopay.find((a) => a.merchantId === bill.merchantId);
  const covered = autopayCovers(bill, autopay);
  const dueText = formatDueDate(bill.dueDate, i18n.language);
  const overdue = bill.status === 'open' && bill.dueDate < hargeisaToday();

  if (step === 'paid') {
    return (
      <View style={[styles.container, styles.centered, styles.padded]}>
        <View style={styles.paidIcon}><SuccessCheckIcon size={64} /></View>
        <Text style={styles.title}>{t('bills.paidTitle')}</Text>
        <Text style={styles.body}>{t('bills.paidBody', { amount, merchant: bill.merchantName })}</Text>
        {receipt ? <Text style={styles.receipt}>{t('bills.receipt', { number: receipt })}</Text> : null}
        <TouchableOpacity style={styles.primary} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('common.done')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'pay' || step === 'autopayPin') {
    const forAutopay = step === 'autopayPin';
    return (
      <View style={[styles.container, styles.padded]}>
        <Text style={[styles.title, styles.center]}>
          {forAutopay ? t('bills.autopayPinTitle') : t('bills.payPinTitle', { amount })}
        </Text>
        <Text style={[styles.body, styles.center]}>
          {forAutopay
            ? t('bills.autopayPinBody', {
                merchant: bill.merchantName,
                amount: formatMoney(limitUnits, bill.currency),
              })
            : t('bills.payPinBody', { merchant: bill.merchantName })}
        </Text>
        <PinInput
          value={pin}
          onChange={setPin}
          onComplete={forAutopay ? turnOnAutopay : pay}
          secure
          style={styles.pin}
        />
        {busy ? <ActivityIndicator color={colors.ui.accent} style={styles.spinnerSmall} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity
          style={styles.back}
          onPress={() => { setPin(''); setError(''); setStep('view'); }}
          disabled={busy}
        >
          <Text style={styles.backText}>{t('bills.backToBill')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'autopayLimit') {
    return (
      <View style={styles.container}>
        {header}
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('bills.autopayTitle', { merchant: bill.merchantName })}</Text>
          <Text style={styles.bodyLeft}>{t('bills.autopayExplain', { merchant: bill.merchantName })}</Text>
          <Text style={styles.label}>{t('bills.autopayLimitLabel')}</Text>
          <TextInput
            style={styles.input}
            value={limitText}
            onChangeText={(text) => setLimitText(text.replace(bill.currency === 'SLS' ? /[^0-9]/g : /[^0-9.]/g, ''))}
            keyboardType={bill.currency === 'SLS' ? 'number-pad' : 'decimal-pad'}
            placeholder={bill.currency === 'SLS' ? '0' : '0.00'}
            placeholderTextColor={colors.ui.textFaint}
            autoFocus
            accessibilityLabel={t('bills.autopayLimitLabel')}
          />
          <Text style={styles.hint}>
            {limitUnits > 0
              ? t('bills.autopayLimitHint', { amount: amountInputLabel(limitText, bill.currency) })
              : t('bills.autopayLimitEmpty')}
          </Text>
          {limitUnits > 0 && limitUnits < bill.amount ? (
            <Text style={styles.warning}>{t('bills.autopayBelowThis', { amount })}</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.primary, limitUnits <= 0 && styles.disabled]}
            onPress={confirmAutopay}
            disabled={limitUnits <= 0 || busy}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{t('bills.autopayTurnOn')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => { setError(''); setStep('view'); }}>
            <Text style={styles.secondaryText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{bill.merchantName.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={[styles.merchant, styles.center]}>{bill.merchantName}</Text>
        <Text style={[styles.bigAmount, styles.center]}>{amount}</Text>
        <Text style={[styles.statusLine, styles.center, overdue && styles.overdue]}>
          {bill.status === 'open'
            ? t(overdue ? 'bills.overdueSince' : 'bills.dueOn', { date: dueText })
            : t(`bills.status.${bill.status}`)}
        </Text>

        <View style={styles.card}>
          <Detail label={t('bills.for')} value={bill.description} />
          {bill.reference ? <Detail label={t('bills.reference')} value={bill.reference} /> : null}
          <Detail label={t('bills.dueLabel')} value={dueText} />
          {bill.status === 'paid' ? (
            <Detail
              label={t('bills.paidLabel')}
              value={bill.paidBy === 'autopay' ? t('bills.paidByAutopay') : t('bills.paidByYou')}
            />
          ) : null}
          {bill.receiptNumber ? <Detail label={t('bills.receiptLabel')} value={bill.receiptNumber} /> : null}
          {series?.active ? (
            <Detail
              label={t('bills.repeats')}
              value={`${t(`bills.every.${series.interval}`, { amount: formatMoney(series.amount, series.currency) })} · ${t('bills.nextBill', { date: formatDueDate(series.nextDueDate, i18n.language) })}`}
            />
          ) : null}
        </View>

        {bill.status === 'open' && (bill.autopayTries ?? 0) > 0 ? (
          <Text style={styles.warning}>{t('bills.autopayFailedNote')}</Text>
        ) : null}

        {bill.status === 'open' ? (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity style={styles.primary} onPress={startPay} disabled={busy} accessibilityRole="button">
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {biometric.available
                    ? t('bills.payWith', { amount, method: biometric.label })
                    : t('bills.pay', { amount })}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={decline} disabled={busy} accessibilityRole="button">
              <Text style={styles.secondaryText}>{t('bills.decline')}</Text>
            </TouchableOpacity>
          </>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('bills.autopay')}</Text>
          {setting ? (
            <>
              <Text style={styles.cardBody}>
                {t('bills.autopayOnFor', {
                  merchant: bill.merchantName,
                  amount: formatMoney(setting.maxAmount, setting.currency),
                })}
              </Text>
              {bill.status === 'open' ? (
                <Text style={styles.cardBody}>
                  {covered ? t('bills.autopayWillPay', { date: dueText }) : t('bills.autopayNotThis')}
                </Text>
              ) : null}
              <View style={styles.linkRow}>
                <TouchableOpacity
                  onPress={() => {
                    setLimitText(String(bill.currency === 'SLS' ? setting.maxAmount : setting.maxAmount / 100));
                    setStep('autopayLimit');
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.link}>{t('bills.autopayChange')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={removeAutopay} accessibilityRole="button">
                  <Text style={styles.danger}>{t('bills.turnOff')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.cardBody}>{t('bills.autopayPitch', { merchant: bill.merchantName })}</Text>
              <TouchableOpacity
                onPress={() => {
                  setLimitText(String(bill.currency === 'SLS' ? bill.amount : bill.amount / 100));
                  setStep('autopayLimit');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.link}>{t('bills.autopaySetUp')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {series?.active ? (
          <TouchableOpacity style={styles.secondary} onPress={stopRepeating} accessibilityRole="button">
            <Text style={styles.danger}>{t('bills.stopRepeating')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas },
  padded: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  paidIcon: { marginBottom: spacing.lg },
  center: { textAlign: 'center' },
  spinner: { marginTop: spacing.xxl },
  spinnerSmall: { marginBottom: spacing.md },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.ui.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { ...typography.h1, color: colors.ui.accentText },
  merchant: { ...typography.bodySemibold, color: colors.ui.textDim },
  bigAmount: { ...typography.h1, color: colors.ui.text, marginTop: spacing.xs },
  statusLine: { ...typography.body, color: colors.ui.textDim, marginTop: spacing.xs, marginBottom: spacing.lg },
  overdue: { color: colors.ui.error },
  title: { ...typography.h2, color: colors.ui.text, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.ui.textDim, textAlign: 'center', marginBottom: spacing.lg },
  bodyLeft: { ...typography.body, color: colors.ui.textDim, marginBottom: spacing.lg },
  receipt: { ...typography.bodySemibold, color: colors.ui.text, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.bodySemibold, color: colors.ui.text },
  cardBody: { ...typography.body, color: colors.ui.textDim },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  detailLabel: { ...typography.body, color: colors.ui.textFaint },
  detailValue: { ...typography.bodySemibold, color: colors.ui.text, flexShrink: 1, textAlign: 'right' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  link: { ...typography.bodySemibold, color: colors.ui.accentText },
  danger: { ...typography.bodySemibold, color: colors.ui.error },
  warning: { ...typography.caption, color: colors.ui.warning, marginBottom: spacing.md },
  error: { ...typography.body, color: colors.ui.error, textAlign: 'center', marginBottom: spacing.md },
  label: { ...typography.caption, color: colors.ui.textDim, marginBottom: spacing.xs },
  input: {
    ...typography.h2,
    color: colors.ui.text,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  hint: { ...typography.caption, color: colors.ui.textFaint, marginTop: spacing.sm, marginBottom: spacing.md },
  primary: {
    backgroundColor: colors.ui.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: spacing.sm,
  },
  disabled: { opacity: 0.5 },
  primaryText: { ...typography.h3, color: '#FFFFFF' },
  secondary: { paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  secondaryText: { ...typography.bodySemibold, color: colors.ui.textDim },
  pin: { marginHorizontal: spacing.md, marginVertical: spacing.lg },
  back: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  backText: { ...typography.bodySemibold, color: colors.ui.accentText },
}));
