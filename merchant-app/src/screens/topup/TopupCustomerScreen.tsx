import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useExitGuard } from '../../hooks/useExitGuard';
import { PinInput, DarkScreen, GlassCard, PillButton, ACCENT, TEXT_DIM, TEXT_FAINT } from '../../components';
import { SuccessCheckIcon, CloseIcon, TopUpIcon } from '../../components/icons/AuthIcons';
import { lookupCustomer, topupCustomer } from '../../services/topup.service';
import type { CustomerLookupResult, TopupResult } from '../../services/topup.service';
import { CURRENCY_SYMBOL, MAX_TOPUP_AMOUNT } from '../../config/constants';

type Step = 'lookup' | 'amount' | 'pin' | 'result';
type PaymentMethod = 'cash' | 'zaad' | 'edahab';

interface Country {
  code: string;
  flag: string;
  nameKey: string;
  placeholderKey: string;
  localLength: number;
  maxInput: number;
}

const COUNTRIES: Country[] = [
  { code: '+252', flag: '\u{1F1F8}\u{1F1F4}', nameKey: 'common.country.somalia', placeholderKey: 'common.phonePlaceholder.somalia', localLength: 9, maxInput: 14 },
  { code: '+44', flag: '\u{1F1EC}\u{1F1E7}', nameKey: 'common.country.unitedKingdom', placeholderKey: 'common.phonePlaceholder.unitedKingdom', localLength: 10, maxInput: 15 },
];

const PAYMENT_METHODS: { key: PaymentMethod; labelKey: string; icon: string }[] = [
  { key: 'cash', labelKey: 'topup.methods.cash', icon: '\u{1F4B5}' },
  { key: 'zaad', labelKey: 'topup.methods.zaad', icon: '\u{1F4F1}' },
  { key: 'edahab', labelKey: 'topup.methods.edahab', icon: '\u{1F4F2}' },
];

const PLACEHOLDER = 'rgba(255,255,255,0.3)';

