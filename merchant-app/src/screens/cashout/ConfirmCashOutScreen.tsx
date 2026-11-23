import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  } from 'react-native';
import { triggerHaptic } from '../../services/haptics.service';
import { CameraLayer, CAMERA_NATIVE_AVAILABLE } from '../../components/QrCameraLayer';
import { functions } from '../../services/firebase.config';
import { DarkScreen, GlassCard, PillButton, PinInput } from '../../components';
import { SuccessCheckIcon, CloseIcon, ScanIcon } from '../../components/icons/AuthIcons';
import { formatAmount, READS_CURRENCIES } from '../../utils/money';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { useExitGuard } from '../../hooks/useExitGuard';
import { makeStyles, useColors } from '../../theme';

type Step = 'enter' | 'checking' | 'review' | 'pin' | 'processing' | 'success' | 'error';

interface Props {
  navigation: any;
}

/** Which request the agent is paying out. The server refuses a bare code. */
type Target =
  | { otpCode: string; cashOutId: string }
  | { otpCode: string; customerPhone: string };

// The customer's QR: {type:'zapp_cashout', id, code}.
function parseCashOutQr(value: string): { cashOutId: string; otpCode: string } | null {
  try {
    const obj = JSON.parse(value.trim());
    if (
      obj && obj.type === 'zapp_cashout' &&
      typeof obj.id === 'string' && /^[A-Za-z0-9]{1,64}$/.test(obj.id) &&
      /^\d{6}$/.test(String(obj.code))
    ) {
      return { cashOutId: obj.id, otpCode: String(obj.code) };
    }
  } catch {
    // not JSON
  }
  return null;
}

// Loose client check; the server normalises and decides.
const phoneLooksValid = (v: string) => v.replace(/\D/g, '').length >= 7;

/**
 * A smaller size for a long amount ("400,000 SLSH"), so the cash to hand over
 * never gets cut off. Shrink-to-fit isn't used: it can draw text as a dot.
 */
function longAmount(text: string) {
  if (text.length > 12) return { fontSize: 30, letterSpacing: -1 };
  if (text.length > 9) return { fontSize: 36, letterSpacing: -1 };
  return null;
}

