import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Button } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL, PHONE_PREFIX } from '../../config/constants';
import { useAuth } from '../../hooks/useAuth';
import { triggerHaptic } from '../../services/haptics.service';
import { functions } from '../../services/firebase.config';

type Step = 'phone' | 'amount' | 'review' | 'success';

export default function SendRemittanceScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [senderName, setSenderName] = useState('');
  const [recipientName, setRecipientName] = useState<string | undefined>();
  const [processing, setProcessing] = useState(false);

  const amount = Number(amountText || '0');
  const fullPhone = phoneInput.startsWith('+') ? phoneInput : `${PHONE_PREFIX}${phoneInput}`;

  const appendDigit = (digit: string) => {
    if (digit === '.' && amountText.includes('.')) return;
    triggerHaptic('light');
    setAmountText((prev) => `${prev}${digit}`);
  };

  const backspace = () => {
    triggerHaptic('light');
    setAmountText((prev) => prev.slice(0, -1));
  };

  const reset = () => {
    setStep('phone');
    setPhoneInput('');
    setAmountText('');
    setNote('');
    setSenderName('');
    setRecipientName(undefined);
    setProcessing(false);
  };

  const handleContinueToAmount = () => {
    if (!phoneInput.trim()) {
      Alert.alert(t('common.error'), t('remittance.enterPhoneError'));
      return;
    }
    triggerHaptic('medium');
    setStep('amount');
  };

  const handleContinueToReview = () => {
    if (amount <= 0) return;
    triggerHaptic('medium');
    setStep('review');
  };

  const handlePayNow = async () => {
    try {
      setProcessing(true);
      triggerHaptic('medium');

      const amountCents = Math.round(amount * 100);

      const createFn = functions().httpsCallable('createRemittance');
      const createResult = await createFn({
        recipientPhone: fullPhone,
        amount: amountCents,
        currency: 'USD',
        senderName: senderName || undefined,
        note: note || undefined,
      });

      const createData = createResult.data as {
        success: boolean;
        data?: {
          remittanceId: string;
          clientSecret: string;
          paymentIntentId: string;
          amount: number;
          recipientName?: string;
        };
        error?: string;
      };

      if (!createData.success || !createData.data) {
        Alert.alert(t('common.failed'), createData.error || t('remittance.createFailed'));
        return;
      }

      setRecipientName(createData.data.recipientName);

      const completeFn = functions().httpsCallable('completeRemittance');
      const completeResult = await completeFn({
        remittanceId: createData.data.remittanceId,
        paymentIntentId: createData.data.paymentIntentId,
      });

      const completeData = completeResult.data as { success: boolean; error?: string };

      if (!completeData.success) {
        Alert.alert(t('common.failed'), completeData.error || t('remittance.completeFailed'));
        return;
      }

      triggerHaptic('success');
      setStep('success');
    } catch (err: any) {
      const msg = err.message?.replace(/^\[.*?\]\s*/, '') || t('remittance.failed');
      Alert.alert(t('common.error'), msg);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('remittance.title')}</Text>
      <Text style={styles.subtitle}>{t('remittance.subtitle')}</Text>

      {step === 'phone' && (
        <Card>
          <Text style={styles.stepTitle}>{t('remittance.recipientDetails')}</Text>
          <Text style={styles.groupTitle}>{t('remittance.phoneNumber')}</Text>
          <View style={styles.phoneRow}>
            <View style={styles.prefixBox}>
              <Text style={styles.prefixText}>{PHONE_PREFIX}</Text>
            </View>
            <TextInput
              placeholder="XX XXX XXXX"
              placeholderTextColor={colors.text.muted}
              value={phoneInput}
              onChangeText={setPhoneInput}
              keyboardType="phone-pad"
              style={styles.phoneInput}
              autoFocus
            />
          </View>
          <Text style={styles.groupTitle}>{t('remittance.yourNameOptional')}</Text>
          <TextInput
            placeholder={t('remittance.senderNamePlaceholder')}
            placeholderTextColor={colors.text.muted}
            value={senderName}
            onChangeText={setSenderName}
            style={styles.noteInput}
          />
          <Button
            title={t('common.continue')}
            onPress={handleContinueToAmount}
            disabled={!phoneInput.trim()}
            fullWidth
            style={styles.primaryCta}
          />
        </Card>
      )}

      {step === 'amount' && (
        <Card>
          <Text style={styles.stepTitle}>{t('remittance.enterAmount')}</Text>
          <View style={styles.recipientBadge}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{fullPhone.slice(-2)}</Text>
            </View>
            <View style={styles.contactInfo}>
              <Text style={styles.contactName}>{t('remittance.to', { phone: fullPhone })}</Text>
              {senderName ? (
                <Text style={styles.contactHandle}>{t('remittance.from', { name: senderName })}</Text>
              ) : null}
            </View>
          </View>
          <Text style={styles.amountLarge}>
            {CURRENCY_SYMBOL}
            {amountText || '0'}
          </Text>
          <TextInput
            placeholder={t('payments.addNote')}
            placeholderTextColor={colors.text.muted}
            value={note}
            onChangeText={setNote}
            style={styles.noteInput}
          />
          <View style={styles.keypad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '<'].map((key) => (
              <TouchableOpacity
                key={key}
                style={styles.key}
                onPress={() => (key === '<' ? backspace() : appendDigit(key))}
                activeOpacity={0.75}
              >
                <Text style={styles.keyText}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Button
            title={t('common.continue')}
            onPress={handleContinueToReview}
            disabled={amount <= 0}
            fullWidth
            style={styles.primaryCta}
          />
          <Button
            title={t('common.back')}
            onPress={() => setStep('phone')}
            variant="secondary"
            fullWidth
            style={styles.secondaryCta}
          />
        </Card>
      )}

      {step === 'review' && (
        <Card>
          <Text style={styles.stepTitle}>{t('remittance.review')}</Text>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewKey}>{t('common.recipient')}</Text>
            <Text style={styles.reviewValue}>{fullPhone}</Text>
          </View>
          {senderName ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewKey}>{t('common.sender')}</Text>
              <Text style={styles.reviewValue}>{senderName}</Text>
            </View>
          ) : null}
          <View style={styles.reviewRow}>
            <Text style={styles.reviewKey}>{t('common.amount')}</Text>
            <Text style={styles.reviewValue}>
              {CURRENCY_SYMBOL}{amount.toFixed(2)}
            </Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewKey}>{t('common.fee')}</Text>
            <Text style={styles.reviewValue}>{CURRENCY_SYMBOL}0.00</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewKey}>{t('common.delivery')}</Text>
            <Text style={styles.reviewValue}>{t('common.instant')}</Text>
          </View>
          {note ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewKey}>{t('common.note')}</Text>
              <Text style={styles.reviewValue}>{note}</Text>
            </View>
          ) : null}
          <Text style={styles.stripeNote}>
            {t('remittance.stripeNote')}
          </Text>
          {processing ? (
            <ActivityIndicator
              style={{ marginTop: spacing.lg }}
              size="large"
              color={colors.action.primary}
            />
          ) : (
            <>
              <Button
                title={t('remittance.payNow')}
                onPress={handlePayNow}
                fullWidth
                style={styles.primaryCta}
              />
              <Button
                title={t('common.back')}
                onPress={() => {
                  triggerHaptic('light');
                  setStep('amount');
                }}
                variant="secondary"
                fullWidth
                style={styles.secondaryCta}
              />
            </>
          )}
        </Card>
      )}

      {step === 'success' && (
        <Card style={styles.successCard}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>{t('remittance.sent')}</Text>
          <Text style={styles.successAmount}>
            {CURRENCY_SYMBOL}{amount.toFixed(2)}
          </Text>
          <Text style={styles.successRecipient}>
            {t('common.toRecipient', { name: recipientName || fullPhone })}
          </Text>
          <Button
            title={t('remittance.sendAnother')}
            onPress={() => {
              triggerHaptic('light');
              reset();
            }}
            fullWidth
            style={styles.primaryCta}
          />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...typography.h1,
    color: colors.dark.text,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.lg,
  },
  stepTitle: {
    ...typography.bodyLarge,
    color: colors.dark.text,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  groupTitle: {
    ...typography.captionBold,
    color: colors.dark.textFaint,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  phoneRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  prefixBox: {
    height: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dark.glassRaised,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderTopLeftRadius: borderRadius.md,
    borderBottomLeftRadius: borderRadius.md,
  },
  prefixText: {
    ...typography.body,
    color: colors.dark.textDim,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: colors.dark.glassBorder,
    borderTopRightRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    paddingHorizontal: spacing.md,
    color: colors.dark.text,
    ...typography.body,
  },
  noteInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    paddingHorizontal: spacing.md,
    color: colors.dark.text,
    marginBottom: spacing.md,
  },
  recipientBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.incomingSoft,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.dark.glass,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.smPlus,
  },
  avatarText: {
    ...typography.body,
    color: colors.dark.text,
    fontWeight: '600',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    ...typography.body,
    color: colors.dark.text,
    fontWeight: '500',
  },
  contactHandle: {
    ...typography.caption,
    color: colors.dark.textFaint,
  },
  amountLarge: {
    ...typography.balanceNumber,
    color: colors.dark.text,
    textAlign: 'center',
    marginVertical: spacing.smPlus,
    fontVariant: ['tabular-nums'],
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  key: {
    width: '31%',
    height: 44,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    backgroundColor: colors.dark.glass,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: {
    ...typography.bodyLarge,
    color: colors.dark.text,
    fontWeight: '600',
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.divider,
    paddingVertical: spacing.smPlus,
  },
  reviewKey: {
    ...typography.body,
    color: colors.dark.textFaint,
  },
  reviewValue: {
    ...typography.body,
    color: colors.dark.text,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  stripeNote: {
    ...typography.caption,
    color: colors.dark.textFaint,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  primaryCta: {
    marginTop: spacing.md,
  },
  secondaryCta: {
    marginTop: spacing.sm,
  },
  successCard: {
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 42,
    color: colors.dark.incoming,
  },
  successTitle: {
    ...typography.h2,
    color: colors.dark.text,
    marginTop: spacing.sm,
  },
  successAmount: {
    ...typography.balanceNumber,
    color: colors.dark.text,
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  successRecipient: {
    ...typography.body,
    color: colors.dark.textDim,
    marginTop: spacing.xs,
  },
});
