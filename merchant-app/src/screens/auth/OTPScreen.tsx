import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { verifyOTP, sendOTP } from '../../services/auth.service';
import { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { AuthLayout, CodeInput, useToast } from '../../components/auth';
import { Button } from '../../components/Button';
import { colors, typography, spacing } from '../../theme';

const RESEND_SECONDS = 60;

interface Props {
  navigation: any;
  route: {
    params: {
      phoneNumber: string;
      confirmation: FirebaseAuthTypes.ConfirmationResult;
    };
  };
}

export default function OTPScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { phoneNumber, confirmation } = route.params;
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState(confirmation);
  const [codeError, setCodeError] = useState('');
  const [countdown, setCountdown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleVerify = useCallback(
    async (verificationCode?: string) => {
      const otpCode = verificationCode ?? code;
      if (otpCode.length !== 6) {
        setCodeError(t('auth.otp.invalidCodeMessage'));
        return;
      }
      try {
        setLoading(true);
        setCodeError('');
        await verifyOTP(confirmationResult, otpCode);
      } catch {
        setCodeError(t('auth.otp.verificationFailedMessage'));
        setCode('');
      } finally {
        setLoading(false);
      }
    },
    [code, confirmationResult, t],
  );

  const handleResend = async () => {
    if (countdown > 0 || resending) return;
    try {
      setResending(true);
      const newConfirmation = await sendOTP(phoneNumber);
      setConfirmationResult(newConfirmation);
      setCode('');
      setCodeError('');
      setCountdown(RESEND_SECONDS);
      showToast(t('auth.otp.successMessage'), 'success');
    } catch (error: any) {
      showToast(error.message || t('common.error'), 'error');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout onBack={() => navigation.goBack()} scroll contentStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('auth.otp.title')}</Text>
        <Text style={styles.subtitle}>
          {t('auth.otp.subtitle')}{'\n'}
          <Text style={styles.phoneHighlight}>{phoneNumber}</Text>
        </Text>
      </View>

      {/* Code input */}
      <View style={styles.codeWrap}>
        <CodeInput
          value={code}
          onChange={(value) => {
            setCode(value);
            if (codeError) setCodeError('');
          }}
          onComplete={handleVerify}
          otpMode
          error={codeError}
        />
      </View>

      {/* Verify CTA */}
      <Button
        title={t('auth.otp.verifyContinue')}
        onPress={() => handleVerify()}
        variant="primary"
        fullWidth
        loading={loading}
        disabled={code.length !== 6}
        style={styles.button}
      />

      {/* Resend row */}
      <View style={styles.resendRow}>
        <Text style={styles.resendText}>{t('auth.otp.resendPrompt')} </Text>
        {countdown > 0 ? (
          <Text style={styles.countdown}>
            {t('auth.otp.resendCode')} ({countdown}s)
          </Text>
        ) : (
          <TouchableOpacity onPress={handleResend} disabled={resending}>
            <Text style={styles.resendLink}>
              {resending ? t('auth.otp.resending') : t('auth.otp.resendCode')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
  },
  header: {
    marginBottom: 36,
  },
  title: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: '#000000',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 26,
    color: '#8E8E93',
  },
  phoneHighlight: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
  },
  codeWrap: {
    marginBottom: spacing.xl,
  },
  button: {
    marginBottom: spacing.lg,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  resendText: {
    fontSize: 15,
    color: '#8E8E93',
  },
  countdown: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8E8E93',
  },
  resendLink: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
});
