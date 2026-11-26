import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { cooldownMessage } from '../../utils/cooldownMessage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, functions } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';
import { makeStyles, useColors } from '../../theme';
import { Springs } from '../../constants/springs';
import { useWallet } from '../../hooks/useWallet';
import { useHomeCurrency } from '../../hooks/useHomeCurrency';
import { useBiometricApproval } from '../../hooks/useBiometricApproval';
import { amountInputUnits, balanceIn, formatMoney, type Currency } from '../../utils/money';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { AnimatedXMark } from '../../components/icons/StatusIcons';

type Step = 'amount' | 'pin' | 'processing' | 'success' | 'error';

const KEYPAD = ['1','2','3','4','5','6','7','8','9','.','0','⌫'];
// A PIN has no decimal point; the blank keeps the grid aligned.
const PIN_KEYPAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

// The code is shown once by the server. Keep it on this phone until it expires
// so leaving the screen never strands money in the hold with no code to show.
interface SavedCashOut {
  cashOutId: string;
  otpCode: string;
  amountText: string;
  /** Codes saved before shilling cash-outs carry no currency: those were dollars. */
  currency?: Currency;
  expiresAt: string;
}
const savedKey = () => `@zapp/pendingCashOut/${auth().currentUser?.uid ?? 'anon'}`;
const saveCashOut = (c: SavedCashOut) =>
  AsyncStorage.setItem(savedKey(), JSON.stringify(c)).catch(() => {});
const clearSavedCashOut = () => AsyncStorage.removeItem(savedKey()).catch(() => {});

// The agent scans this. It names the one request the code belongs to, so a
// guessed code can never be tried against anyone else's cash-out.
const qrPayload = (id: string, code: string) =>
  JSON.stringify({ type: 'zapp_cashout', id, code });

// Dots must own their animation hooks: calling useAnimatedStyle inside the
// pin-step JSX changes the hook count between renders and crashes React.
function CashOutPinDot({ filled }: { filled: boolean }) {
  const styles = useStyles();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (filled) {
      scale.value = withSequence(
        withSpring(1.3, Springs.celebration),
        withSpring(1, Springs.feedback),
      );
    } else {
      scale.value = withTiming(1, { duration: 80 });
    }
  }, [filled, scale]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.pinDot, filled && styles.pinDotFilled, dotStyle]} />
  );
}

