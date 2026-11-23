import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
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
import { CurrencySegment } from '../../components/CurrencySegment';
import { triggerHaptic } from '../../services/haptics.service';
import { useBiometricApproval } from '../../hooks/useBiometricApproval';
import {
  addDays,
  formatDueDate,
  hargeisaToday,
  lookupShop,
  requestDirectPayment,
} from '../../services/bills.service';
import { typography, spacing, borderRadius, makeStyles, useColors } from '../../theme';
import { Currency, amountInputLabel, amountInputUnits, formatMoney } from '../../utils/money';
import { newIdempotencyKey } from '../../utils/idempotency';
import { cooldownMessage } from '../../utils/cooldownMessage';

/**
 * Set up a direct payment: the customer asks a shop (gym, school, water
 * company) to bill them every week or month, and may have each bill paid
 * automatically. The shop approves it in its app; nothing is paid before.
 * Auto-pay is consent to future payments, so it takes Face ID or the PIN.
 */
type Shop = { merchantId?: string; phone?: string; name: string };
type Params = { RequestDirectPayment: { shops?: { merchantId: string; name: string }[] } | undefined };
type Step = 'shop' | 'details' | 'review' | 'pin' | 'sent';

const FIRST_IN = [0, 3, 7, 14, 30];
const PHONE_PREFIX = '+252';

