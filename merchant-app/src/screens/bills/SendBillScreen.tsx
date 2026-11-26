import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DarkScreen, GlassCard, PillButton, ScreenHeader } from '../../components';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { CurrencyToggle, type FloatCurrency } from '../../components/CurrencyToggle';
import { lookupCustomer, type CustomerLookupResult } from '../../services/topup.service';
import { addDays, BillRepeat, createBill, formatDueDate, hargeisaToday } from '../../services/bills.service';
import { formatAmount, sanitizeAmountFor, toAmount } from '../../utils/money';
import { newIdempotencyKey } from '../../utils/idempotency';
import { callableErrorKey } from '../../utils/errors';
import { makeStyles, useColors } from '../../theme';

type Step = 'customer' | 'details' | 'review' | 'sent';

/** Due in this many days; 0 is today. */
const DUE_CHOICES = [0, 3, 7, 14, 30];
const REPEATS: BillRepeat[] = ['none', 'weekly', 'monthly'];
const DESCRIPTION_MAX = 80;

/** The server's refusal as a translation key. */
function errorKey(e: any): string {
  const m: string = typeof e?.message === 'string' ? e.message : '';
  if (e?.details?.reason === 'no_account' || /no zapp pay account/i.test(m)) return 'bills.errors.noAccount';
  if (/too many unpaid/i.test(m)) return 'bills.errors.tooManyOpen';
  if (/lookups/i.test(m)) return 'bills.errors.tooManySent';
  if (/limit for a single transaction/i.test(m)) return 'bills.errors.overLimit';
  if (/bill yourself/i.test(m)) return 'bills.errors.yourself';
  return callableErrorKey(e);
}

/**
 * Send a customer a bill: find them by phone, say what it's for, how much and
 * when it's due, and whether it repeats. Moves no money, so no PIN. The
 * customer pays it in Zapp Pay, or auto-pays it on the due date.
 */
