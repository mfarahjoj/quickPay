import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, TEXT_DIM, TEXT_FAINT } from '../../components';
import { listMyDevices, removeMyDevice, renameMyDevice, TrustedDevice } from '../../services/devices.service';
import { logger } from '../../utils/logger';

/**
 * Security → Trusted phones (review C9): phones that can sign in to this
 * account with the PIN. Rename one, or remove one you don't recognise;
 * removing also signs every other phone out.
 */
export default function DevicesScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setDevices(await listMyDevices());
    } catch (err) {
      logger.error('List devices failed:', err);
      setError(t('devices.loadFailed'));
      setDevices([]);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const label = (d: TrustedDevice) =>
    d.name || (d.platform === 'ios' ? t('devices.iphone') : d.platform === 'android' ? t('devices.android') : t('devices.phone'));
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const saveName = async (d: TrustedDevice) => {
    const name = draft.trim();
    setEditing(null);
    if (!name || name === d.name) return;
    try {
      setBusy(d.deviceId);
      await renameMyDevice(d.deviceId, name);
      await load();
    } catch {
      Alert.alert(t('common.error'), t('devices.renameFailed'));
    } finally {
      setBusy(null);
    }
  };

  const remove = (d: TrustedDevice) =>
    Alert.alert(t('devices.removeTitle', { name: label(d) }), t('devices.removeMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('devices.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(d.deviceId);
            await removeMyDevice(d.deviceId);
            await load();
          } catch {
            Alert.alert(t('common.error'), t('devices.removeFailed'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  return (
    <DarkScreen scroll keyboard contentStyle={styles.content}>
      <ScreenHeader title={t('devices.title')} onBack={() => navigation.goBack()} />
      <Text style={styles.intro}>{t('devices.intro')}</Text>
      {devices === null ? (
        <ActivityIndicator color="#FFFFFF" style={styles.spinner} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : devices.length === 0 ? (
        <Text style={styles.empty}>{t('devices.empty')}</Text>
      ) : (
        devices.map((d) => (
          <GlassCard key={d.deviceId} style={styles.card}>
            {editing === d.deviceId ? (
              <TextInput
                style={styles.nameInput}
                value={draft}
                onChangeText={setDraft}
                autoFocus
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={() => saveName(d)}
                onBlur={() => saveName(d)}
                accessibilityLabel={t('devices.rename')}
              />
            ) : (
              <Text style={styles.name}>{label(d)}</Text>
            )}
            <Text style={styles.meta}>
              {t('devices.lastUsed', { date: when(d.lastUsedAt) })} · {t('devices.added', { date: when(d.createdAt) })}
            </Text>
            {busy === d.deviceId ? (
              <ActivityIndicator color="#FFFFFF" style={styles.rowSpinner} />
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={() => {
                    setDraft(d.name ?? '');
                    setEditing(d.deviceId);
                  }}
                >
                  <Text style={styles.action}>{t('devices.rename')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => remove(d)}>
                  <Text style={[styles.action, styles.danger]}>{t('devices.remove')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </GlassCard>
        ))
      )}
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  intro: { fontSize: 15, color: TEXT_DIM, lineHeight: 21, marginHorizontal: 24, marginBottom: 20 },
  spinner: { marginTop: 24 },
  rowSpinner: { marginTop: 12, alignSelf: 'flex-start' },
  error: { fontSize: 14, color: '#FF6961', marginHorizontal: 24 },
  empty: { fontSize: 15, color: TEXT_FAINT, marginHorizontal: 24, lineHeight: 21 },
  card: { marginHorizontal: 20, marginBottom: 12, padding: 16 },
  name: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  nameInput: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 4,
  },
  meta: { fontSize: 13, color: TEXT_FAINT, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 28, marginTop: 12 },
  action: { fontSize: 15, fontWeight: '600', color: '#FF8A7A' },
  danger: { color: '#FF6961' },
});
