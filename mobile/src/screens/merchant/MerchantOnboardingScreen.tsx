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
import { PHONE_PREFIX } from '../../config/constants';
import { functions } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';

type SettlementProvider = 'zaad' | 'edahab';
type Step = 'business' | 'type' | 'address' | 'settlement' | 'submitting' | 'success';

const BUSINESS_TYPES = [
  { value: 'Retail', key: 'merchant.onboarding.type.retail' },
  { value: 'Restaurant', key: 'merchant.onboarding.type.restaurant' },
  { value: 'Grocery', key: 'merchant.onboarding.type.grocery' },
  { value: 'Pharmacy', key: 'merchant.onboarding.type.pharmacy' },
  { value: 'Electronics', key: 'merchant.onboarding.type.electronics' },
  { value: 'Services', key: 'merchant.onboarding.type.services' },
  { value: 'Other', key: 'merchant.onboarding.type.other' },
];

export default function MerchantOnboardingScreen() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('business');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [settlementProvider, setSettlementProvider] = useState<SettlementProvider | null>(null);
  const [settlementPhone, setSettlementPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const businessTypeLabel = (value: string) =>
    t(BUSINESS_TYPES.find((item) => item.value === value)?.key ?? 'merchant.onboarding.type.other');

  const reset = () => {
    setStep('business');
    setBusinessName('');
    setBusinessType('');
    setBusinessAddress('');
    setSettlementProvider(null);
    setSettlementPhone('');
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (!settlementProvider || !settlementPhone.trim()) return;
    try {
      setStep('submitting');
      setSubmitting(true);
      triggerHaptic('medium');

      const fullPhone = `${PHONE_PREFIX}${settlementPhone}`;
      const callable = functions().httpsCallable('registerMerchant');
      const result = await callable({
        businessName: businessName.trim(),
        businessType,
        businessAddress: businessAddress.trim(),
        settlementPreference: settlementProvider,
        zaadAccount: settlementProvider === 'zaad' ? fullPhone : undefined,
        edahabAccount: settlementProvider === 'edahab' ? fullPhone : undefined,
      });

      const data = result.data as { success: boolean; error?: string };
      if (!data.success) {
        Alert.alert(t('common.failed'), data.error || t('merchant.onboarding.registrationFailed'));
        setStep('settlement');
        return;
      }

      triggerHaptic('success');
      setStep('success');
    } catch (err: any) {
      const msg = err.message?.replace(/^\[.*?\]\s*/, '') || t('merchant.onboarding.registrationFailed');
      Alert.alert(t('common.error'), msg);
      setStep('settlement');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('merchant.onboarding.title')}</Text>

      {step === 'business' && (
        <Card>
          <Text style={styles.stepTitle}>{t('merchant.onboarding.businessName')}</Text>
          <Text style={styles.hint}>{t('merchant.onboarding.businessNameHint')}</Text>
          <TextInput
            placeholder={t('merchant.onboarding.businessNamePlaceholder')}
            placeholderTextColor={colors.text.muted}
            value={businessName}
            onChangeText={setBusinessName}
            style={styles.input}
            autoFocus
          />
          <Button
            title={t('common.continue')}
            onPress={() => { triggerHaptic('medium'); setStep('type'); }}
            disabled={!businessName.trim()}
            fullWidth
            style={styles.primaryCta}
          />
        </Card>
      )}

      {step === 'type' && (
        <Card>
          <Text style={styles.stepTitle}>{t('merchant.onboarding.businessType')}</Text>
          <Text style={styles.hint}>{t('merchant.onboarding.businessTypeHint')}</Text>
          <View style={styles.typeGrid}>
            {BUSINESS_TYPES.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[styles.typeChip, businessType === type.value && styles.typeChipActive]}
                onPress={() => { triggerHaptic('light'); setBusinessType(type.value); }}
                activeOpacity={0.75}
              >
                <Text style={[styles.typeChipText, businessType === type.value && styles.typeChipTextActive]}>
                  {t(type.key)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Button
            title={t('common.continue')}
            onPress={() => { triggerHaptic('medium'); setStep('address'); }}
            disabled={!businessType}
            fullWidth
            style={styles.primaryCta}
          />
          <Button
            title={t('common.back')}
            onPress={() => setStep('business')}
            variant="secondary"
            fullWidth
            style={styles.secondaryCta}
          />
        </Card>
      )}

      {step === 'address' && (
        <Card>
          <Text style={styles.stepTitle}>{t('merchant.onboarding.businessAddress')}</Text>
          <Text style={styles.hint}>{t('merchant.onboarding.businessAddressHint')}</Text>
          <TextInput
            placeholder={t('merchant.onboarding.businessAddressPlaceholder')}
            placeholderTextColor={colors.text.muted}
            value={businessAddress}
            onChangeText={setBusinessAddress}
            style={styles.input}
            autoFocus
          />
          <Button
            title={t('common.continue')}
            onPress={() => { triggerHaptic('medium'); setStep('settlement'); }}
            disabled={!businessAddress.trim()}
            fullWidth
            style={styles.primaryCta}
          />
          <Button
            title={t('common.back')}
            onPress={() => setStep('type')}
            variant="secondary"
            fullWidth
            style={styles.secondaryCta}
          />
        </Card>
      )}

      {step === 'settlement' && (
        <View>
          <Text style={styles.stepTitle}>{t('merchant.onboarding.settlementAccount')}</Text>
          <Text style={styles.hint}>{t('merchant.onboarding.settlementHint')}</Text>
          <View style={styles.providerRow}>
            <TouchableOpacity
              style={[styles.providerCard, settlementProvider === 'zaad' && styles.providerCardZaad]}
              onPress={() => { triggerHaptic('light'); setSettlementProvider('zaad'); }}
              activeOpacity={0.75}
            >
              <View style={[styles.providerIcon, { backgroundColor: '#E9F8EF' }]}>
                <Text style={[styles.providerIconText, { color: '#1F9D55' }]}>Z</Text>
              </View>
              <Text style={styles.providerName}>{t('topup.mobileMoney.zaad')}</Text>
              <Text style={styles.providerSub}>{t('topup.mobileMoney.telesom')}</Text>
              {settlementProvider === 'zaad' && (
                <View style={[styles.providerCheck, { backgroundColor: '#1F9D55' }]}>
                  <Text style={styles.checkText}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.providerCard, settlementProvider === 'edahab' && styles.providerCardEdahab]}
              onPress={() => { triggerHaptic('light'); setSettlementProvider('edahab'); }}
              activeOpacity={0.75}
            >
              <View style={[styles.providerIcon, { backgroundColor: '#E8EEFF' }]}>
                <Text style={[styles.providerIconText, { color: '#FF5043' }]}>E</Text>
              </View>
              <Text style={styles.providerName}>{t('topup.mobileMoney.edahab')}</Text>
              <Text style={styles.providerSub}>{t('topup.mobileMoney.dahabshil')}</Text>
              {settlementProvider === 'edahab' && (
                <View style={[styles.providerCheck, { backgroundColor: '#FF5043' }]}>
                  <Text style={styles.checkText}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {settlementProvider && (
            <Card style={styles.phoneCard}>
              <Text style={styles.phoneHint}>
                {t('merchant.onboarding.settlementPhone', {
                  provider: settlementProvider === 'zaad'
                    ? t('topup.mobileMoney.zaad')
                    : t('topup.mobileMoney.edahab'),
                })}
              </Text>
              <View style={styles.phoneRow}>
                <View style={styles.prefixBox}>
                  <Text style={styles.prefixText}>{PHONE_PREFIX}</Text>
                </View>
                <TextInput
                  placeholder="XX XXX XXXX"
                  placeholderTextColor={colors.text.muted}
                  value={settlementPhone}
                  onChangeText={setSettlementPhone}
                  keyboardType="phone-pad"
                  style={styles.phoneInput}
                />
              </View>
            </Card>
          )}

          <Button
            title={t('merchant.onboarding.register')}
            onPress={handleSubmit}
            disabled={!settlementProvider || !settlementPhone.trim()}
            fullWidth
            style={styles.primaryCta}
          />
          <Button
            title={t('common.back')}
            onPress={() => setStep('address')}
            variant="secondary"
            fullWidth
            style={styles.secondaryCta}
          />
        </View>
      )}

      {step === 'submitting' && (
        <Card style={styles.processingCard}>
          <ActivityIndicator size="large" color={colors.action.primary} />
          <Text style={styles.processingText}>{t('merchant.onboarding.registering')}</Text>
        </Card>
      )}

      {step === 'success' && (
        <Card style={styles.successCard}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>{t('merchant.onboarding.successTitle')}</Text>
          <Text style={styles.successSubtitle}>{businessName}</Text>
          <Text style={styles.successDetail}>
            {businessTypeLabel(businessType)} · {businessAddress}
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
  stepTitle: {
    ...typography.bodyLarge,
    color: colors.dark.text,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  hint: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.md,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    paddingHorizontal: spacing.md,
    color: colors.dark.text,
    ...typography.body,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smPlus,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    backgroundColor: colors.dark.glass,
  },
  typeChipActive: {
    borderColor: colors.dark.accent,
    backgroundColor: colors.dark.accent,
  },
  typeChipText: {
    ...typography.body,
    color: colors.dark.text,
    fontWeight: '500',
  },
  typeChipTextActive: {
    color: '#FFFFFF',
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
  phoneCard: {
    marginTop: spacing.sm,
  },
  phoneHint: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.md,
  },
  phoneRow: {
    flexDirection: 'row',
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
  successSubtitle: {
    ...typography.bodyLarge,
    color: colors.dark.text,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  successDetail: {
    ...typography.body,
    color: colors.dark.textDim,
    marginTop: spacing.xs,
  },
});
