import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { functions } from '../../services/firebase.config';
import { useUserProfile } from '../../hooks/useUserProfile';
import { typography, spacing, borderRadius, makeStyles, useColors } from '../../theme';
import { GiftIcon } from '../../components/icons/UIIcons';
import { inviteMessage } from '../../utils/invite';

interface Stats {
  code: string;
  count: number;
  earnedCents: number;
}

interface Props {
  navigation: any;
}

export default function InviteScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const { profile } = useUserProfile();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  // Referral terms come from the admin console (getPricing), so the promise
  // here always matches what the backend will pay.
  const [terms, setTerms] = useState<{ referralUnlock: string; referralBonusCents: number; referralMinCashInCents: number } | null>(null);
  useEffect(() => {
    functions()
      .httpsCallable('getPricing')()
      .then((r) => setTerms((r.data as any)?.data ?? null))
      .catch(() => setTerms(null));
  }, []);
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const subtitle = !terms
    ? t('invite.subtitleGeneric')
    : terms.referralUnlock === 'off' || terms.referralBonusCents <= 0
      ? t('invite.subtitleGeneric')
      : terms.referralUnlock === 'kyc_verified'
        ? t('invite.subtitleKyc', { amount: money(terms.referralBonusCents) })
        : t('invite.subtitleCashIn', { amount: money(terms.referralBonusCents), min: money(terms.referralMinCashInCents) });

  useEffect(() => {
    functions()
      .httpsCallable('getReferralStats')({})
      .then((result) => {
        const response = result.data as { success: boolean; data: Stats };
        if (response.success) setStats(response.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const referralCode = stats?.code ?? profile?.referralCode ?? '';

  // In the app's language (en, so, ar), as Send money's invites are.
  const buildMessage = useCallback(() => inviteMessage(t, referralCode), [t, referralCode]);

  const handleWhatsApp = () => {
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(buildMessage())}`).catch(() => {});
  };

  const handleShare = () => {
    Share.share({ message: buildMessage() }).catch(() => {});
  };

  const handleCopy = useCallback(() => {
    if (!referralCode) return;
    Clipboard.setString(referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [referralCode]);

  const earnedDollars = ((stats?.earnedCents ?? 0) / 100).toFixed(2);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.illustrationWrap}>
        <GiftIcon size={64} color={colors.ui.accent} />
      </View>

      <Text style={styles.title}>{t('invite.title')}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {/* Referral code card */}
      <TouchableOpacity style={styles.codeCard} onPress={handleCopy} activeOpacity={0.75}>
        <Text style={styles.codeLabel}>{t('invite.yourCode')}</Text>
        <Text style={styles.code}>{referralCode || '—'}</Text>
        <View style={[styles.copyPill, copied && styles.copyPillDone]}>
          <Text style={styles.copyPillText}>{copied ? t('invite.copied') : t('invite.copy')}</Text>
        </View>
      </TouchableOpacity>

      {/* Pick people from the phone's contacts and invite each one directly */}
      <TouchableOpacity
        style={styles.contactsBtn}
        onPress={() => navigation.navigate('ContactPicker', { purpose: 'invite' })}
        activeOpacity={0.82}
        accessibilityRole="button"
      >
        <Text style={styles.contactsBtnText}>{t('invite.fromContacts')}</Text>
      </TouchableOpacity>

      {/* WhatsApp — share with anyone */}
      <TouchableOpacity style={styles.whatsappBtn} onPress={handleWhatsApp} activeOpacity={0.82}>
        <Text style={styles.whatsappText}>{t('invite.whatsapp')}</Text>
      </TouchableOpacity>

      {/* Native share — secondary */}
      <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.75}>
        <Text style={styles.shareBtnText}>{t('invite.share')}</Text>
      </TouchableOpacity>

      {/* Stats */}
      <View style={styles.statsCard}>
        <Text style={styles.statsTitle}>{t('invite.statsTitle')}</Text>
        {loading ? (
          <ActivityIndicator color={colors.ui.accent} style={{ marginTop: spacing.md }} />
        ) : (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats?.count ?? 0}</Text>
              <Text style={styles.statLabel}>{t('invite.friendsJoined')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>${earnedDollars}</Text>
              <Text style={styles.statLabel}>{t('invite.earned')}</Text>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  illustrationWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.ui.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.ui.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.ui.textDim,
    textAlign: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  codeCard: {
    width: '100%',
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  codeLabel: {
    ...typography.caption,
    color: colors.ui.textFaint,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 28,
    fontWeight: '700',
    color: colors.ui.text,
    letterSpacing: 5,
    marginBottom: spacing.md,
  },
  copyPill: {
    backgroundColor: colors.ui.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  copyPillDone: {
    backgroundColor: 'rgba(52,199,123,0.2)',
  },
  copyPillText: {
    ...typography.captionBold,
    color: colors.ui.accentText,
  },
  contactsBtn: {
    width: '100%',
    backgroundColor: colors.ui.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  contactsBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  whatsappBtn: {
    width: '100%',
    backgroundColor: '#25D366',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  whatsappText: {
    ...typography.bodySemibold,
    color: '#fff',
  },
  shareBtn: {
    width: '100%',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  shareBtnText: {
    ...typography.bodySemibold,
    color: colors.ui.textDim,
  },
  statsCard: {
    width: '100%',
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  statsTitle: {
    ...typography.captionBold,
    color: colors.ui.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    ...typography.h1,
    color: colors.ui.text,
  },
  statLabel: {
    ...typography.caption,
    color: colors.ui.textDim,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 48,
    backgroundColor: colors.ui.divider,
  },
}));