export default function ConfirmCashOutScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('enter');
  const [otp, setOtp] = useState('');
  const [phone, setPhone] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(
    CAMERA_NATIVE_AVAILABLE ? null : false,
  );
  const [scanError, setScanError] = useState<string | null>(null);
  // Confirming pays the customer cash and moves their held balance into this
  // agent's float, so the agent authorises it with their PIN.
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<{
    amount: number;
    /** Absent from servers before shillings: dollars. */
    currency?: string;
    customerName: string;
    commission: number;
  } | null>(null);
  // What previewAgentCashOut said: the cash to count out and who for, shown
  // before the PIN and sent back with it so nothing else can be paid.
  const [preview, setPreview] = useState<{ amount: number; currency: string; customerName: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [pinError, setPinError] = useState('');

  const cancelPin = () => {
    setPin('');
    setPinError('');
    setPreview(null);
    setStep('enter');
  };

  // Confirming moves the customer's held money into the agent's float: while
  // that runs nothing leaves, and back from the PIN step returns to the code.
  useExitGuard(navigation, {
    blocked: step === 'processing' || step === 'checking',
    onExit: step === 'pin' || step === 'review' ? cancelPin : undefined,
  });

  // Check the code first and show the agent what they are paying out. The
  // agent used to see the amount only after the money had moved.
  const checkTarget = useCallback(async (next: Target) => {
    setTarget(next);
    setPin('');
    setPinError('');
    setStep('checking');
    try {
      const fn = functions().httpsCallable('previewAgentCashOut');
      const res = await fn({ ...next, currencies: READS_CURRENCIES });
      setPreview((res.data as any).data);
      setStep('review');
    } catch (e: any) {
      setErrorMsg(t(pinActionErrorKey(e)));
      setStep('error');
    }
  }, [t]);

  const handleScan = useCallback(
    (value: string) => {
      const scanned = parseCashOutQr(value);
      if (!scanned) {
        setScanError(t('cashout.confirm.notCashOutQr'));
        return;
      }
      triggerHaptic('medium');
      checkTarget(scanned);
    },
    [checkTarget, t],
  );

  const handleConfirm = () => {
    if (otp.length !== 6) {
      Alert.alert(t('cashout.confirm.invalidCodeTitle'), t('agent.enterCustomerCode'));
      return;
    }
    if (!phoneLooksValid(phone)) {
      Alert.alert(t('cashout.confirm.phoneRequiredTitle'), t('cashout.confirm.phoneRequired'));
      return;
    }
    checkTarget({ otpCode: otp, customerPhone: phone.trim() });
  };

  const submit = async (agentPin: string) => {
    if (!target || !preview) return;
    setStep('processing');
    try {
      const fn = functions().httpsCallable('agentConfirmCashOut');
      const res = await fn({
        ...target,
        agentPin,
        currencies: READS_CURRENCIES,
        expectedAmount: preview.amount,
        expectedCurrency: preview.currency,
      });
      const data = (res.data as any).data;
      setResult(data);
      setStep('success');
    } catch (e: any) {
      // The PIN is checked before the code is looked up, so a wrong PIN costs
      // no code guess: keep the code and ask for the PIN again.
      if (isWrongPin(e)) {
        setPinError(t('errors.wrongPin'));
        setStep('pin');
      } else {
        setErrorMsg(t(pinActionErrorKey(e)));
        setStep('error');
      }
    } finally {
      setPin('');
    }
  };

  if (step === 'success' && result) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.resultTitle}>{t('cashout.confirm.successTitle')}</Text>
        {/* The cash to hand over: shillings must read as shillings. */}
        <Text style={[styles.resultAmount, longAmount(formatAmount(result.amount, result.currency))]} numberOfLines={1}>
          {formatAmount(result.amount, result.currency)}
        </Text>
        <Text style={styles.resultSub}>
          {t('cashout.confirm.paidTo', { name: result.customerName })}
        </Text>
        {result.commission > 0 && (
          <GlassCard style={styles.commissionCard}>
            <Text style={styles.commissionLabel}>{t('agent.yourCommission')}</Text>
            <Text style={styles.commissionValue}>+{formatAmount(result.commission, result.currency)}</Text>
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
          <CloseIcon size={32} color={colors.ui.error} />
        </View>
        <Text style={styles.resultTitle}>{t('agent.couldNotConfirm')}</Text>
        <Text style={styles.resultSub}>{errorMsg}</Text>
        <View style={styles.resultBtn}>
          <PillButton
            label={t('common.tryAgain')}
            variant="glass"
            onPress={() => { setStep('enter'); setOtp(''); setTarget(null); setScanError(null); setErrorMsg(''); }}
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

  if (step === 'processing' || step === 'checking') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <ActivityIndicator size="large" color={colors.ui.accent} />
        <Text style={styles.processingText}>
          {t(step === 'checking' ? 'topup.confirm.checking' : 'cashout.confirm.processing')}
        </Text>
      </DarkScreen>
    );
  }

  // ── Review: how much cash, and for whom, before the PIN ──
  if (step === 'review' && preview) {
    const amountText = formatAmount(preview.amount, preview.currency);
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <Text style={styles.reviewLabel}>{t('cashout.confirm.reviewLabel')}</Text>
        <Text style={[styles.reviewAmount, longAmount(amountText)]} numberOfLines={1}>
          {amountText}
        </Text>
        <Text style={styles.reviewName}>{preview.customerName}</Text>
        <GlassCard style={styles.reviewCard}>
          <Text style={styles.reviewHint}>
            {t('cashout.confirm.reviewHint', { amount: amountText, name: preview.customerName })}
          </Text>
        </GlassCard>
        <View style={styles.resultBtn}>
          <PillButton
            label={t('cashout.confirm.countedOut', { amount: amountText })}
            onPress={() => {
              setPin('');
              setPinError('');
              setStep('pin');
            }}
          />
          <PillButton label={t('common.cancel')} variant="glass" onPress={cancelPin} style={styles.secondBtn} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <Text style={styles.resultTitle}>{t('cashout.confirm.pinTitle')}</Text>
        <Text style={styles.resultSub}>
          {preview
            ? t('cashout.confirm.pinFor', { amount: formatAmount(preview.amount, preview.currency), name: preview.customerName })
            : t('cashout.confirm.pinSubtitle')}
        </Text>
        <PinInput
          autoFocus
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError('');
          }}
          onComplete={submit}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        <View style={styles.resultBtn}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={cancelPin} />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard contentStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>{t('cashout.confirm.title')}</Text>
          <Text style={styles.subtitle}>{t('agent.enterCustomerCode')}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.scanBox}>
          {CAMERA_NATIVE_AVAILABLE && (
            <CameraLayer
              isActive={hasPermission === true && step === 'enter'}
              onScan={handleScan}
              onPermission={setHasPermission}
            />
          )}
          {hasPermission !== true && (
            <View style={styles.scanPlaceholder}>
              {hasPermission === null ? (
                <ActivityIndicator color={colors.ui.text} />
              ) : (
                <ScanIcon size={40} color={colors.ui.textFaint} />
              )}
            </View>
          )}
        </View>
        <Text style={[styles.scanHint, scanError ? styles.scanHintError : null]}>
          {scanError || t('cashout.confirm.scanHint')}
        </Text>

        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>{t('cashout.confirm.orManual')}</Text>
          <View style={styles.orLine} />
        </View>

        <Text style={styles.label}>{t('cashout.confirm.phoneLabel')}</Text>
        <GlassCard style={styles.phoneCard}>
          <TextInput
            style={styles.phoneInput}
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^\d+ ]/g, '').slice(0, 20))}
            keyboardType="phone-pad"
            placeholder="063 412 0987"
            placeholderTextColor={colors.ui.ink(0.2)}
          />
        </GlassCard>

        <Text style={styles.label}>{t('cashout.confirm.codeLabel')}</Text>
        <GlassCard style={styles.otpCard}>
          <TextInput
            style={styles.otpInput}
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="— — — — — —"
            placeholderTextColor={colors.ui.ink(0.2)}
          />
        </GlassCard>

        <GlassCard style={styles.infoCard}>
          <Text style={styles.infoTitle}>{t('cashout.confirm.howTitle')}</Text>
          <Text style={styles.infoStep}>{t('cashout.confirm.how1')}</Text>
          <Text style={styles.infoStep}>{t('cashout.confirm.how2')}</Text>
          <Text style={styles.infoStep}>{t('cashout.confirm.how3')}</Text>
          <Text style={styles.infoStep}>{t('cashout.confirm.how4')}</Text>
        </GlassCard>
      </View>

      <View style={styles.footer}>
        <PillButton
          label={t('cashout.confirm.submit')}
          onPress={handleConfirm}
          disabled={otp.length !== 6 || !phoneLooksValid(phone)}
        />
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  // flexGrow, not flex: flex pinned the scroll content to the screen, so the
  // footer button sat on top of the how-to card and it couldn't scroll clear.
  content: { flexGrow: 1, paddingTop: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.ui.glass,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  backArrow: { fontSize: 24, color: colors.ui.text, lineHeight: 28 },
  title: { fontSize: 22, fontWeight: '800', color: colors.ui.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.ui.textDim, marginTop: 3 },
  body: { flex: 1, paddingHorizontal: 24, gap: 16 },
  label: {
    fontSize: 12, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', color: colors.ui.textFaint,
  },
  otpCard: {
    height: 72, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  otpInput: {
    fontSize: 34, fontWeight: '800', color: colors.ui.accent,
    letterSpacing: 8, textAlign: 'center', width: '100%',
  },
  scanBox: {
    height: 220, borderRadius: 20, overflow: 'hidden',
    backgroundColor: colors.ui.ink(0.04),
    borderWidth: 1, borderColor: colors.ui.divider,
  },
  scanPlaceholder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  scanHint: { fontSize: 13, color: colors.ui.textDim, textAlign: 'center', marginTop: -6 },
  scanHintError: { color: colors.ui.error },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.ink(0.15) },
  orText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.ui.ink(0.35) },
  phoneCard: { height: 56, justifyContent: 'center', paddingHorizontal: 20 },
  phoneInput: { fontSize: 20, fontWeight: '700', color: colors.ui.text, width: '100%' },
  infoCard: { padding: 18, gap: 8 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: colors.ui.textDim, marginBottom: 4 },
  infoStep: { fontSize: 13, color: colors.ui.textFaint, lineHeight: 20 },
  footer: { paddingHorizontal: 24, paddingBottom: 36 },

  // Result states
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  failIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.ui.errorSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  resultTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, letterSpacing: -0.5, textAlign: 'center', marginTop: 20 },
  resultAmount: { fontSize: 44, fontWeight: '800', color: colors.ui.incoming, letterSpacing: -2, marginTop: 8 },
  resultSub: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', marginTop: 6 },
  commissionCard: { marginTop: 20, padding: 18, alignItems: 'center', width: '100%' },
  commissionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ui.textFaint },
  commissionValue: { fontSize: 28, fontWeight: '800', color: colors.ui.incoming, marginTop: 4 },
  resultBtn: { alignSelf: 'stretch', marginTop: 28 },
  secondBtn: { marginTop: 12 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: colors.ui.error, textAlign: 'center', marginTop: 16 },
  processingText: { fontSize: 16, color: colors.ui.textDim, marginTop: 20 },
  // Review: as ConfirmTopupScreen's, so both agent flows read the same.
  reviewLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ui.textFaint },
  reviewAmount: { fontSize: 52, fontWeight: '800', color: colors.ui.text, letterSpacing: -2, marginTop: 8 },
  reviewName: { fontSize: 20, fontWeight: '700', color: colors.ui.text, marginTop: 4, textAlign: 'center' },
  reviewCard: { marginTop: 24, padding: 16, width: '100%' },
  reviewHint: { fontSize: 15, lineHeight: 21, color: colors.ui.textDim, textAlign: 'center' },
}));
