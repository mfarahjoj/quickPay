import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { triggerHaptic } from '../../services/haptics.service';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { getZaadStatus, startZaadInPerson, type ZaadAgentStatus } from '../../services/zaadAgent.service';
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
import { formatAmount, READS_CURRENCIES } from '../../utils/money';
import { useExitGuard } from '../../hooks/useExitGuard';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';

type Step = 'capture' | 'checking' | 'review' | 'pin' | 'processing' | 'success' | 'error';

interface Props {
  navigation: any;
}

/** Which request the code is for. The server refuses a bare code. */
type Target =
  | { otpCode: string; requestId: string }
  | { otpCode: string; customerPhone: string };

interface Preview {
  requestId: string;
  amount: number;
  currency: string;
  customerName: string;
}

interface Result {
  amount: number;
  /** Absent from servers before shillings: dollars. */
  currency?: string;
  customerName: string;
  commission: number;
  confirmationId: string;
}

/** The customer's QR: {type:'zapp_topup', id, code}. Older apps leave out the id. */
function parseTopupQr(value: string): { otpCode: string; requestId?: string } | null {
  try {
    const obj = JSON.parse(value.trim());
    if (obj && obj.type === 'zapp_topup' && /^\d{6}$/.test(String(obj.code))) {
      const id = typeof obj.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(obj.id) ? obj.id : undefined;
      return { otpCode: String(obj.code), requestId: id };
    }
  } catch {
    // not JSON
  }
  return null;
}

// Loose client check; the server normalises and decides.
const phoneLooksValid = (v: string) => v.replace(/\D/g, '').length >= 7;

/**
 * A smaller size for a long amount ("400,000 SLSH"), so the figure the agent
 * pays out never gets cut off. Shrink-to-fit isn't used: it can draw text as
 * a dot.
 */
function longAmount(text: string) {
  if (text.length > 12) return { fontSize: 30, letterSpacing: -1 };
  if (text.length > 9) return { fontSize: 36, letterSpacing: -1 };
  return null;
}

function shortConfirmation(id: string): string {
  return `ZP-${id.slice(-6).toUpperCase()}`;
}

/**
 * Top up a customer who has a top-up code in their Zapp app.
 *
 * capture → checking → review → pin → processing → success. The review step
 * shows the customer's name and the amount *before* the agent takes the cash
 * or enters their PIN, and the confirm is refused for any other amount: the
 * customer chooses the amount, but the agent's float pays it.
 */
