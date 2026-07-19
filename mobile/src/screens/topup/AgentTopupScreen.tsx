import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useNavigation } from '@react-navigation/native';
import firestore from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import { functions } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';
import { colors } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { AnimatedXMark } from '../../components/icons/StatusIcons';

type Step = 'amount' | 'processing' | 'code' | 'done' | 'error';

const ACCENT = '#FF8A7A';
const INCOMING = '#34C77B';
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
const TOPUP_REQUESTS = 'agentTopupRequests';

// Encoded in the QR the agent scans; the 6-digit code stays the source of truth.
function qrPayload(code: string): string {
  return JSON.stringify({ type: 'zapp_topup', code });
}

function shortConfirmation(id: string): string {
  return `ZP-${id.slice(-6).toUpperCase()}`;
}

export default function AgentTopupScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('amount');
  const [amountText, setAmountText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [requestId, setRequestId] = useState('');
  const [confirmationId, setConfirmationId] = useState('');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const unsubRef = useRef<(() => void) | null>(null);

  const amount = parseFloat(amountText || '0');

  // Countdown timer for code expiry
  useEffect(() => {
    if (!expiresAt || step !== 'code') return;
    const tick = () => {
      const diff = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      setTimeLeft(Math.max(0, diff));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, step]);

  // Live listener — the agent's confirmation updates the request doc, and we
  // reflect it instantly (backed up by a push notification).
  useEffect(() => {
    if (!requestId) return;
    const unsub = firestore()
      .collection(TOPUP_REQUESTS)
      .doc(requestId)
      .onSnapshot((snap) => {
        const data = snap.data();
        if (!data) return;
        if (data.status === 'completed') {
          setConfirmationId(data.confirmationId || data.transactionId || '');
          triggerHaptic('success');
          setStep('done');
        } else if (data.status === 'expired' || data.status === 'cancelled') {
          setErrorMsg(t('topup.agent.expiredMessage'));
          setStep('error');
        }
      });
    unsubRef.current = unsub;
    return () => {
      unsub();
      unsubRef.current = null;
    };
  }, [requestId, t]);

  useEffect(() => () => unsubRef.current?.(), []);

  const appendDigit = (key: string) => {
    triggerHaptic('light');
    if (key === '⌫') {
      setAmountText((p) => p.slice(0, -1));
      return;
    }
    if (key === '.' && amountText.includes('.')) return;
    setAmountText((p) => p + key);
  };

  const handleGenerate = useCallback(async () => {
    if (!amountText || amount <= 0) return;
    triggerHaptic('medium');
    setStep('processing');
    try {
      const fn = functions().httpsCallable('customerRequestAgentTopup');
      const result = await fn({ amount: Math.round(amount * 100) });
      const data = (result.data as any).data;
      setOtpCode(data.otpCode);
      setRequestId(data.requestId);
      setExpiresAt(new Date(data.expiresAt));
      setTimeLeft(
        Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
      );
      setStep('code');
    } catch (e: any) {
      setErrorMsg(e.message || t('common.error'));
      setStep('error');
    }
  }, [amount, amountText, t]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const reset = () => {
    unsubRef.current?.();
    unsubRef.current = null;
    setStep('amount');
    setAmountText('');
    setErrorMsg('');
    setOtpCode('');
    setRequestId('');
    setConfirmationId('');
    setExpiresAt(null);
  };

  // ── Done: topped up ────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('topup.agent.successTitle')}</Text>
        </View>
        <View style={styles.resultCenter}>
          <SuccessCheckIcon size={64} />
          <Text style={styles.doneTitle}>{t('topup.agent.toppedUp')}</Text>
          <Text style={styles.doneAmount}>
            {CURRENCY_SYMBOL}
            {amount.toFixed(2)}
          </Text>
          {confirmationId ? (
            <View style={styles.confBox}>
              <Text style={styles.confLabel}>{t('topup.agent.confirmationId')}</Text>
              <Text style={styles.confValue}>{shortConfirmation(confirmationId)}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
          >
            <Text style={styles.continueBtnText}>{t('common.done')}</Text>
          </TouchableOpacity>
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
          <Text style={styles.headerTitle}>{t('topup.agent.title')}</Text>
        </View>
        <View style={styles.resultCenter}>
          <AnimatedXMark size={56} />
          <Text style={styles.errorTitle}>{t('topup.agent.failedTitle')}</Text>
          <Text style={styles.errorSub}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reset}>
            <Text style={styles.retryText}>{t('common.tryAgain')}</Text>
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
        <Text style={styles.processingText}>{t('topup.agent.generating')}</Text>
      </View>
    );
  }

  // ── Show code + QR, waiting for agent ──────────────────
  if (step === 'code') {
    const warn = timeLeft < 120;
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('topup.agent.showAgentTitle')}</Text>
        </View>

        <View style={styles.codeContainer}>
          <View style={styles.qrCard}>
            <QRCode
              value={qrPayload(otpCode)}
              size={188}
              color="#000000"
              backgroundColor="#FFFFFF"
            />
          </View>

          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>{t('topup.agent.orEnterCode')}</Text>
            <View style={styles.codeDigits}>
              {otpCode.split('').map((digit, i) => (
                <View key={i} style={styles.codeDigitBox}>
                  <Text style={styles.codeDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.codeAmount}>
              {t('topup.agent.payAgent', {
                amount: `${CURRENCY_SYMBOL}${amount.toFixed(2)}`,
              })}
            </Text>
          </View>

          <View style={[styles.timerRow, warn && styles.timerWarn]}>
            <Text style={[styles.timerText, warn && styles.timerTextWarn]}>
              {t('topup.agent.expiresIn', { time: formatTime(timeLeft) })}
            </Text>
          </View>

          <View style={styles.waitingRow}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
            <Text style={styles.waitingText}>{t('topup.agent.waiting')}</Text>
          </View>
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
          <Text style={styles.headerTitle}>{t('topup.agent.title')}</Text>
          <Text style={styles.headerSub}>{t('topup.agent.subtitle')}</Text>
        </View>
      </View>

      <View style={styles.amountSection}>
        <Text style={styles.amountLabel}>{t('topup.agent.amountLabel')}</Text>
        <View style={styles.amountRow}>
          <Text style={styles.amountCurrency}>{CURRENCY_SYMBOL}</Text>
          <Text style={[styles.amountDisplay, !amountText && styles.amountPlaceholder]}>
            {amountText || '0.00'}
          </Text>
        </View>
        <Text style={styles.amountHint}>{t('topup.agent.amountHint')}</Text>
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
          onPress={handleGenerate}
          disabled={!amountText || amount <= 0}
          activeOpacity={0.8}
        >
          <Text style={styles.continueBtnText}>{t('common.continue')}</Text>
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

  // Keypad
  keypad: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24, gap: 12, justifyContent: 'center', paddingBottom: 24 },
  key: { width: 88, height: 56, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  keyDelete: { backgroundColor: 'transparent' },
  keyText: { fontSize: 22, fontWeight: '600', color: '#FFFFFF' },
  keyDeleteText: { fontSize: 20, color: 'rgba(255,255,255,0.6)' },

  footer: { paddingHorizontal: 24, paddingBottom: 36 },
  continueBtn: { height: 56, borderRadius: 28, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', marginTop: 28 },
  continueBtnDisabled: { opacity: 0.35 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },

  // Code + QR
  codeContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  qrCard: { padding: 16, borderRadius: 20, backgroundColor: '#FFFFFF' },
  codeBox: { width: '100%', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 20, alignItems: 'center', gap: 12 },
  codeLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, color: 'rgba(255,255,255,0.45)' },
  codeDigits: { flexDirection: 'row', gap: 8 },
  codeDigitBox: { width: 40, height: 50, borderRadius: 10, backgroundColor: 'rgba(255,138,122,0.12)', borderWidth: 1, borderColor: 'rgba(255,138,122,0.35)', alignItems: 'center', justifyContent: 'center' },
  codeDigitText: { fontSize: 26, fontWeight: '800', color: ACCENT, letterSpacing: -0.5 },
  codeAmount: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  timerRow: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(52,199,123,0.1)', borderWidth: 1, borderColor: 'rgba(52,199,123,0.3)' },
  timerWarn: { backgroundColor: 'rgba(255,92,92,0.1)', borderColor: 'rgba(255,92,92,0.3)' },
  timerText: { fontSize: 14, fontWeight: '600', color: INCOMING },
  timerTextWarn: { color: '#FF6961' },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitingText: { fontSize: 13, color: 'rgba(255,255,255,0.45)' },

  // Done
  doneTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', marginTop: 20 },
  doneAmount: { fontSize: 44, fontWeight: '800', color: INCOMING, letterSpacing: -2, marginTop: 8 },
  confBox: { marginTop: 24, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 28 },
  confLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' },
  confValue: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 4, letterSpacing: 1 },

  // Result shared
  resultCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 20, marginBottom: 10 },
  errorSub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 21 },
  retryBtn: { marginTop: 28, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.08)' },
  retryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  processingText: { fontSize: 16, color: 'rgba(255,255,255,0.5)', marginTop: 20 },
});