export default function RequestDirectPaymentScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const recent = useRoute<RouteProp<Params, 'RequestDirectPayment'>>().params?.shops ?? [];
  const biometric = useBiometricApproval();
  const { prepare: prepareBiometric } = biometric;

  const [step, setStep] = useState<Step>('shop');
  const [phone, setPhone] = useState('');
  const [shop, setShop] = useState<Shop | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amountText, setAmountText] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [interval, setPayInterval] = useState<'weekly' | 'monthly'>('monthly');
  const [firstIn, setFirstIn] = useState(7);
  const [autopay, setAutopay] = useState(true);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One per request, kept across retries: a lost reply can't send it twice.
  const [key] = useState(newIdempotencyKey);

  useEffect(() => {
    prepareBiometric();
  }, [prepareBiometric]);

  const digits = phone.replace(/\D/g, '').replace(/^0/, '');
  const phoneValid = /^\d{9}$/.test(digits);
  const amount = amountInputUnits(amountText, currency);
  const amountShown = formatMoney(amount, currency);
  const firstDate = addDays(hargeisaToday(), firstIn);
  const firstText = formatDueDate(firstDate, i18n.language);
  const detailsValid = amount > 0 && description.trim().length > 0;
  const every = t(`bills.every.${interval}`, { amount: amountShown });

  const find = async () => {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError('');
    try {
      const found = await lookupShop(`${PHONE_PREFIX}${digits}`);
      if (!found.found) {
        setError(t(found.reason === 'not_shop' ? 'bills.request.notShop' : 'bills.request.noShop'));
        return;
      }
      setShop({ phone: `${PHONE_PREFIX}${digits}`, name: found.name });
      setStep('details');
    } catch (e: any) {
      setError(e?.details?.reason === 'lookup_limit' ? t('payments.lookupLimit') : t('bills.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (credential?: string) => {
    if (!shop || busy) return;
    setBusy(true);
    setError('');
    try {
      await requestDirectPayment({
        ...(shop.merchantId ? { merchantId: shop.merchantId } : { merchantPhone: shop.phone }),
        amount,
        currency,
        description: description.trim(),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        interval,
        firstDueDate: firstDate,
        autopay,
        ...(credential ? { pin: credential } : {}),
        idempotencyKey: key,
      });
      triggerHaptic('success');
      setStep('sent');
    } catch (e: any) {
      triggerHaptic('medium');
      setPin('');
      const m: string = typeof e?.message === 'string' ? e.message : '';
      if (e?.code === 'functions/permission-denied' && /invalid pin/i.test(m)) setError(t('auth.pinLogin.invalidPin'));
      else if (cooldownMessage(e, t)) setError(cooldownMessage(e, t)!);
      else if (e?.code === 'functions/resource-exhausted' && e?.details?.hardLocked) setError(t('pin.hardLocked'));
      else if (e?.code === 'functions/resource-exhausted' && e?.details?.secondsLeft) {
        setError(t('pin.lockedOut', { seconds: e.details.secondsLeft }));
      } else if (/too many requests/i.test(m)) setError(t('bills.request.tooMany'));
      else if (/limit/i.test(m)) setError(t('bills.errors.limit'));
      else if (/isn't a shop|not found/i.test(m)) setError(t('bills.request.noShop'));
      else setError(t('bills.request.failed'));
    } finally {
      setBusy(false);
    }
  };

  /** Without auto-pay nothing is consented to yet: no PIN. With it, Face ID in one tap, else the PIN. */
  const confirm = async () => {
    if (busy) return;
    triggerHaptic('medium');
    if (!autopay) {
      await submit();
      return;
    }
    if (!biometric.available) {
      setStep('pin');
      return;
    }
    const token = await biometric.approve(t('bills.request.biometricPrompt', { merchant: shop?.name ?? '' }));
    if (token) await submit(token);
    else setStep('pin');
  };

  const header = (back: () => void) => <Header title={t('bills.request.title')} onBack={back} />;

  if (step === 'sent') {
    return (
      <View style={[styles.container, styles.centered]}>
        <View style={styles.sentIcon}><SuccessCheckIcon size={64} /></View>
        <Text style={styles.title}>{t('bills.request.sentTitle')}</Text>
        <Text style={styles.bodyCenter}>{t('bills.request.sentBody', { merchant: shop?.name ?? '' })}</Text>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('common.done')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'pin') {
    return (
      <View style={[styles.container, styles.padded]}>
        <Text style={[styles.title, styles.center]}>{t('bills.autopayPinTitle')}</Text>
        <Text style={styles.bodyCenter}>
          {t('bills.request.pinBody', { merchant: shop?.name ?? '', amount: amountShown })}
        </Text>
        <PinInput value={pin} onChange={setPin} onComplete={submit} secure style={styles.pin} />
        {busy ? <ActivityIndicator color={colors.ui.accent} style={styles.spinner} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.back} onPress={() => { setPin(''); setError(''); setStep('review'); }} disabled={busy}>
          <Text style={styles.backText}>{t('payments.approve.backToReview')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'review' && shop) {
    return (
      <View style={styles.container}>
        {header(() => { setError(''); setStep('details'); })}
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('bills.request.reviewTitle')}</Text>
          <View style={styles.card}>
            <Line label={t('bills.request.shop')} value={shop.name} />
            <Line label={t('bills.request.amount')} value={every} />
            <Line label={t('bills.for')} value={description.trim()} />
            {reference.trim() ? <Line label={t('bills.reference')} value={reference.trim()} /> : null}
            <Line label={t('bills.request.firstPayment')} value={firstText} />
            <Line label={t('bills.autopay')} value={autopay ? t('bills.request.autopayOn') : t('bills.request.autopayOff')} />
          </View>
          <Text style={styles.body}>
            {autopay
              ? t('bills.request.howAutopay', { merchant: shop.name, amount: amountShown })
              : t('bills.request.howManual', { merchant: shop.name })}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={styles.primary} onPress={confirm} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{t('bills.request.send')}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (step === 'details' && shop) {
    return (
      <View style={styles.container}>
        {header(() => setStep('shop'))}
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.shopName}>{shop.name}</Text>

          <Text style={styles.label}>{t('bills.request.amountEach')}</Text>
          <CurrencySegment value={currency} onChange={(c) => { setCurrency(c); setAmountText(''); }} />
          <TextInput
            style={[styles.input, styles.amountInput]}
            value={amountText}
            onChangeText={(text) => setAmountText(text.replace(currency === 'SLS' ? /[^0-9]/g : /[^0-9.]/g, ''))}
            keyboardType={currency === 'SLS' ? 'number-pad' : 'decimal-pad'}
            placeholder={currency === 'SLS' ? '0' : '0.00'}
            placeholderTextColor={colors.ui.textFaint}
            accessibilityLabel={t('bills.request.amountEach')}
          />
          {amount > 0 ? <Text style={styles.hint}>{amountInputLabel(amountText, currency)}</Text> : null}

          <Text style={styles.label}>{t('bills.for')}</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder={t('bills.request.forPlaceholder')}
            placeholderTextColor={colors.ui.textFaint}
            maxLength={80}
          />

          <Text style={styles.label}>{t('bills.request.referenceLabel')}</Text>
          <TextInput
            style={styles.input}
            value={reference}
            onChangeText={setReference}
            placeholder={t('bills.request.referencePlaceholder')}
            placeholderTextColor={colors.ui.textFaint}
            maxLength={80}
            autoCapitalize="characters"
          />

          <Text style={styles.label}>{t('bills.request.howOften')}</Text>
          <View style={styles.chips}>
            {(['weekly', 'monthly'] as const).map((i) => (
              <Chip key={i} on={interval === i} label={t(`bills.request.interval.${i}`)} onPress={() => setPayInterval(i)} />
            ))}
          </View>

          <Text style={styles.label}>{t('bills.request.firstPayment')}</Text>
          <View style={styles.chips}>
            {FIRST_IN.map((d) => (
              <Chip
                key={d}
                on={firstIn === d}
                label={d === 0 ? t('bills.request.today') : t('bills.request.inDays', { days: d })}
                onPress={() => setFirstIn(d)}
              />
            ))}
          </View>
          <Text style={styles.hint}>{firstText}</Text>

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>{t('bills.request.payAutomatically')}</Text>
              <Text style={styles.hintTight}>{t('bills.request.payAutomaticallyHint')}</Text>
            </View>
            <Switch value={autopay} onValueChange={setAutopay} />
          </View>

          <TouchableOpacity
            style={[styles.primary, !detailsValid && styles.disabled]}
            onPress={() => setStep('review')}
            disabled={!detailsValid}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{t('common.continue')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header(() => navigation.goBack())}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.body}>{t('bills.request.intro')}</Text>

        {recent.length > 0 ? (
          <>
            <Text style={styles.label}>{t('bills.request.recentShops')}</Text>
            <View style={styles.card}>
              {recent.map((s) => (
                <TouchableOpacity
                  key={s.merchantId}
                  style={styles.shopRow}
                  onPress={() => { setShop({ merchantId: s.merchantId, name: s.name }); setStep('details'); }}
                  accessibilityRole="button"
                >
                  <Text style={styles.shopRowText}>{s.name}</Text>
                  <Text style={styles.chev}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>{t('bills.request.shopPhone')}</Text>
        <View style={styles.phoneRow}>
          <Text style={styles.prefix}>{PHONE_PREFIX}</Text>
          <TextInput
            style={styles.phoneInput}
            value={phone}
            onChangeText={(text) => { setPhone(text.replace(/[^\d\s]/g, '')); setError(''); }}
            keyboardType="phone-pad"
            placeholder="63 1234567"
            placeholderTextColor={colors.ui.textFaint}
            maxLength={13}
            onSubmitEditing={find}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.primary, !phoneValid && styles.disabled]}
          onPress={find}
          disabled={!phoneValid || busy}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{t('bills.request.findShop')}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
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

function Line({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas },
  centered: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg },
  sentIcon: { marginBottom: spacing.lg },
  padded: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { textAlign: 'center' },
  title: { ...typography.h2, color: colors.ui.text, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.ui.textDim, marginBottom: spacing.md },
  bodyCenter: { ...typography.body, color: colors.ui.textDim, textAlign: 'center', marginBottom: spacing.lg },
  shopName: { ...typography.h2, color: colors.ui.text },
  label: { ...typography.caption, color: colors.ui.textDim, marginTop: spacing.lg, marginBottom: spacing.sm },
  hint: { ...typography.caption, color: colors.ui.textFaint, marginTop: spacing.xs },
  hintTight: { ...typography.caption, color: colors.ui.textFaint, marginTop: 2 },
  input: {
    ...typography.body,
    color: colors.ui.text,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  amountInput: { ...typography.h2, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    backgroundColor: colors.ui.glass,
  },
  chipOn: { backgroundColor: colors.ui.accentSoft, borderColor: colors.ui.accentBorder },
  chipText: { ...typography.bodySemibold, color: colors.ui.textDim },
  chipTextOn: { color: colors.ui.accentText },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  switchText: { flex: 1 },
  switchTitle: { ...typography.bodySemibold, color: colors.ui.text },
  card: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm },
  lineLabel: { ...typography.body, color: colors.ui.textFaint },
  lineValue: { ...typography.bodySemibold, color: colors.ui.text, flexShrink: 1, textAlign: 'right' },
  shopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  shopRowText: { ...typography.bodySemibold, color: colors.ui.text, flex: 1 },
  chev: { ...typography.h3, color: colors.ui.textFaint },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  prefix: { ...typography.bodySemibold, color: colors.ui.text, marginRight: spacing.sm },
  phoneInput: { ...typography.body, color: colors.ui.text, flex: 1, paddingVertical: spacing.md },
  error: { ...typography.body, color: colors.ui.error, marginBottom: spacing.md },
  primary: {
    backgroundColor: colors.ui.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: spacing.md,
  },
  disabled: { opacity: 0.5 },
  primaryText: { ...typography.h3, color: '#FFFFFF' },
  pin: { marginHorizontal: spacing.md, marginVertical: spacing.lg },
  spinner: { marginBottom: spacing.md },
  back: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  backText: { ...typography.bodySemibold, color: colors.ui.accentText },
}));