export default function ConfirmTopupScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('capture');
  const [typing, setTyping] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  // An older customer app's QR has no request id: ask for the phone instead.
  const [needPhoneFor, setNeedPhoneFor] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const isProcessing = useRef(false);
  /** Whether this agent can take Zaad (D20): switched on, number checked in person. */
  const [zaad, setZaad] = useState<ZaadAgentStatus | null>(null);
  const [zaadError, setZaadError] = useState('');

  React.useEffect(() => {
    getZaadStatus().then(setZaad).catch(() => setZaad(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      isProcessing.current = false;
      setScanError(null);
    }, []),
  );

  const startOver = useCallback(() => {
    setStep('capture');
    setTarget(null);
    setPreview(null);
    setPin('');
    setPinError('');
    setErrorMsg('');
    setScanError(null);
    setManualCode('');
    setManualPhone('');
    setNeedPhoneFor(null);
    isProcessing.current = false;
  }, []);

  const fail = useCallback((e: any) => {
    setErrorMsg(t(pinActionErrorKey(e)));
    setStep('error');
  }, [t]);

  /** Ask the server what this code is for, before any cash changes hands. */
  const check = useCallback(async (next: Target) => {
    if (isProcessing.current) return;
    isProcessing.current = true;
    setTarget(next);
    setStep('checking');
    try {
      const res = await functions().httpsCallable('previewAgentTopup')({ ...next, currencies: READS_CURRENCIES });
      const data = (res.data as any).data as Preview;
      // From here on the request is named by id, whichever way it was found.
      setTarget({ otpCode: next.otpCode, requestId: data.requestId });
      setPreview(data);
      triggerHaptic('medium');
      setStep('review');
    } catch (e: any) {
      fail(e);
    } finally {
      isProcessing.current = false;
    }
  }, [fail]);

  const confirm = useCallback(async (agentPin: string) => {
    if (isProcessing.current || !target || !preview) return;
    isProcessing.current = true;
    setStep('processing');
    try {
      const res = await functions().httpsCallable('agentConfirmTopup')({
        ...target,
        agentPin,
        expectedAmount: preview.amount,
        expectedCurrency: preview.currency,
        currencies: READS_CURRENCIES,
      });
      setResult((res.data as any).data);
      triggerHaptic('success');
      setStep('success');
    } catch (e: any) {
      // The PIN is checked before the code, so a wrong PIN costs no code
      // guess: keep the request and ask for the PIN again.
      if (isWrongPin(e)) {
        setPinError(t('errors.wrongPin'));
        setStep('pin');
      } else {
        fail(e);
      }
    } finally {
      setPin('');
      isProcessing.current = false;
    }
  }, [target, preview, t, fail]);

  // Nothing leaves while float is being spent; back from review or the PIN
  // returns to the scanner instead of closing.
  useExitGuard(navigation, {
    blocked: step === 'processing' || step === 'checking',
    onExit: step === 'pin' || step === 'review' ? startOver : undefined,
  });

  const handleScan = useCallback(
    (value: string) => {
      if (isProcessing.current) return;
      const scanned = parseTopupQr(value);
      if (!scanned) {
        setScanError(t('topup.confirm.notTopupCode'));
        return;
      }
      if (scanned.requestId) {
        check({ otpCode: scanned.otpCode, requestId: scanned.requestId });
      } else {
        // Old customer app: the code alone can't say whose it is.
        setNeedPhoneFor(scanned.otpCode);
        setManualCode(scanned.otpCode);
        setTyping(true);
      }
    },
    [check, t],
  );

  const manualValid = /^\d{6}$/.test(manualCode) && phoneLooksValid(manualPhone);

  const submitManual = () => {
    if (!manualValid) return;
    setTyping(false);
    setNeedPhoneFor(null);
    check({ otpCode: manualCode, customerPhone: manualPhone.trim() });
  };

  // ── Success ──
  if (step === 'success' && result) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.resultTitle}>{t('topup.confirm.successTitle')}</Text>
        <Text style={[styles.resultAmount, longAmount(formatAmount(result.amount, result.currency ?? preview?.currency))]} numberOfLines={1}>
          {formatAmount(result.amount, result.currency ?? preview?.currency)}
        </Text>
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
            <Text style={styles.commissionValue}>+{formatAmount(result.commission, result.currency ?? preview?.currency)}</Text>
          </GlassCard>
        )}
        <View style={styles.resultBtn}>
          <PillButton label={t('common.done')} onPress={() => navigation.goBack()} />
        </View>
      </DarkScreen>
    );
  }

  // ── Error ──
  if (step === 'error') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <View style={styles.failIcon}>
          <CloseIcon size={32} color="#FF6961" />
        </View>
        <Text style={styles.resultTitle}>{t('agent.couldNotConfirm')}</Text>
        <Text style={styles.resultSub}>{errorMsg}</Text>
        <View style={styles.resultBtn}>
          <PillButton label={t('common.tryAgain')} variant="glass" onPress={startOver} />
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

  /** The customer pays by Zaad instead: the float is held, and the Zaad screen takes over (D19). */
  const takeZaad = async () => {
    if (isProcessing.current || !target || !preview) return;
    isProcessing.current = true;
    setZaadError('');
    try {
      const started = await startZaadInPerson({ ...target, expectedAmount: preview.amount });
      triggerHaptic('medium');
      navigation.replace('ZaadTopups', { requestId: started.requestId });
    } catch (e: any) {
      const reason = e?.details?.reason;
      setZaadError(
        reason === 'insufficient_float'
          ? t('zaadTopups.errors.lowFloat', { float: formatAmount(e.details.floatCents ?? 0, 'USD') })
          : reason === 'zaad_not_set_up'
            ? t('zaadTopups.notSetUp')
            : reason === 'customer_cancelled'
              ? t('errors.topupCancelledByCustomer')
            : e?.message || t('qr.errors.generic'),
      );
    } finally {
      isProcessing.current = false;
    }
  };

  // ── Review: who and how much, before the cash ──
  if (step === 'review' && preview) {
    const zaadReady = !!zaad?.open && !!zaad.enabled && !zaad.pausedUntil;
    const dollars = (preview.currency ?? 'USD') === 'USD';
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <Text style={styles.reviewLabel}>{t('topup.confirm.reviewLabel')}</Text>
        <Text style={[styles.reviewAmount, longAmount(formatAmount(preview.amount, preview.currency))]} numberOfLines={1}>
          {formatAmount(preview.amount, preview.currency)}
        </Text>
        <Text style={styles.reviewName}>{preview.customerName}</Text>
        <GlassCard style={styles.reviewCard}>
          <Text style={styles.reviewHint}>
            {t('topup.confirm.reviewHint', { amount: formatAmount(preview.amount, preview.currency) })}
          </Text>
        </GlassCard>
        <View style={styles.resultBtn}>
          <PillButton
            label={t('topup.confirm.cashReceived', { amount: formatAmount(preview.amount, preview.currency) })}
            onPress={() => {
              setPin('');
              setPinError('');
              setStep('pin');
            }}
          />
          {zaadReady && dollars ? (
            <PillButton
              label={t('zaadTopups.inPerson.payByZaad', { amount: formatAmount(preview.amount, preview.currency) })}
              variant="glass"
              onPress={takeZaad}
              style={styles.secondBtn}
            />
          ) : null}
          {zaadReady && !dollars ? (
            <Text style={styles.zaadReason}>{t('zaadTopups.inPerson.dollarsOnly')}</Text>
          ) : null}
          {zaadError ? <Text style={styles.zaadError}>{zaadError}</Text> : null}
          <PillButton
            label={t('common.cancel')}
            variant="glass"
            onPress={startOver}
            style={styles.secondBtn}
          />
        </View>
      </DarkScreen>
    );
  }

  // ── PIN ──
  if (step === 'pin' && preview) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <Text style={styles.resultTitle}>{t('topup.confirm.pinTitle')}</Text>
        <Text style={styles.resultSub}>
          {t('topup.confirm.pinFor', { amount: formatAmount(preview.amount, preview.currency), name: preview.customerName })}
        </Text>
        <PinInput
          autoFocus
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError('');
          }}
          onComplete={confirm}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        <View style={styles.resultBtn}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={startOver} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'processing' || step === 'checking') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.processingText}>
          {t(step === 'checking' ? 'topup.confirm.checking' : 'topup.confirm.processing')}
        </Text>
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
        scanning={!typing && step === 'capture'}
        error={scanError}
        onDismissError={() => setScanError(null)}
      >
        <ScannerButton label={t('topup.confirm.enterCode')} onPress={() => setTyping(true)} />
        {/* Cash in without a code: find the customer by phone instead. */}
        <ScannerButton link label={t('topup.confirm.byPhone')} onPress={() => navigation.replace('TopupCustomer')} />
      </QrScannerView>
      <CodeSheet
        visible={typing}
        title={t(needPhoneFor ? 'topup.confirm.oldQrPhone' : 'topup.confirm.phoneAndCode')}
        also={{
          value: manualPhone,
          onChangeText: (v) => {
            setManualPhone(v.replace(/[^\d+ ]/g, '').slice(0, 20));
            setScanError(null);
          },
          placeholder: '063 412 0987',
          keyboardType: 'phone-pad',
          maxLength: 20,
        }}
        value={manualCode}
        onChangeText={(v) => {
          setManualCode(v.replace(/\D/g, '').slice(0, 6));
          setScanError(null);
        }}
        placeholder="000000"
        submitLabel={t('topup.confirm.check')}
        onSubmit={submitManual}
        onClose={() => {
          setTyping(false);
          setNeedPhoneFor(null);
        }}
        submitDisabled={!manualValid}
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
  reviewLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  reviewAmount: { fontSize: 52, fontWeight: '800', color: '#FFFFFF', letterSpacing: -2, marginTop: 8 },
  reviewName: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginTop: 4, textAlign: 'center' },
  reviewCard: { marginTop: 24, padding: 16, width: '100%' },
  reviewHint: { fontSize: 15, lineHeight: 21, color: TEXT_DIM, textAlign: 'center' },
  confCard: { marginTop: 20, padding: 16, alignItems: 'center', width: '100%' },
  confLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  confValue: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 4, letterSpacing: 1 },
  commissionCard: { marginTop: 14, padding: 16, alignItems: 'center', width: '100%' },
  commissionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  commissionValue: { fontSize: 26, fontWeight: '800', color: '#34C77B', marginTop: 4 },
  resultBtn: { alignSelf: 'stretch', marginTop: 28 },
  secondBtn: { marginTop: 12 },
  pinInput: { marginTop: 28 },
  zaadReason: { fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 12 },
  zaadError: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 12 },
  pinError: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  processingText: { fontSize: 16, color: TEXT_DIM, marginTop: 20 },
});
