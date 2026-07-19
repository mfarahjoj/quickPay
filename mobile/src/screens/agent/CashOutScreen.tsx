import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  cancelAnimation,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { functions } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { Springs } from '../../constants/springs';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { AnimatedXMark } from '../../components/icons/StatusIcons';

type Step = 'amount' | 'pin' | 'processing' | 'success' | 'error';

const ACCENT = '#FF8A7A';
const INCOMING = '#34C77B';
const KEYPAD = ['1','2','3','4','5','6','7','8','9','.','0','⌫'];

export default function CashOutScreen() {
  const navigation = useNavigation();
  const [step, setStep] = useState<Step>('amount');
  const [amountText, setAmountText] = useState('');
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  // Amount pulse
  const amountScale = useSharedValue(1);
  // OTP digit reveal
  const otpOpacity = useSharedValue(0);
  const otpScale = useSharedValue(0.8);
  // Pin dots
  const pinDots = Array.from({ length: 6 }, () => useSharedValue(0));
  // Countdown pulse
  const timerGlow = useSharedValue(0);

  const amount = parseFloat(amountText || '0');

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
  }, [expiresAt]);

  const appendDigit = (key: string) => {
    triggerHaptic('light');
    if (step === 'pin') {
      if (key === '⌫') {
        setPin((p) => p.slice(0, -1));
        return;
      }
      if (pin.length < 6 && /\d/.test(key)) {
        const next = pin + key;
        setPin(next);
        pinDots[next.length - 1].value = withSequence(
          withSpring(1.3, Springs.celebration),
          withSpring(1, Springs.feedback),
        );
      }
      return;
    }
    if (key === '⌫') { setAmountText((p) => p.slice(0, -1)); return; }
    if (key === '.' && amountText.includes('.')) return;
    const next = amountText + key;
    setAmountText(next);
    amountScale.value = withSequence(
      withSpring(1.06, Springs.feedback),
      withSpring(1, { damping: 18, stiffness: 300 }),
    );
  };

  const handleContinue = () => {
    if (!amountText || amount <= 0) return;
    triggerHaptic('medium');
    setStep('pin');
  };

  const handleSubmit = useCallback(async () => {
    if (pin.length < 6) return;
    triggerHaptic('medium');
    setStep('processing');

    try {
      const fn = functions().httpsCallable('customerCashOut');
      const result = await fn({ amount: Math.round(amount * 100), pin });
      const data = (result.data as any).data;
      setOtpCode(data.otpCode);
      setExpiresAt(new Date(data.expiresAt));
      setTimeLeft(Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
      setStep('success');
      otpOpacity.value = withDelay(200, withTiming(1, { duration: 400 }));
      otpScale.value = withDelay(200, withSpring(1, Springs.celebration));
    } catch (e: any) {
      setErrorMsg(e.message || 'Something went wrong');
      setStep('error');
    }
  }, [pin, amount]);

  useEffect(() => {
    if (pin.length === 6) handleSubmit();
  }, [pin]);

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
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Your Cash-Out Code</Text>
        </View>

        <View style={styles.otpContainer}>
          <SuccessCheckIcon size={56} />

          <Animated.View style={[styles.otpBox, otpStyle]}>
            <Text style={styles.otpLabel}>Show this code to the agent</Text>
            <View style={styles.otpDigits}>
              {otpCode.split('').map((digit, i) => (
                <View key={i} style={styles.otpDigitBox}>
                  <Text style={styles.otpDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.otpAmount}>
              {CURRENCY_SYMBOL}{amount.toFixed(2)} will be paid in cash
            </Text>
          </Animated.View>

          <Animated.View style={[styles.timerRow, warn && styles.timerWarn, timerStyle]}>
            <Text style={[styles.timerText, warn && styles.timerTextWarn]}>
              Expires in {formatTime(timeLeft)}
            </Text>
          </Animated.View>

          <View style={styles.instructionCard}>
            <Text style={styles.instructionTitle}>How it works</Text>
            <Text style={styles.instructionStep}>1. Find an agent using the Agent Locator</Text>
            <Text style={styles.instructionStep}>2. Show this 6-digit code to the agent</Text>
            <Text style={styles.instructionStep}>3. Agent enters the code to confirm</Text>
            <Text style={styles.instructionStep}>4. Receive your cash — done</Text>
          </View>
        </View>
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
          <Text style={styles.headerTitle}>Cash Out</Text>
        </View>
        <View style={styles.resultCenter}>
          <AnimatedXMark size={56} />
          <Text style={styles.errorTitle}>Cash-out failed</Text>
          <Text style={styles.errorSub}>{errorMsg}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => { setStep('amount'); setPin(''); setAmountText(''); setErrorMsg(''); }}
          >
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Processing ─────────────────────────────────────────
  if (step === 'processing') {
    return (
      <View style={[styles.container, styles.resultCenter]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.processingText}>Generating your code…</Text>
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
          <Text style={styles.headerTitle}>Confirm with PIN</Text>
        </View>
        <View style={styles.pinSection}>
          <Text style={styles.pinAmountLabel}>Withdrawing</Text>
          <Text style={styles.pinAmount}>{CURRENCY_SYMBOL}{amount.toFixed(2)}</Text>
          <View style={styles.pinDots}>
            {Array.from({ length: 6 }).map((_, i) => {
              const filled = i < pin.length;
              const dotStyle = useAnimatedStyle(() => ({
                transform: [{ scale: filled ? pinDots[i].value || 1 : 1 }],
              }));
              return (
                <Animated.View
                  key={i}
                  style={[styles.pinDot, filled && styles.pinDotFilled, dotStyle]}
                />
              );
            })}
          </View>
        </View>
        <View style={styles.keypad}>
          {KEYPAD.map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.key, key === '⌫' && styles.keyDelete]}
              onPress={() => appendDigit(key)}
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
          <Text style={styles.headerTitle}>Cash Out</Text>
          <Text style={styles.headerSub}>Withdraw cash via an agent</Text>
        </View>
      </View>

      <View style={styles.amountSection}>
        <Text style={styles.amountLabel}>Amount to withdraw</Text>
        <Animated.View style={[styles.amountRow, amountStyle]}>
          <Text style={styles.amountCurrency}>{CURRENCY_SYMBOL}</Text>
          <Text style={[styles.amountDisplay, !amountText && styles.amountPlaceholder]}>
            {amountText || '0.00'}
          </Text>
        </Animated.View>
        <Text style={styles.amountHint}>Agent will pay you this in cash</Text>
      </View>

      <View style={styles.keypad}>
        {KEYPAD.map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.key, key === '⌫' && styles.keyDelete]}
            onPress={() => appendDigit(key)}
            activeOpacity={0.6}
          >
            <Text style={[styles.keyText, key === '⌫' && styles.keyDeleteText]}>{key}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, (!amountText || amount <= 0) && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!amountText || amount <= 0}
          activeOpacity={0.8}
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 24, color: '#FFFFFF', lineHeight: 28 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  // Amount entry
  amountSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  amountLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 16 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 },
  amountCurrency: { fontSize: 36, fontWeight: '700', color: '#FFFFFF', marginBottom: 6, marginRight: 4 },
  amountDisplay: { fontSize: 64, fontWeight: '800', color: '#FFFFFF', letterSpacing: -2 },
  amountPlaceholder: { color: 'rgba(255,255,255,0.2)' },
  amountHint: { fontSize: 13, color: 'rgba(255,255,255,0.35)' },

  // PIN
  pinSection: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pinAmountLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 },
  pinAmount: { fontSize: 36, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1, marginBottom: 32 },
  pinDots: { flexDirection: 'row', gap: 14 },
  pinDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'transparent' },
  pinDotFilled: { backgroundColor: ACCENT, borderColor: ACCENT },

  // Keypad
  keypad: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24, gap: 12, justifyContent: 'center', paddingBottom: 24 },
  key: { width: 88, height: 56, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  keyDelete: { backgroundColor: 'transparent' },
  keyText: { fontSize: 22, fontWeight: '600', color: '#FFFFFF' },
  keyDeleteText: { fontSize: 20, color: 'rgba(255,255,255,0.6)' },

  footer: { paddingHorizontal: 24, paddingBottom: 36 },
  continueBtn: { height: 56, borderRadius: 28, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  continueBtnDisabled: { opacity: 0.35 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },

  // Success / OTP
  otpContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 24 },
  otpBox: { width: '100%', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 24, alignItems: 'center', gap: 16 },
  otpLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, color: 'rgba(255,255,255,0.45)' },
  otpDigits: { flexDirection: 'row', gap: 8 },
  otpDigitBox: { width: 44, height: 54, borderRadius: 10, backgroundColor: 'rgba(111,155,255,0.12)', borderWidth: 1, borderColor: 'rgba(111,155,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  otpDigitText: { fontSize: 28, fontWeight: '800', color: ACCENT, letterSpacing: -0.5 },
  otpAmount: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  timerRow: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(52,199,123,0.1)', borderWidth: 1, borderColor: 'rgba(52,199,123,0.3)' },
  timerWarn: { backgroundColor: 'rgba(255,92,92,0.1)', borderColor: 'rgba(255,92,92,0.3)' },
  timerText: { fontSize: 14, fontWeight: '600', color: INCOMING },
  timerTextWarn: { color: '#FF6961' },
  instructionCard: { width: '100%', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 18, gap: 8 },
  instructionTitle: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
  instructionStep: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 20 },

  // Error
  resultCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 20, marginBottom: 10 },
  errorSub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 21 },
  retryBtn: { marginTop: 28, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.08)' },
  retryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  processingText: { fontSize: 16, color: 'rgba(255,255,255,0.5)', marginTop: 20 },
});
