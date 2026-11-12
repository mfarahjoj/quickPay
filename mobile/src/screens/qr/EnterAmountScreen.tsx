import React, { useState, useMemo, useRef } from 'react';
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
import { cooldownMessage } from '../../utils/cooldownMessage';
import { BiometryTypes } from 'react-native-biometrics';
import LinearGradient from 'react-native-linear-gradient';
import { payMerchant } from '../../services/merchant.service';
import { newIdempotencyKey } from '../../utils/idempotency';
import {
  isBiometricEnabled,
  getBiometricCredential,
  isBiometricAvailable,
  prepareBiometricApproval,
} from '../../services/biometric.service';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, borderRadius, makeStyles, useColors, useTheme, tints } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { PinInput } from '../../components/PinInput';
import { Header } from '../../components/Header';
import { AmountCaret, AmountKeypad } from '../../components/AmountKeypad';
import { BackIcon, StoreIcon } from '../../components/icons/LineIcons';
import { pressAmountKey } from '../../utils/amountKeypad';
import { useWallet } from '../../hooks/useWallet';

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
  const colors = useColors();
  const styles = useStyles();
  const lightStyles = useLightStyles();
  const { t } = useTranslation();
  const { merchantId, merchantName, currency } = route.params;
  // Light mode types the amount on its own keypad, under an amount card.
  const { scheme } = useTheme();
  const isLight = scheme === 'light';
  const insets = useSafeAreaInsets();
  const { wallet } = useWallet();

  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('amount');
  const [pin, setPin] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<string | undefined>();

  // One key per payment attempt, held across retries so the server can tell a
  // retry from a second payment. It is minted when the customer commits to an
  // amount and cleared when they go back to change it, which is the only point
  // where they mean to start a different payment.
  const idempotencyKey = useRef<string | null>(null);

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
    idempotencyKey.current = newIdempotencyKey();
    if (biometricAvailable) prepareBiometricApproval();
    setStep('confirm');
  };

  const processWithPin = async (pinToUse: string) => {
    try {
      setProcessing(true);
      setError(null);
      const result = await payMerchant(
        merchantId,
        parsedAmount,
        currency,
        pinToUse,
        idempotencyKey.current ?? undefined,
      );

      navigation.replace('PaymentSuccess', {
        transactionId: result.transactionId,
        receiptNumber: result.receiptNumber,
        amount: parsedAmount,
        currency,
        merchantId,
        merchantName,
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
    const storedPin = await getBiometricCredential(
      t('common.confirmPaymentAmount', { amount: `${CURRENCY_SYMBOL}${parsedAmount.toFixed(2)}` })
    );
    if (storedPin) {
      await processWithPin(storedPin);
    } else {
      setError(t('qr.enterAmount.biometricFailed'));
    }
  };

  if (step === 'amount' && isLight) {
    const payLabel = `${CURRENCY_SYMBOL}${(isValidAmount ? parsedAmount : 0).toFixed(2)}`;
    return (
      <View style={[lightStyles.container, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={lightStyles.back}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <BackIcon size={24} color={colors.ui.text} />
        </TouchableOpacity>

        <View style={lightStyles.merchant}>
          <View style={lightStyles.merchantAvatar}>
            <StoreIcon size={26} color={tints.amber.mark} strokeWidth={1.8} />
          </View>
          <Text style={lightStyles.merchantName} numberOfLines={2}>
            {merchantName}
          </Text>
          <Text style={lightStyles.merchantSub}>{t('qr.enterAmount.zappMerchant')}</Text>
        </View>

        <View style={lightStyles.amountCard}>
          <Text style={lightStyles.cardLabel}>{t('qr.enterAmount.youPay')}</Text>
          <View style={lightStyles.amountRow}>
            <View style={lightStyles.amountWrap}>
              <Text
                style={[lightStyles.amountText, !amount && lightStyles.amountEmpty]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {CURRENCY_SYMBOL}
                {amount || '0'}
              </Text>
              <AmountCaret color={colors.ui.accent} height={44} />
            </View>
            <View style={lightStyles.currencyPill}>
              <View style={lightStyles.currencyCoin}>
                <Text style={lightStyles.currencyCoinText}>{CURRENCY_SYMBOL}</Text>
              </View>
              <Text style={lightStyles.currencyText}>{currency}</Text>
            </View>
          </View>
          <View style={lightStyles.cardDivider} />
          <View style={lightStyles.balanceRow}>
            <Text style={lightStyles.balanceKey}>{t('qr.enterAmount.balance')}</Text>
            <Text style={lightStyles.balanceValue}>
              {wallet ? `${CURRENCY_SYMBOL}${wallet.balance.toFixed(2)}` : '—'}
            </Text>
          </View>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={lightStyles.spacer} />

        <AmountKeypad
          onKey={(key) => {
            setError(null);
            setAmount((current) => pressAmountKey(current, key));
          }}
          onClear={() => setAmount('')}
        />
        <TouchableOpacity
          style={[lightStyles.payButton, !isValidAmount && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={!isValidAmount}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Text style={lightStyles.payText}>{t('qr.enterAmount.payAmount', { amount: payLabel })}</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
      <Header
        title={t('qr.enterAmount.confirmTitle')}
        onBack={() => {
          // Going back means a different payment, so the next attempt must not
          // reuse this key and be answered with this payment's receipt.
          idempotencyKey.current = null;
          setStep('amount');
        }}
      />

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

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
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
    backgroundColor: colors.ui.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.smPlus,
  },
  merchantInitialText: {
    ...typography.display,
    color: colors.ui.accentText,
  },
  merchantNameLarge: {
    ...typography.h1,
    color: colors.ui.text,
    textAlign: 'center',
  },
  amountLabel: {
    ...typography.captionBold,
    color: colors.ui.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  currencyPrefix: {
    ...typography.display,
    color: colors.ui.textFaint,
    marginRight: spacing.sm,
  },
  amountInput: {
    flex: 1,
    ...typography.display,
    color: colors.ui.text,
    padding: 0,
  },
  continueButton: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  // A gradient doesn't grow to fit its label, so it gets a fixed height.
  gradientButton: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
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
    color: colors.ui.textFaint,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  merchantNameConfirm: {
    ...typography.h2,
    color: colors.ui.text,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  amountBox: {
    backgroundColor: colors.ui.incomingSoft,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    padding: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  amountCurrencyLabel: {
    ...typography.caption,
    color: colors.ui.incoming,
    marginBottom: spacing.xs,
  },
  amountDisplay: {
    ...typography.display,
    color: colors.ui.incoming,
    fontWeight: '700',
  },
  biometricButton: {
    backgroundColor: colors.ui.accentSoft,
    borderWidth: 1,
    borderColor: colors.ui.accentBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  biometricButtonText: {
    ...typography.bodySemibold,
    color: colors.ui.accentText,
  },
  pinLabel: {
    ...typography.captionBold,
    color: colors.ui.textDim,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorText: {
    ...typography.body,
    color: colors.ui.error,
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
    color: colors.ui.textDim,
  },
}));

// ─── Light amount step: an amount card over the keypad ────────
const useLightStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: colors.ui.canvas,
  },
  back: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  merchant: {
    alignItems: 'center',
    marginTop: 2,
  },
  merchantAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: tints.amber.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  merchantName: {
    marginTop: 10,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.ui.text,
    textAlign: 'center',
  },
  merchantSub: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ui.textFaint,
  },
  amountCard: {
    marginTop: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: 24,
    backgroundColor: colors.ui.surface,
  },
  cardLabel: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.ui.textFaint,
  },
  amountRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  amountWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  amountText: {
    flexShrink: 1,
    fontSize: 52,
    lineHeight: 60,
    fontWeight: '700',
    letterSpacing: -2,
    color: colors.ui.text,
    fontVariant: ['tabular-nums'],
  },
  amountEmpty: {
    color: colors.ui.textFaint,
  },
  currencyPill: {
    height: 34,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 17,
    backgroundColor: colors.ui.canvas,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currencyCoin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ui.incoming,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencyCoinText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  currencyText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ui.text,
  },
  cardDivider: {
    height: 1,
    marginTop: 14,
    marginBottom: 12,
    backgroundColor: colors.ui.divider,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  balanceKey: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.ui.textFaint,
  },
  balanceValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.ui.text,
    fontVariant: ['tabular-nums'],
  },
  spacer: {
    flex: 1,
    minHeight: 12,
  },
  payButton: {
    marginTop: 16,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ui.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
}));
