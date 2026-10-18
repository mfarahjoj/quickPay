import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { DarkScreen, ScreenHeader, PillButton, TEXT_DIM } from '../DarkScreen';
import { PinInput as PinBoxes } from '../PinInput';
import { CodeInput, isWeakPin } from '../auth/CodeInput';
import { getCurrentUser, resetPin, sendOTP, verifyOTP } from '../../services/auth.service';
import { logger } from '../../utils/logger';

/**
 * otp → newPin → confirm, then:
 * - `id` when the server wants the last 4 of the ID ops checked when they
 *   approved this account (review O5);
 * - `support` when the reset can't happen in the app at all.
 */
type Step = 'otp' | 'newPin' | 'confirm' | 'id' | 'support';

interface Props {
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Forgot PIN (review A3): a fresh SMS code, a new PIN, and where the server
 * asks for it, the last 4 of the merchant's ID. Same backend as the customer
 * app (resetPin), so the same limits apply: at most one reset a day, other
 * sessions ended, and a pause on sending money afterwards.
 *
 * Rendered from Settings and from the app lock, which sits outside the
 * navigator, so it takes callbacks rather than navigation.
 */
export function ResetPinFlow({ onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('otp');
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [sending, setSending] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [idLast4, setIdLast4] = useState('');
  const [idError, setIdError] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const confirmationRef = useRef<FirebaseAuthTypes.ConfirmationResult | null>(null);
  const phoneNumber = getCurrentUser()?.phoneNumber ?? '';

  const sendCode = useCallback(async () => {
    try {
      setSending(true);
      setOtpError('');
      confirmationRef.current = await sendOTP(phoneNumber);
    } catch (err) {
      logger.error('Reset PIN OTP send error:', err);
      setOtpError(t('security.reset.sendFailed'));
    } finally {
      setSending(false);
    }
  }, [phoneNumber, t]);

  useEffect(() => {
    sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOtp = async (code: string) => {
    if (verifying || !confirmationRef.current) return;
    try {
      setVerifying(true);
      setOtpError('');
      await verifyOTP(confirmationRef.current, code);
      setStep('newPin');
    } catch {
      setOtpError(t('security.reset.codeWrong'));
      setOtpCode('');
    } finally {
      setVerifying(false);
    }
  };

  const handleNewPin = (val: string) => {
    if (isWeakPin(val)) {
      setPinError(t('auth.setupPin.weakPin'));
      setNewPin('');
      return;
    }
    setPinError('');
    setStep('confirm');
  };

  const submit = async (idAnswer?: string) => {
    if (submitting) return;
    try {
      setSubmitting(true);
      const result = await resetPin(newPin, idAnswer);
      const until = new Date(result.cooldownUntil).toLocaleString([], {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      Alert.alert(t('security.reset.doneTitle'), t('security.reset.doneMessage', { time: until }), [
        { text: t('common.ok'), onPress: onDone },
      ]);
    } catch (err: any) {
      logger.error('Reset PIN error:', err);
      switch (err?.details?.reason) {
        case 'reset_needs_id':
          setIdError('');
          setStep('id');
          break;
        case 'reset_id_wrong':
          setIdError(t('security.reset.idWrong', { count: err.details.attemptsLeft }));
          setIdLast4('');
          setStep('id');
          break;
        case 'reset_id_locked':
          setSupportMessage(t('security.reset.idLocked'));
          setStep('support');
          break;
        case 'reset_needs_agent':
          setSupportMessage(t('security.reset.needsSupport'));
          setStep('support');
          break;
        case 'reset_limit':
          setSupportMessage(t('security.reset.limit'));
          setStep('support');
          break;
        case 'weak_pin':
          setPinError(t('auth.setupPin.weakPin'));
          setNewPin('');
          setConfirmPin('');
          setStep('newPin');
          break;
        default:
          if (/phone verification/i.test(err?.message ?? '')) {
            // The SMS check is only good for a few minutes; ask for a new code.
            setOtpCode('');
            setOtpError(t('security.reset.verifyAgain'));
            setStep('otp');
            sendCode();
          } else {
            setPinError(t('security.reset.failed'));
            setConfirmPin('');
            setStep('confirm');
          }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = (val: string) => {
    if (val !== newPin) {
      setPinError(t('security.pinMismatch'));
      setConfirmPin('');
      return;
    }
    setPinError('');
    submit();
  };

  if (step === 'support') {
    return (
      <DarkScreen contentStyle={styles.centered}>
        <Text style={styles.title}>{t('security.reset.supportTitle')}</Text>
        <Text style={styles.sub}>{supportMessage}</Text>
        <View style={styles.block}>
          <PillButton label={t('common.back')} variant="glass" onPress={onCancel} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'id') {
    const ready = idLast4.length === 4 && !submitting;
    return (
      <DarkScreen keyboard>
        <ScreenHeader title={t('security.reset.title')} onBack={onCancel} />
        <View style={styles.body}>
          <Text style={styles.title}>{t('security.reset.idTitle')}</Text>
          <Text style={styles.sub}>{t('security.reset.idSubtitle')}</Text>
          <TextInput
            style={styles.idInput}
            value={idLast4}
            onChangeText={(v) => {
              setIdLast4(v.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase());
              if (idError) setIdError('');
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={4}
            placeholder="····"
            placeholderTextColor="rgba(255,255,255,0.25)"
            accessibilityLabel={t('security.reset.idTitle')}
          />
          {idError ? <Text style={styles.error}>{idError}</Text> : null}
          <PillButton
            style={styles.block}
            label={t('common.continue')}
            loading={submitting}
            disabled={!ready}
            onPress={() => submit(idLast4)}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'otp') {
    return (
      <DarkScreen keyboard>
        <ScreenHeader title={t('security.reset.title')} onBack={onCancel} />
        <View style={styles.body}>
          <Text style={styles.title}>{t('security.reset.otpTitle')}</Text>
          <Text style={styles.sub}>{t('security.reset.otpSubtitle', { phone: phoneNumber })}</Text>
          {sending ? (
            <ActivityIndicator color="#FFFFFF" style={styles.block} />
          ) : (
            <>
              <View style={styles.block}>
                <CodeInput
                  value={otpCode}
                  onChange={(v) => {
                    setOtpCode(v);
                    if (otpError) setOtpError('');
                  }}
                  onComplete={handleOtp}
                  error={otpError}
                  otpMode
                />
              </View>
              <PillButton
                style={styles.block}
                variant="glass"
                label={t('security.reset.resend')}
                disabled={verifying}
                onPress={sendCode}
              />
            </>
          )}
        </View>
      </DarkScreen>
    );
  }

  const confirming = step === 'confirm';
  return (
    <DarkScreen keyboard>
      <ScreenHeader
        title={t('security.reset.title')}
        onBack={() => {
          if (confirming) {
            setConfirmPin('');
            setPinError('');
            setStep('newPin');
          } else {
            onCancel();
          }
        }}
      />
      <View style={[styles.body, styles.center]}>
        <Text style={styles.title}>{t(confirming ? 'security.confirmPinTitle' : 'security.newPinTitle')}</Text>
        <Text style={styles.sub}>{t(confirming ? 'security.confirmPinSubtitle' : 'security.newPinSubtitle')}</Text>
        <PinBoxes
          key={step}
          value={confirming ? confirmPin : newPin}
          onChange={(v) => {
            (confirming ? setConfirmPin : setNewPin)(v);
            if (pinError) setPinError('');
          }}
          onComplete={confirming ? handleConfirm : handleNewPin}
          style={styles.pin}
        />
        {pinError ? <Text style={styles.error}>{pinError}</Text> : null}
        {submitting ? <ActivityIndicator color="#FFFFFF" style={styles.block} /> : null}
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  center: { alignItems: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 20,
  },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6, lineHeight: 21 },
  pin: { marginTop: 28 },
  error: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  idInput: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 12,
    marginTop: 28,
    marginHorizontal: 24,
  },
});
