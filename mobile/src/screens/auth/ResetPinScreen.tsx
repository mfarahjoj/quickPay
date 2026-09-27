import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { AuthLayout, AuthHeader, CodeInput } from '../../components/auth';
import { isWeakPin } from '../../components/auth/CodeInput';
import { PinKeypad } from '../../components/PinKeypad';
import {
  sendOTP,
  verifyOTP,
  resetPin,
  getCurrentUser,
} from '../../services/auth.service';
import {
  isBiometricEnabled,
  storePinInKeychain,
} from '../../services/biometric.service';
import { markPinVerifiedThisInstall } from '../../hooks/usePinVerifiedThisInstall';
import { logger } from '../../utils/logger';
import { formatUntil } from '../../utils/cooldownMessage';
import { colors, typography, spacing } from '../../theme';

interface Props {
  /** Called with the new PIN after it has been reset and verified. */
  onDone: (newPin: string) => void;
  onCancel: () => void;
}

/**
 * otp → newPin → confirm, then:
 * - `id` when this phone isn't one the account has used for a week, and the
 *   server wants the last characters of the customer's verified ID;
 * - `agent` when the reset can't happen in the app at all.
 */
type Step = 'otp' | 'newPin' | 'confirm' | 'id' | 'agent';

/**
 * Forgot-PIN flow: re-verify the phone number via OTP (refreshes auth_time,
 * which the resetPin callable requires), then choose and confirm a new PIN.
 * Rendered inline by gate screens (WelcomeBack, AppLock, BiometricSetup)
 * because those live outside the NavigationContainer.
 */
