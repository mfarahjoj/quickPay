import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
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
import { colors, typography, spacing } from '../../theme';

interface Props {
  /** Called with the new PIN after it has been reset and verified. */
  onDone: (newPin: string) => void;
  onCancel: () => void;
}

type Step = 'otp' | 'newPin' | 'confirm';

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

  const handleConfirmComplete = async (val: string) => {
    if (val !== newPin) {
      setConfirmError(t('auth.resetPin.mismatch'));
      setConfirmPin('');
      return;
    }
    try {
      setSubmitting(true);
      setConfirmError('');
      await resetPin(newPin);
      // Keep Face ID payments working with the new PIN if biometrics are on.
      if (await isBiometricEnabled()) {
        await storePinInKeychain(newPin).catch((err) =>
          logger.warn('Keychain update after PIN reset failed:', err)
        );
      }
      await markPinVerifiedThisInstall();
      onDone(newPin);
    } catch (err: any) {
      logger.error('Reset PIN error:', err);
      setConfirmError(err.message ?? t('auth.resetPin.failed'));
      setConfirmPin('');
    } finally {
      setSubmitting(false);
    }
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
});
