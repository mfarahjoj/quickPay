import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { signOut } from '../../services/auth.service';

type MerchantRole = 'merchant' | 'topup_agent' | 'agent_merchant';

interface Props {
  variant: 'pending' | 'rejected';
  requestedRole?: MerchantRole;
  rejectionReason?: string;
  /** Rejected applicants can start a fresh application. */
  onApplyAgain?: () => void;
}

const ROLE_LABEL_KEY: Record<MerchantRole, string> = {
  merchant: 'dashboard.role.merchant',
  topup_agent: 'dashboard.role.agent',
  agent_merchant: 'dashboard.role.both',
};

/**
 * Terminal screen for an application awaiting (or refused) admin review.
 *
 * There is nothing to navigate to: the gate watches the user document, so an
 * approval swaps this screen for the app on its own, with no refresh needed.
 */
export default function RoleReviewPendingScreen({
  variant,
  requestedRole,
  rejectionReason,
  onApplyAgain,
}: Props) {
  const { t } = useTranslation();
  const rejected = variant === 'rejected';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <View style={styles.glowContainer} pointerEvents="none">
        <View style={[styles.glowCore, rejected && styles.glowCoreMuted]} />
        <View style={[styles.glowOuter, rejected && styles.glowOuterMuted]} />
      </View>

      <View style={styles.content}>
        <View style={styles.center}>
          <Text style={styles.emoji}>{rejected ? '🚫' : '⏳'}</Text>

          <Text style={styles.title}>
            {rejected
              ? t('auth.onboarding.review.rejectedTitle')
              : t('auth.onboarding.review.pendingTitle')}
          </Text>

          <Text style={styles.body}>
            {rejected
              ? t('auth.onboarding.review.rejectedBody')
              : t('auth.onboarding.review.pendingBody')}
          </Text>

          {!!requestedRole && (
            <View style={styles.rolePill}>
              <Text style={styles.rolePillLabel}>
                {t('auth.onboarding.review.appliedFor')}
              </Text>
              <Text style={styles.rolePillValue}>{t(ROLE_LABEL_KEY[requestedRole])}</Text>
            </View>
          )}

          {rejected && !!rejectionReason && (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonLabel}>
                {t('auth.onboarding.review.reasonLabel')}
              </Text>
              <Text style={styles.reasonText}>{rejectionReason}</Text>
            </View>
          )}

          {!rejected && (
            <Text style={styles.hint}>{t('auth.onboarding.review.pendingHint')}</Text>
          )}
        </View>

        <View style={styles.actions}>
          {rejected && !!onApplyAgain && (
            <TouchableOpacity style={styles.primaryBtn} onPress={onApplyAgain}>
              <Text style={styles.primaryBtnText}>
                {t('auth.onboarding.review.applyAgain')}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.ghostBtn} onPress={signOut}>
            <Text style={styles.ghostBtnText}>{t('settings.signOut')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  glowContainer: {
    position: 'absolute',
    bottom: '20%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowCore: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#FF5043',
    opacity: 0.1,
  },
  glowCoreMuted: { backgroundColor: '#6B7280' },
  glowOuter: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: '#FF5043',
    opacity: 0.04,
  },
  glowOuterMuted: { backgroundColor: '#6B7280' },

  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  emoji: { fontSize: 56, marginBottom: 24 },

  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.62)',
    textAlign: 'center',
    maxWidth: 320,
  },

  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  rolePillLabel: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  rolePillValue: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },

  reasonBox: {
    marginTop: 24,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    maxWidth: 340,
  },
  reasonLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 6,
  },
  reasonText: { fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.8)' },

  hint: {
    marginTop: 20,
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    maxWidth: 300,
  },

  actions: { paddingBottom: 24, gap: 12 },
  primaryBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: '#FF5043',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  ghostBtn: { height: 50, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.55)' },
});
