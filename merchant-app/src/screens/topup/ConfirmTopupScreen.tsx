import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { triggerHaptic } from '../../services/haptics.service';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { CodeSheet, QrScannerView, ScannerButton } from '../../components/QrScannerView';
import { functions } from '../../services/firebase.config';
import {
  DarkScreen,
  GlassCard,
  PillButton,
  PinInput,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import { SuccessCheckIcon, CloseIcon } from '../../components/icons/AuthIcons';
import { formatCents } from '../../utils/money';
import { useExitGuard } from '../../hooks/useExitGuard';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';

type Step = 'capture' | 'pin' | 'processing' | 'success' | 'error';

interface Props {
  navigation: any;
}

interface Result {
  amount: number;
  customerName: string;
  commission: number;
  confirmationId: string;
}

// Accepts the QR JSON payload {type:'zapp_topup',code} or a raw 6-digit code.
function extractCode(value: string): string | null {
  const raw = value.trim();
  if (/^\d{6}$/.test(raw)) return raw;
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.type === 'zapp_topup' && /^\d{6}$/.test(String(obj.code))) {
      return String(obj.code);
    }
  } catch {
    // not JSON
  }
  return null;
}

function shortConfirmation(id: string): string {
  return `ZP-${id.slice(-6).toUpperCase()}`;
}