export default function SendBillScreen({ navigation }: { navigation: any }) {
  const colors = useColors();
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>('customer');

  const [localNumber, setLocalNumber] = useState('');
  const [customer, setCustomer] = useState<CustomerLookupResult | null>(null);
  const [currency, setCurrency] = useState<FloatCurrency>('USD');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [dueIn, setDueIn] = useState(7);
  const [repeat, setRepeat] = useState<BillRepeat>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One per bill, kept across retries: a lost reply can't send it twice.
  const [billKey, setBillKey] = useState(newIdempotencyKey);

  const digits = localNumber.replace(/\D/g, '').replace(/^0/, '');
  const phoneValid = /^\d{9}$/.test(digits);
  const phone = `+252${digits}`;
  const units = toAmount(amount, currency);
  const amountShown = formatAmount(units, currency);
  const dueDate = addDays(hargeisaToday(), dueIn);
  const dueText = formatDueDate(dueDate, i18n.language);
  const detailsValid = units > 0 && description.trim().length > 0;

  const find = async () => {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError('');
    try {
      setCustomer(await lookupCustomer(phone));
      setStep('details');
    } catch {
      setError(t('bills.errors.noAccount'));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await createBill({
        customerPhone: phone,
        amount: units,
        currency,
        description: description.trim(),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        dueDate,
        repeat,
        idempotencyKey: billKey,
      });
      setStep('sent');
    } catch (e: any) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setStep('customer');
    setLocalNumber('');
    setCustomer(null);
    setAmount('');
    setDescription('');
    setReference('');
    setDueIn(7);
    setRepeat('none');
    setError('');
    setBillKey(newIdempotencyKey());
  };

  if (step === 'sent') {
    return (
      <DarkScreen contentStyle={styles.centered}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.title}>{t('bills.sentTitle')}</Text>
        <Text style={styles.body}>
          {t('bills.sentBody', { customer: customer?.fullName ?? '', amount: amountShown, date: dueText })}
        </Text>
        {repeat !== 'none' ? <Text style={styles.body}>{t(`bills.sentRepeat.${repeat}`)}</Text> : null}
        <PillButton label={t('bills.sendAnother')} onPress={startOver} style={styles.fullWidth} />
        <PillButton label={t('common.done')} variant="glass" onPress={() => navigation.goBack()} style={styles.fullWidth} />
      </DarkScreen>
    );
  }

  if (step === 'review') {
    return (
      <DarkScreen scroll>
        <ScreenHeader title={t('bills.reviewTitle')} onBack={() => { setError(''); setStep('details'); }} />
        <View style={styles.pad}>
        <GlassCard style={styles.card}>
          <Line label={t('bills.to')} value={`${customer?.fullName ?? ''}\n${phone}`} />
          <Line label={t('bills.amount')} value={amountShown} strong />
          <Line label={t('bills.for')} value={description.trim()} />
          {reference.trim() ? <Line label={t('bills.reference')} value={reference.trim()} /> : null}
          <Line label={t('bills.dueLabel')} value={dueText} />
          <Line label={t('bills.repeatLabel')} value={t(`bills.repeat.${repeat}`)} />
        </GlassCard>
        <Text style={styles.hint}>{t('bills.reviewHint')}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.spacer} />
        <PillButton label={t('bills.sendBill')} onPress={send} loading={busy} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'details') {
    return (
      <DarkScreen scroll keyboard>
        <ScreenHeader
          title={t('bills.detailsTitle')}
          subtitle={customer ? `${customer.fullName} · ${phone}` : undefined}
          onBack={() => setStep('customer')}
        />

        <View style={styles.pad}>
        <Text style={styles.label}>{t('bills.amount')}</Text>
        <CurrencyToggle value={currency} onChange={(c) => { setCurrency(c); setAmount(''); }} style={styles.toggle} />
        <GlassCard style={styles.inputCard}>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={(text) => setAmount(sanitizeAmountFor(text, currency))}
            keyboardType={currency === 'SLS' ? 'number-pad' : 'decimal-pad'}
            placeholder={currency === 'SLS' ? '0' : '0.00'}
            placeholderTextColor={colors.ui.textFaint}
            accessibilityLabel={t('bills.amount')}
          />
        </GlassCard>

        <Text style={styles.label}>{t('bills.for')}</Text>
        <GlassCard style={styles.inputCard}>
          <TextInput
            style={styles.textInput}
            value={description}
            onChangeText={setDescription}
            placeholder={t('bills.forPlaceholder')}
            placeholderTextColor={colors.ui.textFaint}
            maxLength={DESCRIPTION_MAX}
          />
        </GlassCard>

        <Text style={styles.label}>{t('bills.referenceLabel')}</Text>
        <GlassCard style={styles.inputCard}>
          <TextInput
            style={styles.textInput}
            value={reference}
            onChangeText={setReference}
            placeholder={t('bills.referencePlaceholder')}
            placeholderTextColor={colors.ui.textFaint}
            maxLength={80}
            autoCapitalize="characters"
          />
        </GlassCard>

        <Text style={styles.label}>{t('bills.dueLabel')}</Text>
        <View style={styles.chips}>
          {DUE_CHOICES.map((d) => (
            <Chip key={d} on={dueIn === d} onPress={() => setDueIn(d)} label={d === 0 ? t('bills.dueToday') : t('bills.dueInDays', { days: d })} />
          ))}
        </View>
        <Text style={styles.hint}>{t('bills.dueOn', { date: dueText })}</Text>

        <Text style={styles.label}>{t('bills.repeatLabel')}</Text>
        <View style={styles.chips}>
          {REPEATS.map((r) => (
            <Chip key={r} on={repeat === r} onPress={() => setRepeat(r)} label={t(`bills.repeat.${r}`)} />
          ))}
        </View>
        {repeat !== 'none' ? <Text style={styles.hint}>{t(`bills.repeatHint.${repeat}`)}</Text> : null}

        <View style={styles.spacer} />
        <PillButton label={t('common.continue')} onPress={() => setStep('review')} disabled={!detailsValid} />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard>
      <ScreenHeader title={t('bills.sendTitle')} subtitle={t('bills.sendSubtitle')} onBack={() => navigation.goBack()} />
      <View style={styles.pad}>
      <Text style={styles.label}>{t('bills.customerPhone')}</Text>
      <GlassCard style={styles.phoneRow}>
        <Text style={styles.countryCode}>🇸🇴 +252</Text>
        <View style={styles.phoneDivider} />
        <TextInput
          style={styles.phoneInput}
          value={localNumber}
          onChangeText={(text) => { setLocalNumber(text.replace(/[^\d\s]/g, '')); setError(''); }}
          placeholder={t('common.phonePlaceholder.somalia')}
          placeholderTextColor={colors.ui.textFaint}
          keyboardType="phone-pad"
          maxLength={13}
          autoFocus
          textContentType="telephoneNumber"
          onSubmitEditing={find}
        />
      </GlassCard>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <PillButton label={t('bills.findCustomer')} onPress={find} loading={busy} disabled={!phoneValid} />
      </View>
    </DarkScreen>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineStrong]}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 12 },
  fullWidth: { alignSelf: 'stretch' },
  // DarkScreen leaves the sides to each screen; match the header's 24pt gutter.
  pad: { paddingHorizontal: 24, paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', color: colors.ui.text, marginTop: 8 },
  body: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '600', color: colors.ui.textDim, marginTop: 18, marginBottom: 8 },
  hint: { fontSize: 13, color: colors.ui.textFaint, marginTop: 8 },
  error: { fontSize: 14, color: colors.ui.error, marginTop: 12 },
  spacer: { height: 24 },
  toggle: { marginBottom: 10 },
  inputCard: { paddingHorizontal: 16, paddingVertical: 4 },
  amountInput: { fontSize: 28, fontWeight: '700', color: colors.ui.text, paddingVertical: 10 },
  textInput: { fontSize: 16, color: colors.ui.text, paddingVertical: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    backgroundColor: colors.ui.glass,
  },
  chipOn: { backgroundColor: colors.ui.accentSoft, borderColor: colors.ui.accentBorder },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.ui.textDim },
  chipTextOn: { color: colors.ui.accentText },
  phoneRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  countryCode: { fontSize: 16, fontWeight: '600', color: colors.ui.text },
  phoneDivider: { width: 1, height: 28, backgroundColor: colors.ui.divider, marginHorizontal: 12 },
  phoneInput: { flex: 1, fontSize: 18, color: colors.ui.text, paddingVertical: 14 },
  card: { paddingHorizontal: 16, paddingVertical: 8, marginTop: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, gap: 12 },
  lineLabel: { fontSize: 14, color: colors.ui.textFaint },
  lineValue: { fontSize: 15, fontWeight: '600', color: colors.ui.text, flexShrink: 1, textAlign: 'right' },
  lineStrong: { fontSize: 18, fontWeight: '700' },
}));