export default function ResetPinScreen({ onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('otp');
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [sending, setSending] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [newPinError, setNewPinError] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idLast4, setIdLast4] = useState('');
  const [idError, setIdError] = useState('');
  const [agentMessage, setAgentMessage] = useState('');

  const confirmationRef = useRef<FirebaseAuthTypes.ConfirmationResult | null>(null);
  const phoneNumber = getCurrentUser()?.phoneNumber ?? '';

  const sendCode = useCallback(async () => {
    try {
      setSending(true);
      setOtpError('');
      confirmationRef.current = await sendOTP(phoneNumber);
    } catch (err) {
      logger.error('Reset PIN OTP send error:', err);
      setOtpError(t('auth.resetPin.sendFailed'));
    } finally {
      setSending(false);
    }
  }, [phoneNumber, t]);

  useEffect(() => {
    sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOtpComplete = async (code: string) => {
    if (verifying || !confirmationRef.current) return;
    try {
      setVerifying(true);
      setOtpError('');
      await verifyOTP(confirmationRef.current, code);
      setStep('newPin');
    } catch {
      setOtpError(t('auth.otp.inlineError'));
      setOtpCode('');
    } finally {
      setVerifying(false);
    }
  };

  const handleNewPinComplete = (val: string) => {
    if (isWeakPin(val)) {
      setNewPinError(t('auth.setupPin.weakPin'));
      setNewPin('');
      return;
    }
    setStep('confirm');
  };

  const submitReset = async (pinValue: string, idAnswer?: string) => {
    try {
      setSubmitting(true);
      setConfirmError('');
      const result = await resetPin(pinValue, idAnswer);
      // Keep Face ID payments working with the new PIN if biometrics are on.
      if (await isBiometricEnabled()) {
        await storePinInKeychain(pinValue).catch((err) =>
          logger.warn('Keychain update after PIN reset failed:', err)
        );
      }
      await markPinVerifiedThisInstall();
      // Say why sending money will be refused for a while, before it is.
      Alert.alert(
        t('auth.resetPin.doneTitle'),
        t('auth.resetPin.cooldownMessage', {
          time: formatUntil(result.cooldownUntil),
          amount: `$${(result.allowanceCents / 100).toFixed(2)}`,
        }),
        [{ text: t('common.ok'), onPress: () => onDone(pinValue) }],
      );
    } catch (err: any) {
      logger.error('Reset PIN error:', err);
      const message: string = typeof err?.message === 'string' ? err.message : '';
      switch (err?.details?.reason) {
        case 'reset_needs_id':
          setIdError('');
          setStep('id');
          break;
        case 'reset_id_wrong':
          setIdError(t('auth.resetPin.idWrong', { count: err.details.attemptsLeft }));
          setIdLast4('');
          setStep('id');
          break;
        case 'reset_id_locked':
          setAgentMessage(t('auth.resetPin.lockedMessage'));
          setStep('agent');
          break;
        case 'reset_needs_agent':
          setAgentMessage(t('auth.resetPin.agentMessage'));
          setStep('agent');
          break;
        case 'reset_limit':
          setAgentMessage(t('auth.resetPin.limitMessage'));
          setStep('agent');
          break;
        default:
          if (/phone verification/i.test(message)) {
            // The SMS check is only good for a few minutes; ask for a new code.
            setOtpCode('');
            setOtpError(t('auth.resetPin.verifyAgain'));
            setStep('otp');
            sendCode();
          } else {
            setConfirmError(t('auth.resetPin.failed'));
            setConfirmPin('');
            setStep('confirm');
          }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmComplete = async (val: string) => {
    if (val !== newPin) {
      setConfirmError(t('auth.resetPin.mismatch'));
      setConfirmPin('');
      return;
    }
    await submitReset(newPin);
  };

  const handleBack = () => {
    if (step === 'confirm') {
      setConfirmPin('');
      setConfirmError('');
      setStep('newPin');
    } else {
      onCancel();
    }
  };

  if (step === 'agent') {
    return (
      <AuthLayout onBack={onCancel} contentStyle={styles.centered}>
        <AuthHeader title={t('auth.resetPin.agentTitle')} subtitle={agentMessage} />
        <TouchableOpacity style={styles.primaryBtn} onPress={onCancel}>
          <Text style={styles.primaryBtnText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </AuthLayout>
    );
  }

  if (step === 'id') {
    const ready = idLast4.length === 4 && !submitting;
    return (
      <AuthLayout onBack={onCancel} contentStyle={styles.centered}>
        <AuthHeader title={t('auth.resetPin.idTitle')} subtitle={t('auth.resetPin.idSubtitle')} />
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
          placeholderTextColor={colors.dark.textDim}
          accessibilityLabel={t('auth.resetPin.idTitle')}
        />
        {idError ? <Text style={styles.idError}>{idError}</Text> : null}
        <TouchableOpacity
          style={[styles.primaryBtn, !ready && styles.primaryBtnDisabled]}
          disabled={!ready}
          onPress={() => submitReset(newPin, idLast4)}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>{t('common.continue')}</Text>
          )}
        </TouchableOpacity>
      </AuthLayout>
    );
  }

  if (step === 'otp') {
    return (
      <AuthLayout onBack={onCancel} contentStyle={styles.centered}>
        <AuthHeader
          title={t('auth.resetPin.otpTitle')}
          subtitle={t('auth.resetPin.otpSubtitle', { phone: phoneNumber })}
        />
        {sending ? (
          <ActivityIndicator size="large" color={colors.dark.accent} style={styles.spinner} />
        ) : (
          <>
            <CodeInput
              value={otpCode}
              onChange={(value) => {
                setOtpCode(value);
                if (otpError) setOtpError('');
              }}
              onComplete={handleOtpComplete}
              error={otpError}
              otpMode
            />
            <TouchableOpacity onPress={sendCode} style={styles.resendBtn} disabled={verifying}>
              <Text style={styles.resendText}>{t('auth.otp.resendCode')}</Text>
            </TouchableOpacity>
          </>
        )}
      </AuthLayout>
    );
  }

  return (
    <SafeAreaView style={styles.fullScreen}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} accessibilityLabel={t('common.back')}>
        <Text style={styles.backIcon}>‹</Text>
      </TouchableOpacity>

      {step === 'newPin' ? (
        <PinKeypad
          value={newPin}
          onChange={(val) => {
            setNewPin(val);
            if (newPinError) setNewPinError('');
          }}
          onComplete={handleNewPinComplete}
          title={t('auth.resetPin.newPinTitle')}
          subtitle={t('auth.resetPin.newPinSubtitle')}
          error={newPinError}
        />
      ) : (
        <View style={styles.confirmWrap}>
          <PinKeypad
            value={confirmPin}
            onChange={(val) => {
              setConfirmPin(val);
              if (confirmError) setConfirmError('');
            }}
            onComplete={submitting ? undefined : handleConfirmComplete}
            title={t('auth.resetPin.confirmTitle')}
            subtitle={t('auth.resetPin.confirmSubtitle')}
            error={confirmError}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  centered: {
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.lg,
    zIndex: 10,
    padding: spacing.sm,
  },
  backIcon: {
    fontSize: 32,
    color: colors.dark.text,
    lineHeight: 36,
  },
  spinner: {
    marginTop: spacing.xl,
  },
  resendBtn: {
    marginTop: spacing.lg,
    alignSelf: 'center',
    padding: spacing.sm,
  },
  resendText: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },
  confirmWrap: {
    flex: 1,
  },
  idInput: {
    ...typography.h3,
    color: colors.dark.text,
    textAlign: 'center',
    letterSpacing: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.divider,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
    marginHorizontal: spacing.xl,
  },
  idError: {
    ...typography.caption,
    color: colors.dark.error,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.dark.accent,
    borderRadius: 999,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    ...typography.bodySemibold,
    color: '#FFFFFF',
  },
});