export default function ConfirmTopupScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('capture');
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // The customer's 6-digit code typed instead of scanned.
  const [typing, setTyping] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // The code identifies the customer's request; the PIN proves the person
  // holding the phone is the agent whose float is about to be spent.
  const [pendingCode, setPendingCode] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const isProcessing = useRef(false);

  useFocusEffect(
    useCallback(() => {
      isProcessing.current = false;
      setScanError(null);
    }, []),
  );

  const confirm = useCallback(async (code: string, agentPin: string) => {
    if (isProcessing.current) return;
    isProcessing.current = true;
    setStep('processing');
    try {
      const fn = functions().httpsCallable('agentConfirmTopup');
      const res = await fn({ otpCode: code, agentPin });
      setResult((res.data as any).data);
      setStep('success');
    } catch (e: any) {
      // The PIN is checked before the code is looked up, so a wrong PIN costs
      // no code guess: keep the scanned code and ask for the PIN again.
      if (isWrongPin(e)) {
        setPinError(t('errors.wrongPin'));
        setStep('pin');
      } else {
        setErrorMsg(t(pinActionErrorKey(e)));
        setStep('error');
      }
    } finally {
      setPin('');
      isProcessing.current = false;
    }
  }, [t]);

  const askForPin = useCallback((code: string) => {
    setPendingCode(code);
    setPin('');
    setPinError('');
    setStep('pin');
  }, []);

  const cancelPin = () => {
    setPin('');
    setPinError('');
    setPendingCode('');
    setScanError(null);
    isProcessing.current = false;
    setStep('capture');
  };

  // Confirming spends the agent's float: while that runs nothing leaves, and
  // back from the PIN step returns to the scanner instead of closing.
  useExitGuard(navigation, {
    blocked: step === 'processing',
    onExit: step === 'pin' ? cancelPin : undefined,
  });

  const handleScan = useCallback(
    (value: string) => {
      if (isProcessing.current) return;
      const code = extractCode(value);
      if (!code) {
        setScanError(t('topup.confirm.notTopupCode'));
        return;
      }
      triggerHaptic('medium');
      askForPin(code);
    },
    [askForPin, t],
  );

  const handleManual = () => {
    const code = extractCode(manual);
    if (!code) {
      setScanError(t('agent.enterCustomerCode'));
      return;
    }
    askForPin(code);
  };

  if (step === 'success' && result) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.resultTitle}>{t('topup.confirm.successTitle')}</Text>
        <Text style={styles.resultAmount}>{formatCents(result.amount)}</Text>
        <Text style={styles.resultSub}>
          {t('topup.confirm.creditedTo', { name: result.customerName })}
        </Text>
        <GlassCard style={styles.confCard}>
          <Text style={styles.confLabel}>{t('topup.confirm.confirmationId')}</Text>
          <Text style={styles.confValue}>{shortConfirmation(result.confirmationId)}</Text>
        </GlassCard>
        {result.commission > 0 && (
          <GlassCard style={styles.commissionCard}>
            <Text style={styles.commissionLabel}>{t('agent.yourCommission')}</Text>
            <Text style={styles.commissionValue}>+{formatCents(result.commission)}</Text>
          </GlassCard>
        )}
        <View style={styles.resultBtn}>
          <PillButton label={t('common.done')} onPress={() => navigation.goBack()} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'error') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <View style={styles.failIcon}>
          <CloseIcon size={32} color="#FF6961" />
        </View>
        <Text style={styles.resultTitle}>{t('agent.couldNotConfirm')}</Text>
        <Text style={styles.resultSub}>{errorMsg}</Text>
        <View style={styles.resultBtn}>
          <PillButton
            label={t('common.tryAgain')}
            variant="glass"
            onPress={() => {
              setStep('capture');
              setManual('');
              setErrorMsg('');
              setScanError(null);
              isProcessing.current = false;
            }}
          />
          <PillButton
            label={t('common.close')}
            variant="glass"
            onPress={() => navigation.goBack()}
            style={styles.secondBtn}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <Text style={styles.resultTitle}>{t('topup.confirm.pinTitle')}</Text>
        <Text style={styles.resultSub}>{t('topup.confirm.pinSubtitle')}</Text>
        <PinInput
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError('');
          }}
          onComplete={(entered) => confirm(pendingCode, entered)}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        <View style={styles.resultBtn}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={cancelPin} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'processing') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.processingText}>{t('topup.confirm.processing')}</Text>
      </DarkScreen>
    );
  }

  return (
    <>
      <QrScannerView
        title={t('topup.confirm.title')}
        hint={t('topup.confirm.scanHint')}
        onScan={handleScan}
        onClose={() => navigation.goBack()}
        scanning={!typing}
        error={scanError}
        onDismissError={() => setScanError(null)}
      >
        <ScannerButton label={t('topup.confirm.enterCode')} onPress={() => setTyping(true)} />
        {/* Cash in without a code: find the customer by phone instead. */}
        <ScannerButton link label={t('topup.confirm.byPhone')} onPress={() => navigation.replace('TopupCustomer')} />
      </QrScannerView>
      <CodeSheet
        visible={typing}
        title={t('agent.enterCustomerCode')}
        value={manual}
        onChangeText={(v) => {
          setManual(v.replace(/\D/g, '').slice(0, 6));
          setScanError(null);
        }}
        placeholder="000000"
        submitLabel={t('topup.confirm.submit')}
        onSubmit={() => {
          setTyping(false);
          handleManual();
        }}
        onClose={() => setTyping(false)}
        submitDisabled={extractCode(manual) === null}
        keyboardType="number-pad"
        maxLength={6}
        digits
      />
    </>
  );
}

const styles = StyleSheet.create({
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  failIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,59,48,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  resultTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, textAlign: 'center', marginTop: 20 },
  resultAmount: { fontSize: 44, fontWeight: '800', color: '#34C77B', letterSpacing: -2, marginTop: 8 },
  resultSub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  confCard: { marginTop: 20, padding: 16, alignItems: 'center', width: '100%' },
  confLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  confValue: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 4, letterSpacing: 1 },
  commissionCard: { marginTop: 14, padding: 16, alignItems: 'center', width: '100%' },
  commissionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  commissionValue: { fontSize: 26, fontWeight: '800', color: '#34C77B', marginTop: 4 },
  resultBtn: { alignSelf: 'stretch', marginTop: 28 },
  secondBtn: { marginTop: 12 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  processingText: { fontSize: 16, color: TEXT_DIM, marginTop: 20 },
});