export default function CashOutScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [step, setStep] = useState<Step>('amount');
  const [amountText, setAmountText] = useState('');
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [cashOutId, setCashOutId] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  // Cash-out fee set by Zapp (free by default, decision D1).
  const [feeRate, setFeeRate] = useState(0);
  useEffect(() => {
    functions()
      .httpsCallable('getPricing')()
      .then((r) => setFeeRate((r.data as any)?.data?.cashOutFeeRate ?? 0))
      .catch(() => setFeeRate(0));
  }, []);

  // Reopen a code this phone already holds, if it hasn't expired.
  useEffect(() => {
    AsyncStorage.getItem(savedKey())
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as SavedCashOut;
        const exp = new Date(saved.expiresAt);
        if (exp.getTime() <= Date.now()) { void clearSavedCashOut(); return; }
        setPickedCurrency(saved.currency ?? 'USD');
        setAmountText(saved.amountText);
        setOtpCode(saved.otpCode);
        setCashOutId(saved.cashOutId);
        setExpiresAt(exp);
        setTimeLeft(Math.floor((exp.getTime() - Date.now()) / 1000));
        setStep('success');
        otpOpacity.value = 1;
        otpScale.value = 1;
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Amount pulse
  const amountScale = useSharedValue(1);
  // OTP digit reveal
  const otpOpacity = useSharedValue(0);
  const otpScale = useSharedValue(0.8);
  // Countdown pulse
  const timerGlow = useSharedValue(0);

  // Dollars or shillings: the cash comes out of that balance, and the agent
  // pays it in that currency. Starts on the currency Home shows.
  const { wallet } = useWallet();
  const { currency: homeCurrency } = useHomeCurrency(wallet?.balanceCents ?? 0, wallet?.slsBalance ?? 0);
  const [pickedCurrency, setPickedCurrency] = useState<Currency | null>(null);
  const currency = pickedCurrency ?? homeCurrency;

  /** Cents or whole shillings: what the server takes. */
  const amount = amountInputUnits(amountText, currency);
  const amountLabel = formatMoney(amount, currency);
  // The server rounds the fee the same way (computePaymentFee).
  const feeUnits = Math.min(Math.round(amount * feeRate), amount);

  const pickCurrency = (next: Currency) => {
    if (next === currency) return;
    triggerHaptic('light');
    setPickedCurrency(next);
    // 4.70 dollars is not 4.70 shillings: start the amount again.
    setAmountText('');
  };

  // Countdown timer for OTP expiry
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const diff = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      setTimeLeft(Math.max(0, diff));
      if (diff <= 60) {
        timerGlow.value = withSequence(
          withTiming(1, { duration: 300 }),
          withTiming(0.4, { duration: 700 }),
        );
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, timerGlow]);

  const appendDigit = (key: string) => {
    triggerHaptic('light');
    if (step === 'pin') {
      if (key === '⌫') {
        setPin((p) => p.slice(0, -1));
        return;
      }
      if (pin.length < 6 && /\d/.test(key)) {
        setPin(pin + key);
      }
      return;
    }
    if (key === '⌫') { setAmountText((p) => p.slice(0, -1)); return; }
    // Shillings are whole; dollars take two decimals.
    if (key === '.' && (currency === 'SLS' || amountText.includes('.'))) return;
    const decimals = amountText.split('.')[1];
    if (decimals !== undefined && decimals.length >= 2) return;
    if (amountText.replace('.', '').length >= 9) return;
    const next = amountText === '0' && key !== '.' ? key : amountText + key;
    setAmountText(next);
    amountScale.value = withSequence(
      withSpring(1.06, Springs.feedback),
      withSpring(1, { damping: 18, stiffness: 300 }),
    );
  };

  // Face ID, when it's on, stands in for the PIN keypad; cancelled, the keypad.
  const biometric = useBiometricApproval();
  const { prepare: prepareBiometric } = biometric;
  useEffect(() => {
    prepareBiometric();
  }, [prepareBiometric]);

  /** `credential` is the typed PIN, or Face ID's one-time token. */
  const submitWith = useCallback(async (credential: string) => {
    triggerHaptic('medium');
    setStep('processing');

    try {
      const fn = functions().httpsCallable('customerCashOut');
      const result = await fn({ amount, pin: credential, currency });
      const data = (result.data as any)?.data;
      if (!data?.otpCode || !data?.expiresAt) {
        throw new Error((result.data as any)?.error || t('cashout.failedTitle'));
      }
      setOtpCode(data.otpCode);
      setCashOutId(data.cashOutId ?? '');
      if (data.cashOutId) {
        void saveCashOut({
          cashOutId: data.cashOutId,
          otpCode: data.otpCode,
          amountText,
          currency,
          expiresAt: data.expiresAt,
        });
      }
      setExpiresAt(new Date(data.expiresAt));
      setTimeLeft(Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
      setStep('success');
      otpOpacity.value = withDelay(200, withTiming(1, { duration: 400 }));
      otpScale.value = withDelay(200, withSpring(1, Springs.celebration));
    } catch (e: any) {
      setErrorMsg(cooldownMessage(e, t) ?? (e.message || t('cashout.genericError')));
      setStep('error');
    }
  }, [amount, amountText, currency, otpOpacity, otpScale, t]);

  const handleContinue = async () => {
    if (amount <= 0) return;
    triggerHaptic('medium');
    if (biometric.available) {
      const token = await biometric.approve(t('common.confirmPaymentAmount', { amount: amountLabel }));
      if (token) {
        await submitWith(token);
        return;
      }
    }
    setStep('pin');
  };

  useEffect(() => {
    if (step === 'pin' && pin.length === 6) submitWith(pin);
  }, [step, pin, submitWith]);

  // The money is held, not gone: cancelling returns it to the wallet at once.
  const doCancel = useCallback(async () => {
    if (!cashOutId) return;
    setCancelling(true);
    try {
      await functions().httpsCallable('cancelCashOut')({ cashOutId });
      void clearSavedCashOut();
      triggerHaptic('success');
      Alert.alert(t('cashout.cancelledTitle'), t('cashout.cancelledBody'));
      navigation.goBack();
    } catch (e: any) {
      // Already paid out or gone: this saved code is no longer live.
      if (e?.code === 'functions/failed-precondition' || e?.code === 'functions/not-found') {
        void clearSavedCashOut();
      }
      Alert.alert(t('cashout.cancelFailed'), e?.message || '');
    } finally {
      setCancelling(false);
    }
  }, [cashOutId, navigation, t]);

  const confirmCancel = () => {
    Alert.alert(t('cashout.cancelConfirmTitle'), t('cashout.cancelConfirmBody'), [
      { text: t('cashout.keepCode'), style: 'cancel' },
      { text: t('cashout.cancelCta'), style: 'destructive', onPress: doCancel },
    ]);
  };

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const amountStyle = useAnimatedStyle(() => ({
    transform: [{ scale: amountScale.value }],
  }));
  const otpStyle = useAnimatedStyle(() => ({
    opacity: otpOpacity.value,
    transform: [{ scale: otpScale.value }],
  }));
  const timerStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + timerGlow.value * 0.5,
  }));

  // ── Success: show OTP ──────────────────────────────────
  if (step === 'success') {
    const warn = timeLeft < 120;
    const expired = timeLeft <= 0;
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('cashout.codeTitle')}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.otpContainer}>
          <Animated.View style={[styles.otpBox, otpStyle]}>
            {cashOutId && !expired ? (
              <View style={styles.qrCard}>
                <QRCode
                  value={qrPayload(cashOutId, otpCode)}
                  size={180}
                  color="#000000"
                  backgroundColor="#FFFFFF"
                />
              </View>
            ) : (
              <SuccessCheckIcon size={56} />
            )}
            <Text style={styles.otpLabel}>{t('cashout.showAgent')}</Text>
            <View style={styles.otpDigits}>
              {otpCode.split('').map((digit, i) => (
                <View key={i} style={styles.otpDigitBox}>
                  <Text style={styles.otpDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.otpAmount}>
              {t('cashout.willBePaid', { amount: amountLabel })}
            </Text>
          </Animated.View>

          <Animated.View style={[styles.timerRow, warn && styles.timerWarn, timerStyle]}>
            <Text style={[styles.timerText, warn && styles.timerTextWarn]}>
              {expired
                ? t('cashout.expiredReturned')
                : t('cashout.expiresIn', { time: formatTime(timeLeft) })}
            </Text>
          </Animated.View>

          <View style={styles.instructionCard}>
            <Text style={styles.instructionTitle}>{t('cashout.howTitle')}</Text>
            <Text style={styles.instructionStep}>{t('cashout.how1')}</Text>
            <Text style={styles.instructionStep}>{t('cashout.how2')}</Text>
            <Text style={styles.instructionStep}>{t('cashout.how3')}</Text>
            <Text style={styles.instructionStep}>{t('cashout.how4')}</Text>
          </View>

          <Text style={styles.heldNote}>{t('cashout.heldNote')}</Text>
          {!expired ? <Text style={styles.heldNote}>{t('cashout.reopenNote')}</Text> : null}

          {!expired && cashOutId ? (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={confirmCancel}
              disabled={cancelling}
            >
              {cancelling ? (
                <ActivityIndicator color={colors.ui.error} />
              ) : (
                <Text style={styles.cancelText}>{t('cashout.cancelCta')}</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // ── Error ──────────────────────────────────────────────
  if (step === 'error') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('cashout.title')}</Text>
        </View>
        <View style={styles.resultCenter}>
          <AnimatedXMark size={56} />
          <Text style={styles.errorTitle}>{t('cashout.failedTitle')}</Text>
          <Text style={styles.errorSub}>{errorMsg}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => { setStep('amount'); setPin(''); setErrorMsg(''); }}
          >
            <Text style={styles.retryText}>{t('cashout.tryAgain')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Processing ─────────────────────────────────────────
  if (step === 'processing') {
    return (
      <View style={[styles.container, styles.resultCenter]}>
        <ActivityIndicator size="large" color={colors.ui.accentText} />
        <Text style={styles.processingText}>{t('cashout.generating')}</Text>
      </View>
    );
  }

  // ── PIN entry ──────────────────────────────────────────
  if (step === 'pin') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep('amount')} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('cashout.confirmPin')}</Text>
        </View>
        <View style={styles.pinSection}>
          <Text style={styles.pinAmountLabel}>{t('cashout.withdrawing')}</Text>
          <Text style={styles.pinAmount} numberOfLines={1}>{amountLabel}</Text>
          <Text style={styles.feeLine}>
            {feeRate > 0
              ? t('cashout.feeLine', {
                  fee: formatMoney(feeUnits, currency),
                  total: formatMoney(amount + feeUnits, currency),
                })
              : t('cashout.free')}
          </Text>
          <View style={styles.pinDots}>
            {Array.from({ length: 6 }).map((_, i) => (
              <CashOutPinDot key={i} filled={i < pin.length} />
            ))}
          </View>
        </View>
        <View style={styles.keypad}>
          {PIN_KEYPAD.map((key, i) => (
            <TouchableOpacity
              key={key || `blank-${i}`}
              style={[styles.key, key === '⌫' && styles.keyDelete, !key && styles.keyBlank]}
              onPress={() => appendDigit(key)}
              disabled={!key}
              activeOpacity={0.6}
            >
              <Text style={[styles.keyText, key === '⌫' && styles.keyDeleteText]}>{key}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  // ── Amount entry ───────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>{t('cashout.title')}</Text>
          <Text style={styles.headerSub}>{t('cashout.subtitle')}</Text>
        </View>
      </View>

      <View style={styles.amountSection}>
        <View style={styles.segment} accessibilityRole="tablist">
          {(['SLS', 'USD'] as Currency[]).map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.segmentItem, currency === c && styles.segmentItemOn]}
              onPress={() => pickCurrency(c)}
              accessibilityRole="tab"
              accessibilityState={{ selected: currency === c }}
            >
              <Text style={[styles.segmentText, currency === c && styles.segmentTextOn]}>
                {c === 'SLS' ? t('topup.zaad.shillings') : t('topup.zaad.dollars')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.amountLabel}>{t('cashout.amountLabel')}</Text>
        <Animated.View style={[styles.amountRow, amountStyle]}>
          {currency === 'USD' && <Text style={styles.amountCurrency}>$</Text>}
          <Text
            style={[styles.amountDisplay, !amountText && styles.amountPlaceholder]}
            numberOfLines={1}
          >
            {currency === 'SLS'
              ? formatMoney(amount, 'SLS').replace(' SLSH', '')
              : amountText || '0.00'}
          </Text>
          {currency === 'SLS' && <Text style={styles.amountSuffix}>SLSH</Text>}
        </Animated.View>
        <Text style={styles.amountHint}>
          {t('payments.available', { amount: formatMoney(balanceIn(wallet, currency), currency) })}
        </Text>
      </View>

      <View style={styles.keypad}>
        {KEYPAD.map((key) => {
          // Shillings have no smaller unit, so no decimal point.
          const hidden = key === '.' && currency === 'SLS';
          return (
            <TouchableOpacity
              key={key}
              style={[styles.key, key === '⌫' && styles.keyDelete, hidden && styles.keyHidden]}
              onPress={() => appendDigit(key)}
              disabled={hidden}
              activeOpacity={0.6}
            >
              <Text style={[styles.keyText, key === '⌫' && styles.keyDeleteText]}>{key}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, amount <= 0 && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={amount <= 0}
          activeOpacity={0.8}
        >
          <Text style={styles.continueBtnText}>
            {biometric.available ? t('common.continueWith', { label: biometric.label }) : t('common.continue')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ui.ink(0.06),
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 24, color: colors.ui.text, lineHeight: 28 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.ui.text, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: colors.ui.ink(0.4), marginTop: 2 },

  // Amount entry
  amountSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  amountLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ui.ink(0.4), marginBottom: 16 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 },
  amountCurrency: { fontSize: 36, fontWeight: '700', color: colors.ui.text, marginBottom: 6, marginRight: 4 },
  amountDisplay: { fontSize: 56, fontWeight: '800', color: colors.ui.text, letterSpacing: -2, flexShrink: 1 },
  amountSuffix: { fontSize: 24, fontWeight: '700', color: colors.ui.text, marginBottom: 10, marginLeft: 8 },
  segment: {
    flexDirection: 'row', alignSelf: 'center', padding: 4, borderRadius: 14,
    backgroundColor: colors.ui.ink(0.06), marginBottom: 24,
  },
  segmentItem: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10 },
  segmentItemOn: { backgroundColor: colors.ui.accentText },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.ui.ink(0.6) },
  segmentTextOn: { color: colors.ui.onSolid },
  keyHidden: { opacity: 0 },
  amountPlaceholder: { color: colors.ui.ink(0.2) },
  amountHint: { fontSize: 13, color: colors.ui.ink(0.35) },

  // PIN
  pinSection: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pinAmountLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ui.ink(0.4), marginBottom: 8 },
  pinAmount: { fontSize: 36, fontWeight: '800', color: colors.ui.text, letterSpacing: -1, marginBottom: 8 },
  feeLine: { fontSize: 14, color: colors.ui.ink(0.6), marginBottom: 28, textAlign: 'center' },
  pinDots: { flexDirection: 'row', gap: 14 },
  pinDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.ui.ink(0.3), backgroundColor: 'transparent' },
  pinDotFilled: { backgroundColor: colors.ui.accentText, borderColor: colors.ui.accentText },

  // Keypad
  keypad: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24, gap: 12, justifyContent: 'center', paddingBottom: 24 },
  keyBlank: { backgroundColor: 'transparent' },
  key: { width: 88, height: 56, borderRadius: 14, backgroundColor: colors.ui.ink(0.07), alignItems: 'center', justifyContent: 'center' },
  keyDelete: { backgroundColor: 'transparent' },
  keyText: { fontSize: 22, fontWeight: '600', color: colors.ui.text },
  keyDeleteText: { fontSize: 20, color: colors.ui.ink(0.6) },

  footer: { paddingHorizontal: 24, paddingBottom: 36 },
  continueBtn: { height: 56, borderRadius: 28, backgroundColor: colors.ui.accentText, alignItems: 'center', justifyContent: 'center' },
  continueBtnDisabled: { opacity: 0.35 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },

  // Success / OTP
  otpContainer: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24, gap: 20 },
  qrCard: { padding: 14, borderRadius: 20, backgroundColor: '#FFFFFF' },
  heldNote: { fontSize: 13, lineHeight: 19, color: colors.ui.ink(0.5), textAlign: 'center' },
  cancelBtn: { minWidth: 200, alignItems: 'center', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,107,107,0.4)' },
  cancelText: { fontSize: 16, fontWeight: '600', color: colors.ui.error },
  otpBox: { width: '100%', backgroundColor: colors.ui.ink(0.05), borderWidth: 1, borderColor: colors.ui.ink(0.1), borderRadius: 20, padding: 24, alignItems: 'center', gap: 16 },
  otpLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, color: colors.ui.ink(0.45) },
  otpDigits: { flexDirection: 'row', gap: 8 },
  otpDigitBox: { width: 44, height: 54, borderRadius: 10, backgroundColor: 'rgba(111,155,255,0.12)', borderWidth: 1, borderColor: 'rgba(111,155,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  otpDigitText: { fontSize: 28, fontWeight: '800', color: colors.ui.accentText, letterSpacing: -0.5 },
  otpAmount: { fontSize: 14, color: colors.ui.ink(0.5) },
  timerRow: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(52,199,123,0.1)', borderWidth: 1, borderColor: 'rgba(52,199,123,0.3)' },
  timerWarn: { backgroundColor: 'rgba(255,92,92,0.1)', borderColor: 'rgba(255,92,92,0.3)' },
  timerText: { fontSize: 14, fontWeight: '600', color: colors.ui.incoming },
  timerTextWarn: { color: colors.ui.error },
  instructionCard: { width: '100%', backgroundColor: colors.ui.ink(0.03), borderRadius: 16, padding: 18, gap: 8 },
  instructionTitle: { fontSize: 13, fontWeight: '700', color: colors.ui.ink(0.6), marginBottom: 4 },
  instructionStep: { fontSize: 13, color: colors.ui.ink(0.45), lineHeight: 20 },

  // Error
  resultCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 22, fontWeight: '800', color: colors.ui.text, marginTop: 20, marginBottom: 10 },
  errorSub: { fontSize: 14, color: colors.ui.ink(0.45), textAlign: 'center', lineHeight: 21 },
  retryBtn: { marginTop: 28, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24, backgroundColor: colors.ui.ink(0.08) },
  retryText: { fontSize: 16, fontWeight: '600', color: colors.ui.text },
  processingText: { fontSize: 16, color: colors.ui.ink(0.5), marginTop: 20 },
}));
