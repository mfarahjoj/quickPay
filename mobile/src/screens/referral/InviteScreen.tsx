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
import { colors, typography, spacing, borderRadius } from '../../theme';
import { GiftIcon } from '../../components/icons/UIIcons';

interface Stats {
  code: string;
  count: number;
  earnedCents: number;
}

interface Props {
  navigation: any;
}

export default function InviteScreen({ navigation: _navigation }: Props) {
  const { t } = useTranslation();
  const { profile } = useUserProfile();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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

  const buildMessage = useCallback(() => {
    const lang = profile?.preferredLanguage ?? 'en';
    if (lang === 'so') {
      return `💰 Waxaan isticmaalayaa Zapp Pay – hab ugu dhakhsaha badan ee lacagta lagu diro Hargeysa!\nKu biir adigoo isticmaalaya lambarkeyga *${referralCode}* midna waxaan heli doonnaa $1 bilaash ah 🎉\nSoo dajiso Zapp Pay oo geli lambarkeyga markaad is diiwaangaliso.`;
    }
    return `💰 I use Zapp Pay – the fastest way to send & receive money in Hargeisa!\nJoin with my code *${referralCode}* and we both get $1 free 🎉\nDownload Zapp Pay and enter my code when you sign up.`;
  }, [referralCode, profile?.preferredLanguage]);

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
        <GiftIcon size={64} color={colors.dark.accent} />
      </View>

      <Text style={styles.title}>{t('invite.title')}</Text>
      <Text style={styles.subtitle}>{t('invite.subtitle')}</Text>

      {/* Referral code card */}
      <TouchableOpacity style={styles.codeCard} onPress={handleCopy} activeOpacity={0.75}>
        <Text style={styles.codeLabel}>{t('invite.yourCode')}</Text>
        <Text style={styles.code}>{referralCode || '—'}</Text>
        <View style={[styles.copyPill, copied && styles.copyPillDone]}>
          <Text style={styles.copyPillText}>{copied ? t('invite.copied') : t('invite.copy')}</Text>
        </View>
      </TouchableOpacity>

      {/* WhatsApp — primary CTA */}
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
          <ActivityIndicator color={colors.dark.accent} style={{ marginTop: spacing.md }} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
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
    backgroundColor: colors.dark.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.dark.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.dark.textDim,
    textAlign: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  codeCard: {
    width: '100%',
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  codeLabel: {
    ...typography.caption,
    color: colors.dark.textFaint,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 28,
    fontWeight: '700',
    color: colors.dark.text,
    letterSpacing: 5,
    marginBottom: spacing.md,
  },
  copyPill: {
    backgroundColor: colors.dark.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  copyPillDone: {
    backgroundColor: 'rgba(52,199,123,0.2)',
  },
  copyPillText: {
    ...typography.captionBold,
    color: colors.dark.accentText,
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
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  shareBtnText: {
    ...typography.bodySemibold,
    color: colors.dark.textDim,
  },
  statsCard: {
    width: '100%',
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  statsTitle: {
    ...typography.captionBold,
    color: colors.dark.textFaint,
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
    color: colors.dark.text,
  },
  statLabel: {
    ...typography.caption,
    color: colors.dark.textDim,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 48,
    backgroundColor: colors.dark.divider,
  },
});
