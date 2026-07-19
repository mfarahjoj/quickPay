import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import { functions } from '../../services/firebase.config';
import { useAuth } from '../../hooks/useAuth';
import { colors, typography, spacing, borderRadius } from '../../theme';
import {
  PHONE_PREFIX,
  COUNTRY_FLAG,
  CURRENCY_SYMBOL,
  MAX_TOPUP_AMOUNT,
  PHONE_NUMBER_LENGTH,
} from '../../config/constants';

interface Props {
  navigation: any;
}

export default function ManualTopupScreen({ navigation }: Props) {
  const { t } = useTranslation();
  useAuth();
  const [customerPhone, setCustomerPhone] = useState(PHONE_PREFIX);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer'>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const pinRefs = useRef<Array<TextInput | null>>([]);

  const handlePinChange = (text: string, index: number) => {
    const newPin = [...pin];
    newPin[index] = text;
    setPin(newPin);

    if (text && index < 5) {
      pinRefs.current[index + 1]?.focus();
    }
  };

  const handleTopup = async () => {
    if (!customerPhone || customerPhone.length !== PHONE_NUMBER_LENGTH) {
      Alert.alert(t('common.invalidPhone'), t('topup.manual.invalidPhone'));
      return;
    }

    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      Alert.alert(t('common.error'), t('topup.manual.invalidAmount'));
      return;
    }

    if (amountNum > MAX_TOPUP_AMOUNT) {
      Alert.alert(
        t('common.amountTooLarge'),
        t('topup.manual.amountTooLarge', { amount: `${CURRENCY_SYMBOL}${MAX_TOPUP_AMOUNT}` })
      );
      return;
    }

    const pinCode = pin.join('');
    if (pinCode.length !== 6) {
      Alert.alert(t('common.invalidPin'), t('topup.manual.invalidPin'));
      return;
    }

    try {
      setLoading(true);

      const lookupFunction = functions().httpsCallable('lookupUserByPhone');
      const lookupResult = await lookupFunction({ phoneNumber: customerPhone });

      const lookupData = lookupResult.data as {
        success: boolean;
        data?: { userId: string }
      };
      if (!lookupData.success || !lookupData.data?.userId) {
        Alert.alert(t('common.userNotFound'), t('topup.manual.userNotFound'));
        return;
      }

      const userId = lookupData.data.userId;

      const topupFunction = functions().httpsCallable('manualTopup');
      const result = await topupFunction({
        userId,
        amount: amountNum,
        agentPin: pinCode,
        paymentMethod,
        reference: reference || undefined,
        notes: notes || undefined,
      });

      const topupData = result.data as {
        success: boolean;
        data: { newBalance: number }
      };
      if (topupData.success) {
        Alert.alert(
          t('topup.manual.successTitle'),
          t('topup.manual.successMessage', {
            phone: customerPhone,
            amount: `${CURRENCY_SYMBOL}${amountNum.toFixed(2)}`,
            balance: `${CURRENCY_SYMBOL}${topupData.data.newBalance.toFixed(2)}`,
          }),
          [
            {
              text: t('common.done'),
              onPress: () => {
                setCustomerPhone(PHONE_PREFIX);
                setAmount('');
                setReference('');
                setNotes('');
                setPin(['', '', '', '', '', '']);
                navigation.goBack();
              },
            },
          ]
        );
      }
    } catch (error: any) {
      Alert.alert(t('topup.manual.failedTitle'), error.message);
      setPin(['', '', '', '', '', '']);
      pinRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>💵</Text>
          </View>
          <Text style={styles.title}>{t('topup.manual.title')}</Text>
          <Text style={styles.subtitle}>
            {t('topup.manual.subtitle')}
          </Text>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>{t('topup.manual.customerPhone')}</Text>
          <View style={styles.phoneInputWrapper}>
            <Text style={styles.countryFlag}>{COUNTRY_FLAG}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('common.phoneFormat252')}
              placeholderTextColor={colors.text.tertiary}
              value={customerPhone}
              onChangeText={setCustomerPhone}
              keyboardType="phone-pad"
              maxLength={13}
            />
          </View>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>{t('topup.manual.amountUsd')}</Text>
          <View style={styles.amountInputWrapper}>
            <Text style={styles.currencySymbol}>{CURRENCY_SYMBOL}</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={colors.text.tertiary}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>
          <Text style={styles.hint}>
            {t('topup.manual.maximum', { amount: `${CURRENCY_SYMBOL}${MAX_TOPUP_AMOUNT.toLocaleString()}` })}
          </Text>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>{t('topup.manual.paymentMethod')}</Text>
          <View style={styles.paymentMethodContainer}>
            <TouchableOpacity
              style={[
                styles.methodButton,
                paymentMethod === 'cash' && styles.methodButtonActive,
              ]}
              onPress={() => setPaymentMethod('cash')}
              activeOpacity={0.7}
            >
              {paymentMethod === 'cash' && (
                <View style={styles.selectedIndicator} />
              )}
              <Text style={styles.methodIcon}>💵</Text>
              <Text
                style={[
                  styles.methodText,
                  paymentMethod === 'cash' && styles.methodTextActive,
                ]}
              >
                {t('topup.manual.cash')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.methodButton,
                paymentMethod === 'bank_transfer' && styles.methodButtonActive,
              ]}
              onPress={() => setPaymentMethod('bank_transfer')}
              activeOpacity={0.7}
            >
              {paymentMethod === 'bank_transfer' && (
                <View style={styles.selectedIndicator} />
              )}
              <Text style={styles.methodIcon}>🏦</Text>
              <Text
                style={[
                  styles.methodText,
                  paymentMethod === 'bank_transfer' && styles.methodTextActive,
                ]}
              >
                {t('topup.manual.bankTransfer')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>{t('topup.manual.referenceOptional')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('topup.manual.referencePlaceholder')}
          value={reference}
          onChangeText={setReference}
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>{t('topup.manual.notesOptional')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder={t('topup.manual.notesPlaceholder')}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>{t('topup.manual.agentPin')}</Text>
        <View style={styles.pinContainer}>
          {pin.map((digit, index) => (
            <View key={index} style={styles.pinInputWrapper}>
              <TextInput
                ref={(ref) => {
                  pinRefs.current[index] = ref;
                }}
                style={styles.pinInput}
                value={digit}
                onChangeText={(text) => handlePinChange(text, index)}
                keyboardType="number-pad"
                maxLength={1}
                secureTextEntry
                selectTextOnFocus
              />
              {digit && <View style={styles.pinDot} />}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.warningBox}>
        <Text style={styles.warningIcon}>⚠️</Text>
        <Text style={styles.warningText}>
          {t('topup.manual.warning')}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleTopup}
        disabled={loading}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={[colors.success, '#00A374']}
          style={styles.buttonGradient}
        >
          {loading ? (
            <ActivityIndicator color={colors.text.inverse} />
          ) : (
            <Text style={styles.buttonText}>{t('topup.manual.processTopup')}</Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },

  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.dark.incomingSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    ...typography.h1,
    color: colors.dark.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
  },

  inputContainer: {
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.captionBold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  phoneInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
  countryFlag: {
    fontSize: 24,
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.dark.text,
    paddingVertical: spacing.md,
  },
  hint: {
    ...typography.caption,
    color: colors.dark.textFaint,
    marginTop: spacing.xs,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },

  amountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.incomingSoft,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.incoming,
  },
  currencySymbol: {
    ...typography.h2,
    fontWeight: 'bold',
    color: colors.dark.incoming,
    marginRight: spacing.sm,
  },
  amountInput: {
    flex: 1,
    ...typography.h2,
    fontWeight: 'bold',
    color: colors.dark.incoming,
    paddingVertical: spacing.md,
  },

  paymentMethodContainer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  methodButton: {
    flex: 1,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
    position: 'relative',
  },
  methodButtonActive: {
    borderColor: colors.dark.accent,
    backgroundColor: colors.dark.accentSoft,
  },
  selectedIndicator: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.dark.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  methodIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  methodText: {
    ...typography.bodySemibold,
    color: colors.dark.textDim,
  },
  methodTextActive: {
    color: colors.dark.accentText,
  },

  pinContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pinInputWrapper: {
    flex: 1,
    position: 'relative',
  },
  pinInput: {
    height: 64,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    ...typography.h2,
    fontWeight: 'bold',
    textAlign: 'center',
    color: 'transparent',
    backgroundColor: colors.dark.glass,
  },
  pinDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.dark.incoming,
    top: '50%',
    left: '50%',
    marginTop: -7,
    marginLeft: -7,
  },

  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.warningSoft,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.dark.warning,
    marginBottom: spacing.lg,
  },
  warningIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  warningText: {
    ...typography.caption,
    color: colors.dark.warning,
    flex: 1,
  },

  button: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  buttonGradient: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...typography.h3,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
