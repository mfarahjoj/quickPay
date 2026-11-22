import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Modal, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { signOut, deleteAccount, deleteAccountErrorKey } from '../../services/auth.service';
import { PinInput } from '../../components/PinInput';
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

  const [showDelete, setShowDelete] = useState(false);
  const [pin, setPin] = useState('');
  const [deleting, setDeleting] = useState(false);

  const closeDelete = () => {
    if (deleting) return;
    setShowDelete(false);
    setPin('');
  };

  const handleDeleteAccount = () => {
    Alert.alert(t('settings.deleteConfirmTitle'), t('settings.deleteConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteAccount'),
        style: 'destructive',
        onPress: () => setShowDelete(true),
      },
    ]);
  };

  const confirmDelete = async () => {
    if (pin.length !== 6 || deleting) return;
    setDeleting(true);
    try {
      await deleteAccount(pin);
      // deleteAccount signs out, which swaps this whole navigator away.
      Alert.alert(t('settings.deletedTitle'), t('settings.deletedMessage'));
    } catch (err: any) {
      setPin('');
      Alert.alert(t('common.error'), t(deleteAccountErrorKey(err)));
    } finally {
      setDeleting(false);
    }
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
          <Text style={styles.sectionLabel}>Agent</Text>
          <GlassCard style={[styles.sectionCard, { paddingHorizontal: 16 }]}>
            <TappableRow
              label="Update Agent Profile"
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

      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={handleDeleteAccount}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <Text style={styles.deleteText}>{t('settings.deleteAccount')}</Text>
      </TouchableOpacity>

      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={closeDelete}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('settings.deleteAccount')}</Text>
            <Text style={styles.modalPrompt}>{t('settings.enterPinDelete')}</Text>
            <PinInput value={pin} onChange={setPin} />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeDelete}
                disabled={deleting}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, (pin.length !== 6 || deleting) && styles.modalConfirmOff]}
                onPress={confirmDelete}
                disabled={pin.length !== 6 || deleting}
                activeOpacity={0.8}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>{t('settings.confirmDelete')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  deleteBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#15171C',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 8 },
  modalPrompt: { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 16 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalCancel: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  modalConfirm: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FF3B30',
  },
  modalConfirmOff: { opacity: 0.4 },
  modalConfirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  rowChevron: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.25)',
    fontWeight: '300',
  },
});
