import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { cooldownMessage } from '../../utils/cooldownMessage';
import { BiometryTypes } from 'react-native-biometrics';
import LinearGradient from 'react-native-linear-gradient';
import { processPayment } from '../../services/qr.service';
import {
  isBiometricEnabled,
  getPinFromKeychain,
  isBiometricAvailable,
} from '../../services/biometric.service';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { PinInput } from '../../components/PinInput';
import { Header } from '../../components/Header';

interface Props {
  navigation: any;
  route: {
    params: {
      qrCodeId: string;
      amount: number;
      currency: string;
      merchantId?: string;
      merchantName?: string;
      reference?: string;
    };
  };
}

function getBiometricLabelKey(biometryType?: string): string {
  if (biometryType === BiometryTypes.FaceID) return 'biometric.faceId';
  if (biometryType === BiometryTypes.TouchID) return 'biometric.touchId';
  return 'biometric.generic';
}

export default function PaymentConfirmScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { qrCodeId, amount, currency, merchantName, reference } = route.params;
  const [pin, setPin] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<string | undefined>();

  const biometricLabel = useMemo(
    () => t(getBiometricLabelKey(biometryType)),
    [biometryType, t],
  );

  useEffect(() => {
    Promise.all([isBiometricEnabled(), isBiometricAvailable()]).then(
      ([enabled, { available, biometryType: bt }]) => {
        setBiometricAvailable(enabled && available);
        setBiometryType(bt);
      }
    );
  }, []);

  const processWithPin = async (pinToUse: string) => {
    try {
      setProcessing(true);
      setError(null);
      const result = await processPayment(qrCodeId, pinToUse);

      navigation.replace('PaymentSuccess', {
        transactionId: result.transactionId,
        amount,
        currency,
        merchantId: result.merchantId,
      });
    } catch (err: any) {
      setError(cooldownMessage(err, t) ?? (err.message || t('qr.confirm.paymentFailed')));
      setPin('');
    } finally {
      setProcessing(false);
    }
  };

  // `submittedPin` comes from PinInput's onComplete — the `pin` state is still
  // one digit behind in that same event, so it must not be read there.
  const handleConfirm = async (submittedPin?: string) => {
    if (processing) return;
    const pinToUse = submittedPin ?? pin;
    if (pinToUse.length !== 6) {
      setError(t('qr.confirm.enterPinError'));
      return;
    }
    await processWithPin(pinToUse);
  };

  const handleBiometricPay = async () => {
    if (processing) return;
    const storedPin = await getPinFromKeychain(
      t('common.confirmPaymentAmount', { amount: `${CURRENCY_SYMBOL}${amount.toFixed(2)}` })
    );
    if (storedPin) {
      await processWithPin(storedPin);
    } else {
      setError(t('qr.confirm.biometricFailed'));
    }
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title={t('qr.confirm.title')} onBack={handleCancel} />

      <View style={styles.content}>
        <Text style={styles.merchantLabel}>{t('qr.confirm.payTo')}</Text>
        <Text style={styles.merchantName}>{merchantName || t('common.merchant')}</Text>

        <View style={styles.amountBox}>
          <Text style={styles.currencyLabel}>{currency}</Text>
          <Text style={styles.amount}>
            {CURRENCY_SYMBOL}
            {amount.toFixed(2)}
          </Text>
          {reference ? (
            <Text style={styles.referenceLabel}>{reference}</Text>
          ) : null}
        </View>

        {biometricAvailable && (
          <TouchableOpacity
            style={styles.biometricButton}
            onPress={handleBiometricPay}
            disabled={processing}
          >
            <Text style={styles.biometricButtonText}>
              {t('qr.confirm.payWithBiometric', { label: biometricLabel })}
            </Text>
          </TouchableOpacity>
        )}

        <Text style={styles.pinLabel}>
          {biometricAvailable ? t('qr.confirm.orEnterPin') : t('qr.confirm.enterPin')}
        </Text>
        <PinInput
          value={pin}
          onChange={setPin}
          onComplete={handleConfirm}
          secure={true}
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.confirmButton, processing && styles.buttonDisabled]}
          onPress={() => handleConfirm()}
          disabled={processing}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={[colors.success, colors.successDark]}
            style={styles.confirmGradient}
          >
            {processing ? (
              <ActivityIndicator color={colors.text.inverse} />
            ) : (
              <Text style={styles.confirmText}>{t('qr.confirm.confirmPayment')}</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  merchantLabel: {
    ...typography.caption,
    color: colors.dark.textFaint,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  merchantName: {
    ...typography.h2,
    color: colors.dark.text,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  amountBox: {
    backgroundColor: colors.dark.incomingSoft,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    padding: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  biometricButton: {
    backgroundColor: colors.dark.accentSoft,
    borderWidth: 1,
    borderColor: colors.dark.accentBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  biometricButtonText: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },
  currencyLabel: {
    ...typography.caption,
    color: colors.dark.incoming,
    marginBottom: spacing.xs,
  },
  amount: {
    ...typography.display,
    color: colors.dark.incoming,
    fontWeight: '700',
  },
  referenceLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.5)',
    marginTop: spacing.sm,
    letterSpacing: 0.2,
  },
  pinLabel: {
    ...typography.captionBold,
    color: colors.dark.textDim,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorText: {
    ...typography.body,
    color: colors.dark.error,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  confirmButton: {
    marginTop: spacing.xl,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  confirmGradient: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  confirmText: {
    ...typography.h3,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: spacing.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  cancelText: {
    ...typography.bodySemibold,
    color: colors.dark.textDim,
  },
});
