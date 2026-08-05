import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { BiometryTypes } from 'react-native-biometrics';
import LinearGradient from 'react-native-linear-gradient';
import { payMerchant } from '../../services/merchant.service';
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
      merchantId: string;
      merchantName: string;
      currency: string;
    };
  };
}

type Step = 'amount' | 'confirm';

function getBiometricLabelKey(biometryType?: string): string {
  if (biometryType === BiometryTypes.FaceID) return 'biometric.faceId';
  if (biometryType === BiometryTypes.TouchID) return 'biometric.touchId';
  return 'biometric.generic';
}

export default function EnterAmountScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { merchantId, merchantName, currency } = route.params;

  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('amount');
  const [pin, setPin] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<string | undefined>();

  const biometricLabel = useMemo(
    () => t(getBiometricLabelKey(biometryType)),
    [biometryType, t],
  );

  React.useEffect(() => {
    Promise.all([isBiometricEnabled(), isBiometricAvailable()]).then(
      ([enabled, { available, biometryType: bt }]) => {
        setBiometricAvailable(enabled && available);
        setBiometryType(bt);
      }
    );
  }, []);

  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;

  const handleContinue = () => {
    if (!isValidAmount) {
      setError(t('qr.enterAmount.validAmountError'));
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const processWithPin = async (pinToUse: string) => {
    try {
      setProcessing(true);
      setError(null);
      const result = await payMerchant(merchantId, parsedAmount, currency, pinToUse);

      navigation.replace('PaymentSuccess', {
        transactionId: result.transactionId,
        amount: parsedAmount,
        currency,
        merchantId,
      });
    } catch (err: any) {
      setError(err.message || t('qr.confirm.paymentFailed'));
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
      t('common.confirmPaymentAmount', { amount: `${CURRENCY_SYMBOL}${parsedAmount.toFixed(2)}` })
    );
    if (storedPin) {
      await processWithPin(storedPin);
    } else {
      setError(t('qr.enterAmount.biometricFailed'));
    }
  };

  if (step === 'amount') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header title={t('qr.enterAmount.title')} onBack={() => navigation.goBack()} />

        <View style={styles.content}>
          <View style={styles.merchantCard}>
            <View style={styles.merchantInitial}>
              <Text style={styles.merchantInitialText}>
                {merchantName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.merchantNameLarge}>{merchantName}</Text>
          </View>

          <Text style={styles.amountLabel}>{t('qr.enterAmount.enterAmount')}</Text>
          <View style={styles.amountInputRow}>
            <Text style={styles.currencyPrefix}>{CURRENCY_SYMBOL}</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.text.tertiary}
              keyboardType="decimal-pad"
              autoFocus
              maxLength={10}
            />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.continueButton, !isValidAmount && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={!isValidAmount}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[colors.primary, colors.primaryGradientEnd]}
              style={styles.gradientButton}
            >
              <Text style={styles.continueText}>{t('qr.enterAmount.continue')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title={t('qr.enterAmount.confirmTitle')} onBack={() => setStep('amount')} />

      <View style={styles.content}>
        <Text style={styles.payToLabel}>{t('qr.enterAmount.payTo')}</Text>
        <Text style={styles.merchantNameConfirm}>{merchantName}</Text>

        <View style={styles.amountBox}>
          <Text style={styles.amountCurrencyLabel}>{currency}</Text>
          <Text style={styles.amountDisplay}>
            {CURRENCY_SYMBOL}
            {parsedAmount.toFixed(2)}
          </Text>
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
            style={styles.gradientButton}
          >
            {processing ? (
              <ActivityIndicator color={colors.text.inverse} />
            ) : (
              <Text style={styles.confirmText}>{t('qr.confirm.confirmPayment')}</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
        >
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
  merchantCard: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    marginTop: spacing.md,
  },
  merchantInitial: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.dark.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.smPlus,
  },
  merchantInitialText: {
    ...typography.display,
    color: colors.dark.accentText,
  },
  merchantNameLarge: {
    ...typography.h1,
    color: colors.dark.text,
    textAlign: 'center',
  },
  amountLabel: {
    ...typography.captionBold,
    color: colors.dark.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  currencyPrefix: {
    ...typography.display,
    color: colors.dark.textFaint,
    marginRight: spacing.sm,
  },
  amountInput: {
    flex: 1,
    ...typography.display,
    color: colors.dark.text,
    padding: 0,
  },
  continueButton: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  gradientButton: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  continueText: {
    ...typography.h3,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  payToLabel: {
    ...typography.caption,
    color: colors.dark.textFaint,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  merchantNameConfirm: {
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
  amountCurrencyLabel: {
    ...typography.caption,
    color: colors.dark.incoming,
    marginBottom: spacing.xs,
  },
  amountDisplay: {
    ...typography.display,
    color: colors.dark.incoming,
    fontWeight: '700',
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