export default function TopupCustomerScreen({ navigation }: { navigation: any }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('lookup');

  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [localNumber, setLocalNumber] = useState('');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [customer, setCustomer] = useState<CustomerLookupResult | null>(null);
  const inputRef = useRef<TextInput>(null);

  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');

  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [topupResult, setTopupResult] = useState<TopupResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  const cleanNumber = localNumber.replace(/[\s\-\(\)]/g, '');

  const isPhoneValid = (() => {
    if (selectedCountry.code === '+252') return /^\d{9}$/.test(cleanNumber);
    if (selectedCountry.code === '+44') return /^\d{10,11}$/.test(cleanNumber);
    return false;
  })();

  const methodLabel = (method: PaymentMethod) => t(`topup.methods.${method}`);

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setLocalNumber('');
    setShowCountryPicker(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleLookup = async () => {
    if (!isPhoneValid) {
      Alert.alert(
        t('topup.alerts.invalidNumberTitle'),
        t('topup.alerts.invalidNumberMessage', { country: t(selectedCountry.nameKey) }),
      );
      return;
    }
    let normalizedNumber = cleanNumber;
    if (selectedCountry.code === '+44' && normalizedNumber.startsWith('0')) {
      normalizedNumber = normalizedNumber.substring(1);
    }
    const fullNumber = `${selectedCountry.code}${normalizedNumber}`;
    try {
      setLookupLoading(true);
      const result = await lookupCustomer(fullNumber);
      setCustomer(result);
      setStep('amount');
    } catch (e: any) {
      Alert.alert(t('common.notFound'), e.message || t('common.customerNotFound'));
    } finally {
      setLookupLoading(false);
    }
  };

  const handleAmountNext = () => {
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      Alert.alert(t('common.invalidAmount'), t('common.invalidAmountMessage'));
      return;
    }
    if (amountNum > MAX_TOPUP_AMOUNT) {
      Alert.alert(
        t('topup.alerts.limitExceededTitle'),
        t('topup.alerts.limitExceededMessage', { amount: `${CURRENCY_SYMBOL}${MAX_TOPUP_AMOUNT}` }),
      );
      return;
    }
    setStep('pin');
  };

  const handlePinComplete = async (enteredPin: string) => {
    if (!customer) return;
    try {
      setSubmitting(true);
      const result = await topupCustomer({
        userId: customer.userId,
        amount: parseFloat(amount),
        agentPin: enteredPin,
        paymentMethod,
        reference: reference || undefined,
      });
      setTopupResult(result);
      setResultError(null);
      setStep('result');
    } catch (e: any) {
      setResultError(e.message || t('topup.alerts.topupFailedMessage'));
      setStep('result');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => navigation.goBack();

  // Back goes one step back, the same way the in-page "← Back" does, instead
  // of dropping the whole top-up; and nothing leaves while the agent's float
  // is being spent, so the result is always seen.
  useExitGuard(navigation, {
    blocked: submitting,
    onExit:
      step === 'pin'
        ? () => {
            setPin('');
            setStep('amount');
          }
        : step === 'amount'
          ? () => {
              setCustomer(null);
              setStep('lookup');
            }
          : undefined,
  });

  const handleRetry = () => {
    setPin('');
    setResultError(null);
    setTopupResult(null);
    setStep('pin');
  };

  const handleStartOver = () => {
    setStep('lookup');
    setCustomer(null);
    setLocalNumber('');
    setAmount('');
    setPaymentMethod('cash');
    setReference('');
    setPin('');
    setResultError(null);
    setTopupResult(null);
  };

  // ── RESULT ──
  if (step === 'result') {
    if (topupResult) {
      return (
        <DarkScreen edges={[]} scroll contentStyle={styles.resultWrap}>
          <SuccessCheckIcon size={72} />
          <Text style={styles.resultTitle}>{t('topup.result.successTitle')}</Text>
          <Text style={styles.resultAmount}>{CURRENCY_SYMBOL}{parseFloat(amount).toFixed(2)}</Text>
          <Text style={styles.resultSubtitle}>{t('topup.result.creditedTo', { name: customer?.fullName })}</Text>

          <GlassCard style={styles.receiptCard}>
            <Receipt label={t('topup.result.transactionId')} value={topupResult.transactionId} />
            <Receipt label={t('topup.result.method')} value={methodLabel(paymentMethod)} />
            {reference ? <Receipt label={t('topup.result.reference')} value={reference} /> : null}
          </GlassCard>

          <View style={styles.resultActions}>
            <PillButton label={t('topup.result.topUpAnother')} onPress={handleStartOver} />
            <TouchableOpacity style={styles.ghostLink} onPress={handleDone}>
              <Text style={styles.ghostLinkText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </View>
        </DarkScreen>
      );
    }
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <View style={styles.failIcon}>
          <CloseIcon size={32} color="#FF6961" />
        </View>
        <Text style={styles.resultTitle}>{t('topup.result.failedTitle')}</Text>
        <Text style={styles.resultSubtitle}>{resultError || t('topup.result.somethingWrong')}</Text>
        <View style={styles.resultActions}>
          <PillButton label={t('common.tryAgain')} onPress={handleRetry} />
          <TouchableOpacity style={styles.ghostLink} onPress={handleDone}>
            <Text style={styles.ghostLinkText}>{t('topup.result.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </DarkScreen>
    );
  }

  // ── PIN ──
  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} keyboard contentStyle={styles.pinWrap}>
        <Text style={styles.stepTitle}>{t('topup.pin.title')}</Text>
        <Text style={styles.stepSubtitle}>
          {t('topup.pin.subtitle', {
            amount: `${CURRENCY_SYMBOL}${parseFloat(amount).toFixed(2)}`,
            name: customer?.fullName,
          })}
        </Text>

        <GlassCard style={styles.summaryCard}>
          <Receipt label={t('topup.pin.customer')} value={customer?.fullName ?? ''} />
          <Receipt label={t('topup.pin.amount')} value={`${CURRENCY_SYMBOL}${parseFloat(amount).toFixed(2)}`} />
          <Receipt label={t('topup.pin.method')} value={methodLabel(paymentMethod)} />
        </GlassCard>

        <PinInput value={pin} onChange={setPin} onComplete={handlePinComplete} style={styles.pinInput} />

        {submitting && <ActivityIndicator color={ACCENT} style={{ marginTop: 20 }} />}

        <TouchableOpacity style={styles.backLink} onPress={() => { setPin(''); setStep('amount'); }}>
          <Text style={styles.backLinkText}>← {t('common.back')}</Text>
        </TouchableOpacity>
      </DarkScreen>
    );
  }

  // ── AMOUNT ──
  if (step === 'amount') {
    const amountValid = !!amount && parseFloat(amount) > 0;
    return (
      <DarkScreen edges={[]} scroll keyboard contentStyle={styles.scrollContent}>
        <GlassCard style={styles.customerCard}>
          <Text style={styles.customerLabel}>{t('topup.amount.customerLabel')}</Text>
          <Text style={styles.customerName}>{customer?.fullName}</Text>
          <Text style={styles.customerPhone}>{customer?.phoneNumber}</Text>
        </GlassCard>

        <Text style={styles.label}>{t('topup.amount.amountLabel')}</Text>
        <GlassCard style={styles.amountCard}>
          <Text style={styles.currency}>{CURRENCY_SYMBOL}</Text>
          <TextInput
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor={PLACEHOLDER}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            autoFocus
          />
        </GlassCard>
        <Text style={styles.limitHint}>
          {t('topup.amount.maximum', { amount: `${CURRENCY_SYMBOL}${MAX_TOPUP_AMOUNT.toLocaleString()}` })}
        </Text>

        <Text style={styles.label}>{t('topup.amount.paymentMethod')}</Text>
        <View style={styles.methodRow}>
          {PAYMENT_METHODS.map((m) => {
            const selected = paymentMethod === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.methodCard, selected && styles.methodCardSelected]}
                onPress={() => setPaymentMethod(m.key)}
                activeOpacity={0.75}
              >
                <Text style={styles.methodIcon}>{m.icon}</Text>
                <Text style={[styles.methodLabel, selected && styles.methodLabelSelected]}>{t(m.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>{t('topup.amount.referenceLabel')}</Text>
        <GlassCard style={styles.referenceCard}>
          <TextInput
            style={styles.referenceInput}
            placeholder={t('topup.amount.referencePlaceholder')}
            placeholderTextColor={PLACEHOLDER}
            value={reference}
            onChangeText={setReference}
          />
        </GlassCard>

        <PillButton label={t('topup.amount.continue')} onPress={handleAmountNext} disabled={!amountValid} />
        <TouchableOpacity style={styles.backLink} onPress={() => { setCustomer(null); setStep('lookup'); }}>
          <Text style={styles.backLinkText}>← {t('topup.amount.changeCustomer')}</Text>
        </TouchableOpacity>
      </DarkScreen>
    );
  }

  // ── LOOKUP ──
  return (
    <DarkScreen edges={[]} scroll keyboard contentStyle={styles.scrollContent}>
      <View style={styles.lookupHeader}>
        <View style={styles.lookupIcon}>
          <TopUpIcon size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.stepTitle}>{t('topup.lookup.title')}</Text>
        <Text style={styles.stepSubtitle}>{t('topup.lookup.subtitle')}</Text>
      </View>

      <Text style={styles.label}>{t('topup.lookup.phoneLabel')}</Text>
      <GlassCard style={styles.phoneRow}>
        <TouchableOpacity style={styles.countryBox} onPress={() => setShowCountryPicker(true)} activeOpacity={0.7}>
          <Text style={styles.flag}>{selectedCountry.flag}</Text>
          <Text style={styles.countryCode}>{selectedCountry.code}</Text>
          <Text style={styles.dropdownArrow}>▾</Text>
        </TouchableOpacity>
        <View style={styles.phoneDivider} />
        <TextInput
          ref={inputRef}
          style={styles.phoneInput}
          placeholder={t(selectedCountry.placeholderKey)}
          value={localNumber}
          onChangeText={(text) => setLocalNumber(text.replace(/[^\d\s\-\(\)]/g, ''))}
          keyboardType="phone-pad"
          maxLength={selectedCountry.maxInput}
          autoFocus
          placeholderTextColor={PLACEHOLDER}
          textContentType="telephoneNumber"
          onSubmitEditing={() => { if (isPhoneValid && !lookupLoading) handleLookup(); }}
        />
        {localNumber.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={() => setLocalNumber('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <View style={styles.clearIcon}>
              <Text style={styles.clearIconText}>✕</Text>
            </View>
          </TouchableOpacity>
        )}
      </GlassCard>

      <View style={{ marginTop: 24 }}>
        <PillButton
          label={t('topup.lookup.findCustomer')}
          onPress={handleLookup}
          loading={lookupLoading}
          disabled={!isPhoneValid}
        />
      </View>

      <Modal visible={showCountryPicker} transparent animationType="fade" onRequestClose={() => setShowCountryPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowCountryPicker(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('common.selectCountry')}</Text>
            <FlatList
              data={COUNTRIES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => {
                const selected = item.code === selectedCountry.code;
                return (
                  <TouchableOpacity
                    style={[styles.countryRow, selected && styles.countryRowSelected]}
                    onPress={() => handleCountrySelect(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.countryRowFlag}>{item.flag}</Text>
                    <View style={styles.countryRowInfo}>
                      <Text style={styles.countryRowName}>{t(item.nameKey)}</Text>
                      <Text style={styles.countryRowCode}>{item.code}</Text>
                    </View>
                    {selected && <Text style={styles.countryCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </DarkScreen>
  );
}

function Receipt({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={styles.receiptValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
  },

  lookupHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  lookupIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 15,
    color: TEXT_DIM,
    textAlign: 'center',
    lineHeight: 22,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 12,
  },

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    paddingRight: 6,
  },
  countryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  flag: { fontSize: 22, marginRight: 6 },
  countryCode: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  dropdownArrow: { fontSize: 13, color: TEXT_FAINT, marginLeft: 4 },
  phoneDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.12)' },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '500',
    color: '#FFFFFF',
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  clearBtn: { paddingRight: 8 },
  clearIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearIconText: { fontSize: 11, color: '#FFFFFF', fontWeight: '700' },

  customerCard: {
    padding: 20,
    alignItems: 'center',
    marginBottom: 28,
  },
  customerLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#FF8A7A',
    marginBottom: 6,
  },
  customerName: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },
  customerPhone: { fontSize: 14, color: TEXT_DIM, marginTop: 2 },

  amountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 72,
    marginBottom: 8,
  },
  currency: { fontSize: 32, fontWeight: '700', color: '#FFFFFF', marginRight: 8 },
  amountInput: { flex: 1, fontSize: 36, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1, padding: 0 },
  limitHint: { fontSize: 13, color: TEXT_FAINT, marginBottom: 24 },

  methodRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  methodCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  methodCardSelected: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(26,86,255,0.15)',
  },
  methodIcon: { fontSize: 24, marginBottom: 6 },
  methodLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  methodLabelSelected: { color: '#FFFFFF' },

  referenceCard: { marginBottom: 28 },
  referenceInput: {
    fontSize: 16,
    color: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  pinWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
  },
  summaryCard: {
    width: '100%',
    padding: 18,
    marginTop: 20,
    marginBottom: 28,
  },
  pinInput: { width: '100%' },

  resultWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  failIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,59,48,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  resultAmount: {
    fontSize: 40,
    fontWeight: '800',
    color: '#34C77B',
    letterSpacing: -1.5,
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 15,
    color: TEXT_DIM,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  receiptCard: {
    width: '100%',
    padding: 18,
    marginBottom: 28,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    gap: 16,
  },
  receiptLabel: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  receiptValue: { fontSize: 14, fontWeight: '600', color: '#FFFFFF', textAlign: 'right', flexShrink: 1 },

  resultActions: { alignSelf: 'stretch', gap: 6 },
  ghostLink: { paddingVertical: 14, alignItems: 'center' },
  ghostLinkText: { fontSize: 15, fontWeight: '600', color: TEXT_DIM },

  backLink: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  backLinkText: { fontSize: 15, fontWeight: '600', color: '#FF8A7A' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 16,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
    marginTop: 4,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  countryRowSelected: { backgroundColor: 'rgba(26,86,255,0.15)' },
  countryRowFlag: { fontSize: 26, marginRight: 14 },
  countryRowInfo: { flex: 1 },
  countryRowName: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  countryRowCode: { fontSize: 13, color: TEXT_DIM },
  countryCheck: { fontSize: 16, color: '#FF8A7A', fontWeight: '700' },
});
