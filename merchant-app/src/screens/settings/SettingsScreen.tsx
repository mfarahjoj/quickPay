import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { signOut } from '../../services/auth.service';
import { useMerchantProfile } from '../../hooks/useMerchantProfile';
import { useAuth } from '../../hooks/useAuth';
import {
  LanguageSelector,
  DarkScreen,
  ScreenHeader,
  GlassCard,
  ACCENT,
  TEXT_FAINT,
} from '../../components';

function roleLabel(type: string | undefined, t: (k: string) => string) {
  if (type === 'agent_merchant') return t('dashboard.role.both');
  if (type === 'topup_agent') return t('dashboard.role.agent');
  return t('dashboard.role.merchant');
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.rowValueMono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function TappableRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowChevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile } = useMerchantProfile();
  const navigation = useNavigation<StackNavigationProp<any>>();

  const isAgent =
    profile?.accountType === 'topup_agent' || profile?.accountType === 'agent_merchant';

  const handleLogout = () => {
    Alert.alert(t('settings.signOutConfirmTitle'), t('settings.signOutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const businessName = profile?.businessName || t('settings.merchantAccountFallback');
  const initial = (businessName || 'Q').charAt(0).toUpperCase();

  return (
    <DarkScreen scroll contentStyle={styles.content}>
      <ScreenHeader
        title={t('navigation.tabs.settings')}
        right={<LanguageSelector currentLanguage={profile?.preferredLanguage} compact dark />}
      />

      {/* Profile card */}
      <GlassCard style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
        <Text style={styles.merchantName}>{businessName}</Text>
        <Text style={styles.phone}>{user?.phoneNumber ?? '—'}</Text>
        <View style={styles.roleTag}>
          <Text style={styles.roleTagText}>{roleLabel(profile?.accountType, t)}</Text>
        </View>
      </GlassCard>

      {/* Account */}
      <Text style={styles.sectionLabel}>{t('settings.section.account')}</Text>
      <GlassCard style={styles.sectionCard}>
        <Row label={t('settings.phone')} value={user?.phoneNumber ?? '—'} />
        <View style={styles.divider} />
        <Row label={t('settings.uid')} value={user?.uid ?? '—'} mono />
        {profile?.email ? (
          <>
            <View style={styles.divider} />
            <Row label={t('settings.email')} value={profile.email} />
          </>
        ) : null}
      </GlassCard>

      {/* Agent profile */}
      {isAgent && (
        <>
          <Text style={styles.sectionLabel}>{t('settings.section.agent')}</Text>
          <GlassCard style={[styles.sectionCard, { paddingHorizontal: 16 }]}>
            <TappableRow
              label={t('settings.updateAgentProfile')}
              onPress={() => navigation.navigate('AgentProfileEdit')}
            />
          </GlassCard>
        </>
      )}

      {/* App */}
      <Text style={styles.sectionLabel}>{t('settings.section.app')}</Text>
      <GlassCard style={styles.sectionCard}>
        <Row label={t('settings.version')} value="1.0.0" />
      </GlassCard>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>{t('settings.signOut')}</Text>
      </TouchableOpacity>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 48,
  },

  profileCard: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 28,
    padding: 24,
    alignItems: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarInitial: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  merchantName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  phone: {
    fontSize: 15,
    color: TEXT_FAINT,
    marginBottom: 12,
  },
  roleTag: {
    backgroundColor: 'rgba(26,86,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(26,86,255,0.3)',
  },
  roleTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF8A7A',
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
    marginLeft: 28,
    marginBottom: 10,
  },
  sectionCard: {
    marginHorizontal: 20,
    marginBottom: 28,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 16,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    flexShrink: 1,
    textAlign: 'right',
  },
  rowValueMono: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.4)',
    maxWidth: 180,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  logoutBtn: {
    marginHorizontal: 20,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.3)',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FF6961',
  },
  rowChevron: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.25)',
    fontWeight: '300',
  },
});
