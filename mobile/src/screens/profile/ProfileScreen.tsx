import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useUserProfile } from '../../hooks/useUserProfile';
import { signOut } from '../../services/auth.service';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { ShieldIcon, ChartIcon } from '../../components/icons/AuthIcons';
import { IDCardIcon, LinkIcon, BellIcon, InfoIcon, QRSquareIcon, MoneyInIcon, GiftIcon } from '../../components/icons/UIIcons';
import type { KycStatus } from '../../types';

interface Props {
  navigation: any;
}

const KYC_LABEL_KEYS: Record<KycStatus, string> = {
  pending: 'kyc.status.pending',
  submitted: 'kyc.status.submitted',
  verified: 'kyc.status.verified',
  rejected: 'kyc.status.rejected',
};

function MenuItem({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <View style={styles.menuIconWrap}>{icon}</View>
      <Text style={[styles.menuText, danger && styles.menuTextDanger]}>
        {label}
      </Text>
      <Text style={styles.menuArrow}>›</Text>
    </TouchableOpacity>
  );
}

export default function ProfileScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert(t('profile.logOutTitle'), t('profile.logOutMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logOut'),
        style: 'destructive',
        onPress: performSignOut,
      },
    ]);
  };

  const performSignOut = async () => {
    try {
      setSigningOut(true);
      await signOut();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message ?? t('profile.failedLogOut'));
    } finally {
      setSigningOut(false);
    }
  };

  const initials = profile?.fullName
    ? profile.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?';

  const kycStatus = (profile?.kycStatus ?? 'pending') as KycStatus;

  const kycBadgeStyle =
    kycStatus === 'verified'
      ? styles.kycVerified
      : kycStatus === 'rejected'
        ? styles.kycRejected
        : kycStatus === 'submitted'
          ? styles.kycSubmitted
          : styles.kycPending;

  const accountTypeKey =
    profile?.accountType === 'merchant'
      ? 'profile.accountType.merchant'
      : 'profile.accountType.customer';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>{profile?.fullName ?? t('common.user')}</Text>
        <Text style={styles.phone}>
          {profile?.phoneNumber ?? user?.phoneNumber ?? ''}
        </Text>
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t(accountTypeKey)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.kycBadge, kycBadgeStyle]}
            onPress={() => navigation.navigate('KYC')}
          >
            <Text style={styles.kycText}>
              {t('profile.kycBadge', { status: t(KYC_LABEL_KEYS[kycStatus]) })}
            </Text>
          </TouchableOpacity>
        </View>
        {profile?.referralCode ? (
          <Text style={styles.referral}>
            {t('profile.referral', { code: profile.referralCode })}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={styles.editButton}
        onPress={() => navigation.navigate('EditProfile')}
      >
        <Text style={styles.editButtonText}>{t('profile.editProfile')}</Text>
      </TouchableOpacity>

      {profile?.accountType === 'merchant' && (
        <View style={styles.menu}>
          <MenuItem
            icon={<QRSquareIcon size={22} color={colors.dark.textDim} />}
            label={t('profile.myPaymentQr')}
            onPress={() => navigation.navigate('MerchantQR')}
          />
        </View>
      )}

      <View style={styles.menu}>
        <MenuItem
          icon={<GiftIcon size={22} color={colors.dark.accent} />}
          label={t('profile.invite')}
          onPress={() => navigation.navigate('Invite')}
        />
      </View>

      <View style={styles.menu}>
        <MenuItem
          icon={<ShieldIcon size={22} color={colors.dark.textDim} />}
          label={t('profile.security')}
          onPress={() => navigation.navigate('Security')}
        />
        <MenuItem
          icon={<IDCardIcon size={22} color={colors.dark.textDim} />}
          label={t('profile.identityVerification')}
          onPress={() => navigation.navigate('KYC')}
        />
        <MenuItem
          icon={<LinkIcon size={22} color={colors.dark.textDim} />}
          label={t('profile.linkedAccounts')}
          onPress={() => navigation.navigate('LinkedAccounts')}
        />
        <MenuItem
          icon={<ChartIcon size={22} color={colors.dark.textDim} />}
          label={t('profile.transactionLimits')}
          onPress={() => navigation.navigate('TransactionLimits')}
        />
      </View>

      <View style={styles.menu}>
        <MenuItem
          icon={<BellIcon size={22} color={colors.dark.textDim} />}
          label={t('profile.notifications')}
          onPress={() => navigation.navigate('Notifications')}
        />
        <MenuItem
          icon={<InfoIcon size={22} color={colors.dark.textDim} />}
          label={t('profile.aboutLegal')}
          onPress={() => navigation.navigate('About')}
        />
      </View>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={handleSignOut}
        disabled={signingOut}
      >
        {signingOut ? (
          <ActivityIndicator color={colors.dark.error} />
        ) : (
          <Text style={styles.signOutText}>{t('profile.logOut')}</Text>
        )}
      </TouchableOpacity>
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
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginBottom: spacing.sm,
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.dark.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    ...typography.h1,
    color: colors.dark.accentText,
  },
  name: {
    ...typography.h2,
    color: colors.dark.text,
    marginBottom: spacing.xs,
  },
  phone: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.dark.accentSoft,
    borderRadius: borderRadius.full,
  },
  badgeText: {
    ...typography.captionBold,
    color: colors.dark.accentText,
    textTransform: 'capitalize',
  },
  kycBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  kycVerified: { backgroundColor: colors.dark.incomingSoft },
  kycPending: { backgroundColor: colors.dark.warningSoft },
  kycSubmitted: { backgroundColor: colors.dark.warningSoft },
  kycRejected: { backgroundColor: colors.dark.errorSoft },
  kycText: {
    ...typography.captionBold,
    color: colors.dark.text,
  },
  referral: {
    ...typography.caption,
    color: colors.dark.textFaint,
    marginTop: spacing.xs,
  },
  editButton: {
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
  editButtonText: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },
  menu: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.divider,
  },
  menuIconWrap: {
    width: 24,
    height: 24,
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {
    flex: 1,
    ...typography.body,
    color: colors.dark.text,
  },
  menuTextDanger: {
    color: colors.dark.error,
  },
  menuArrow: {
    fontSize: 20,
    color: colors.dark.textFaint,
  },
  signOutButton: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  signOutText: {
    ...typography.bodySemibold,
    color: colors.dark.error,
  },
});
