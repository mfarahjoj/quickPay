import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { verifyOTP, sendOTP } from '../../services/auth.service';
import { AuthLayout, AuthHeader, CodeInput, useToast } from '../../components/auth';
import { Button } from '../../components/Button';
import { colors, typography, spacing } from '../../theme';

interface Props {
  navigation: any;
  route: {
    params: {
      phoneNumber: string;
      confirmation: FirebaseAuthTypes.ConfirmationResult;
    };
  };
}

const RESEND_COOLDOWN = 60;

export default function OTPScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { phoneNumber, confirmation } = route.params;
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState(confirmation);
  const [inlineError, setInlineError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const handleVerify = async (verificationCode?: string) => {
    const otpCode = verificationCode ?? code;

    if (otpCode.length !== 6) return;

    try {
      setLoading(true);
      setInlineError('');
      await verifyOTP(confirmationResult, otpCode);
    } catch {
      setInlineError(t('auth.otp.inlineError'));
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (secondsLeft > 0 || resending) return;

    try {
      setResending(true);
      setInlineError('');
      const newConfirmation = await sendOTP(phoneNumber);
      setConfirmationResult(newConfirmation);
      setSecondsLeft(RESEND_COOLDOWN);
      showToast(t('auth.otp.newCodeSent'), 'success');
    } catch (error: any) {
      showToast(error.message ?? t('common.error'), 'error');
    } finally {
      setResending(false);
    }
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
    if (inlineError) setInlineError('');
  };

  return (
    <AuthLayout onBack={() => navigation.goBack()} contentStyle={styles.content}>
      <Text style={styles.stepChip}>STEP 2 OF 3</Text>
      <AuthHeader
        title={t('auth.otp.title')}
        subtitle={t('auth.otp.subtitle')}
        highlight={phoneNumber}
        centered={false}
      />

      <CodeInput
        value={code}
        onChange={handleCodeChange}
        onComplete={handleVerify}
        otpMode
        error={inlineError}
        autoFocus
      />

      {code.length === 6 && (
        <Button
          title={t('auth.otp.verifyContinue')}
          onPress={() => handleVerify()}
          variant="gradient"
          fullWidth
          loading={loading}
          style={styles.button}
        />
      )}

      <View style={styles.resendContainer}>
        <Text style={styles.resendText}>{t('auth.otp.didntReceive')} </Text>
        {secondsLeft > 0 ? (
          <Text style={styles.countdownText}>{t('auth.otp.resendIn', { seconds: secondsLeft })}</Text>
        ) : (
          <TouchableOpacity onPress={handleResend} disabled={resending} style={styles.resendButton}>
            <Text style={styles.resendLink}>
              {resending ? t('auth.otp.sending') : t('auth.otp.resendCode')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'center',
  },
  stepChip: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.dark.accent,
  },
  button: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  resendContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.xl,
  },
  resendText: {
    ...typography.body,
    color: colors.dark.textFaint,
  },
  countdownText: {
    ...typography.bodySemibold,
    color: colors.dark.textFaint,
  },
  resendButton: {
    padding: spacing.xs,
  },
  resendLink: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },
});
