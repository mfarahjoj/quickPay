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
import { Card, Button, PinInput } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL, PHONE_PREFIX } from '../../config/constants';
import { useAuth } from '../../hooks/useAuth';
import { triggerHaptic } from '../../services/haptics.service';
import { functions } from '../../services/firebase.config';

type Mode = 'topup' | 'cashout';
type Provider = 'zaad' | 'edahab';
type Step = 'provider' | 'amount' | 'phone' | 'pin' | 'processing' | 'success';

export default function MobileMoneyScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [mode, setMode] = useState<Mode>('topup');
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [amountText, setAmountText] = useState('');
  const [phoneInput, setPhoneInput] = useState(user?.phoneNumber?.replace(PHONE_PREFIX, '') ?? '');
  const [pin, setPin] = useState('');
  const [processing, setProcessing] = useState(false);
  const [successAmount, setSuccessAmount] = useState(0);

  const amount = Number(amountText || '0');
  const fullPhone = phoneInput.startsWith('+') ? phoneInput : `${PHONE_PREFIX}${phoneInput}`;

  const modeLabel = mode === 'topup' ? t('topup.mobileMoney.topUp') : t('topup.mobileMoney.cashOut');
  const providerLabel = provider === 'zaad' ? t('topup.mobileMoney.zaad') : t('topup.mobileMoney.edahab');

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
    setStep('provider');
    setProvider(null);
    setAmountText('');
    setPhoneInput(user?.phoneNumber?.replace(PHONE_PREFIX, '') ?? '');
    setPin('');
    setProcessing(false);
    setSuccessAmount(0);
  };

  const handleSubmit = async () => {
    if (pin.length < 6 || !provider || processing) return;
    try {
      setStep('processing');
      setProcessing(true);
      triggerHaptic('medium');

      const amountCents = Math.round(amount * 100);
      const fnName = mode === 'topup' ? 'topupFromMobileMoney' : 'cashOutToMobileMoney';
      const callable = functions().httpsCallable(fnName);
      const result = await callable({
        method: provider,
        phoneNumber: fullPhone,
        amount: amountCents,
        pin,
      });

      const data = result.data as { success: boolean; error?: string };
      if (!data.success) {
        Alert.alert(
          t('common.failed'),
          data.error || (mode === 'topup' ? t('topup.mobileMoney.topupFailed') : t('topup.mobileMoney.cashoutFailed'))
        );
        setPin('');
        setStep('pin');
        return;
      }

      setSuccessAmount(amount);
      triggerHaptic('success');
      setStep('success');
    } catch (err: any) {
      const msg = err.message?.replace(/^\[.*?\]\s*/, '') ||
        (mode === 'topup' ? t('topup.mobileMoney.topupFailed') : t('topup.mobileMoney.cashoutFailed'));
      Alert.alert(t('common.error'), msg);
      setPin('');
      setStep('pin');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('topup.mobileMoney.title')}</Text>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, mode === 'topup' && styles.tabActive]}
          onPress={() => { triggerHaptic('light'); setMode('topup'); reset(); }}
        >
          <Text style={[styles.tabText, mode === 'topup' && styles.tabTextActive]}>
            {t('topup.mobileMoney.topUp')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === 'cashout' && styles.tabActive]}
          onPress={() => { triggerHaptic('light'); setMode('cashout'); reset(); }}
        >
          <Text style={[styles.tabText, mode === 'cashout' && styles.tabTextActive]}>
            {t('topup.mobileMoney.cashOut')}
          </Text>
        </TouchableOpacity>
      </View>

      {step === 'provider' && (
        <View>
          <Text style={styles.stepTitle}>{t('topup.mobileMoney.chooseProvider')}</Text>
          <View style={styles.providerRow}>
            <TouchableOpacity
              style={[styles.providerCard, provider === 'zaad' && styles.providerCardZaad]}
              onPress={() => { triggerHaptic('light'); setProvider('zaad'); }}
              activeOpacity={0.75}
            >
              <View style={[styles.providerIcon, { backgroundColor: '#E9F8EF' }]}>
                <Text style={[styles.providerIconText, { color: '#1F9D55' }]}>Z</Text>
              </View>
              <Text style={styles.providerName}>{t('topup.mobileMoney.zaad')}</Text>
              <Text style={styles.providerSub}>{t('topup.mobileMoney.telesom')}</Text>
              {provider === 'zaad' && <View style={[styles.providerCheck, { backgroundColor: '#1F9D55' }]}><Text style={styles.checkText}>✓</Text></View>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.providerCard, provider === 'edahab' && styles.providerCardEdahab]}
              onPress={() => { triggerHaptic('light'); setProvider('edahab'); }}
              activeOpacity={0.75}
            >
              <View style={[styles.providerIcon, { backgroundColor: '#E8EEFF' }]}>
                <Text style={[styles.providerIconText, { color: '#FF5043' }]}>E</Text>
              </View>
              <Text style={styles.providerName}>{t('topup.mobileMoney.edahab')}</Text>
              <Text style={styles.providerSub}>{t('topup.mobileMoney.dahabshil')}</Text>
              {provider === 'edahab' && <View style={[styles.providerCheck, { backgroundColor: '#FF5043' }]}><Text style={styles.checkText}>✓</Text></View>}
            </TouchableOpacity>
          </View>
          <Button
            title={t('common.continue')}
            onPress={() => { triggerHaptic('medium'); setStep('amount'); }}
            disabled={!provider}
            fullWidth
            style={styles.primaryCta}
          />
        </View>
      )}

      {step === 'amount' && (
        <Card>
          <Text style={styles.stepTitle}>{t('topup.mobileMoney.enterAmount')}</Text>
          <View style={styles.providerBadge}>
            <View style={[styles.badgeDot, { backgroundColor: provider === 'zaad' ? '#1F9D55' : '#FF5043' }]} />
            <Text style={styles.badgeText}>{providerLabel}</Text>
          </View>
          <Text style={styles.amountLarge}>
            {CURRENCY_SYMBOL}
            {amountText || '0'}
          </Text>
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
            onPress={() => { triggerHaptic('medium'); setStep('phone'); }}
            disabled={amount <= 0}
            fullWidth
            style={styles.primaryCta}
          />
          <Button
            title={t('common.back')}
            onPress={() => setStep('provider')}
            variant="secondary"
            fullWidth
            style={styles.secondaryCta}
          />
        </Card>
      )}

      {step === 'phone' && (
        <Card>
          <Text style={styles.stepTitle}>{t('topup.mobileMoney.enterPhone')}</Text>
          <Text style={styles.phoneHint}>
            {mode === 'topup'
              ? t('topup.mobileMoney.chargeFrom', { provider: providerLabel })
              : t('topup.mobileMoney.receiveTo', { provider: providerLabel })}
          </Text>
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
          <Button
            title={t('common.continue')}
            onPress={() => { triggerHaptic('medium'); setStep('pin'); }}
            disabled={!phoneInput.trim()}
            fullWidth
            style={styles.primaryCta}
          />
          <Button
            title={t('common.back')}
            onPress={() => setStep('amount')}
            variant="secondary"
            fullWidth
            style={styles.secondaryCta}
          />
        </Card>
      )}

      {step === 'pin' && (
        <Card>
          <Text style={styles.stepTitle}>{t('topup.mobileMoney.enterPin')}</Text>
          <Text style={styles.pinSubtitle}>
            {t('topup.mobileMoney.pinSubtitle', {
              mode: modeLabel,
              amount: `${CURRENCY_SYMBOL}${amount.toFixed(2)}`,
              provider: providerLabel,
            })}
          </Text>
          <PinInput
            value={pin}
            onChange={setPin}
            secure
          />
          <Button
            title={modeLabel}
            onPress={handleSubmit}
            disabled={pin.length < 6}
            fullWidth
            style={styles.primaryCta}
          />
          <Button
            title={t('common.back')}
            onPress={() => { setPin(''); setStep('phone'); }}
            variant="secondary"
            fullWidth
            style={styles.secondaryCta}
          />
        </Card>
      )}

      {step === 'processing' && (
        <Card style={styles.processingCard}>
          <ActivityIndicator size="large" color={colors.action.primary} />
          <Text style={styles.processingText}>
            {t('topup.mobileMoney.processing', { mode: modeLabel })}
          </Text>
        </Card>
      )}

      {step === 'success' && (
        <Card style={styles.successCard}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>
            {t('topup.mobileMoney.successTitle', { mode: modeLabel })}
          </Text>
          <Text style={styles.successAmount}>
            {CURRENCY_SYMBOL}{successAmount.toFixed(2)}
          </Text>
          <Text style={styles.successProvider}>
            {t('topup.mobileMoney.via', { provider: providerLabel })}
          </Text>
          <Button
            title={t('common.done')}
            onPress={() => { triggerHaptic('light'); reset(); }}
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
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    padding: 4,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.dark.accent,
  },
  tabText: {
    ...typography.body,
    color: colors.dark.textDim,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  stepTitle: {
    ...typography.bodyLarge,
    color: colors.dark.text,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  providerRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  providerCard: {
    flex: 1,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
  },
  providerCardZaad: {
    borderColor: 'rgba(52,199,123,0.4)',
    backgroundColor: 'rgba(52,199,123,0.12)',
  },
  providerCardEdahab: {
    borderColor: 'rgba(26,86,255,0.4)',
    backgroundColor: 'rgba(26,86,255,0.12)',
  },
  providerIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  providerIconText: {
    fontSize: 22,
    fontWeight: '700',
  },
  providerName: {
    ...typography.bodyLarge,
    color: colors.dark.text,
    fontWeight: '600',
  },
  providerSub: {
    ...typography.caption,
    color: colors.dark.textFaint,
    marginTop: spacing.xs,
  },
  providerCheck: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.sm,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  badgeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  badgeText: {
    ...typography.bodySemibold,
    color: colors.dark.text,
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
  phoneHint: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.md,
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
  pinSubtitle: {
    ...typography.body,
    color: colors.dark.textDim,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  primaryCta: {
    marginTop: spacing.md,
  },
  secondaryCta: {
    marginTop: spacing.sm,
  },
  processingCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  processingText: {
    ...typography.bodyLarge,
    color: colors.dark.textDim,
    marginTop: spacing.md,
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
  successProvider: {
    ...typography.body,
    color: colors.dark.textDim,
    marginTop: spacing.xs,
  },
});
