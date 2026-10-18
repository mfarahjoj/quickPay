import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { colors, typography, spacing } from '../../theme';
import {
  listMyDevices,
  removeMyDevice,
  renameMyDevice,
  thisDeviceId,
  TrustedDevice,
} from '../../services/devices.service';
import { clearDeviceCredential } from '../../services/device.service';
import { logger } from '../../utils/logger';

/**
 * Security → Trusted phones (review C9): the phones that can sign in with
 * the PIN instead of an SMS code. Rename one, or remove one you don't
 * recognise; removing also signs every other phone out.
 */
export default function DevicesScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const [list, own] = await Promise.all([listMyDevices(), thisDeviceId()]);
      setDevices(list);
      setMine(own);
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

  const remove = (d: TrustedDevice) => {
    const isMine = d.deviceId === mine;
    Alert.alert(
      t('devices.removeTitle', { name: label(d) }),
      t(isMine ? 'devices.removeThisMessage' : 'devices.removeMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('devices.remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(d.deviceId);
              await removeMyDevice(d.deviceId);
              if (isMine) await clearDeviceCredential();
              await load();
            } catch {
              Alert.alert(t('common.error'), t('devices.removeFailed'));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <Header title={t('devices.title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('devices.intro')}</Text>
        {devices === null ? (
          <ActivityIndicator color={colors.dark.text} style={styles.spinner} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : devices.length === 0 ? (
          <Text style={styles.empty}>{t('devices.empty')}</Text>
        ) : (
          devices.map((d) => (
            <View key={d.deviceId} style={styles.card}>
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
                <View style={styles.titleRow}>
                  <Text style={styles.name}>{label(d)}</Text>
                  {d.deviceId === mine ? <Text style={styles.badge}>{t('devices.thisPhone')}</Text> : null}
                </View>
              )}
              <Text style={styles.meta}>
                {t('devices.lastUsed', { date: when(d.lastUsedAt) })} · {t('devices.added', { date: when(d.createdAt) })}
              </Text>
              {busy === d.deviceId ? (
                <ActivityIndicator color={colors.dark.text} style={styles.rowSpinner} />
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
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { ...typography.body, color: colors.dark.textDim, marginBottom: spacing.lg },
  spinner: { marginTop: spacing.xl },
  rowSpinner: { marginTop: spacing.md, alignSelf: 'flex-start' },
  error: { ...typography.body, color: colors.dark.error },
  empty: { ...typography.body, color: colors.dark.textFaint },
  card: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.bodySemibold, color: colors.dark.text },
  badge: {
    ...typography.caption,
    color: colors.dark.accentText,
    backgroundColor: colors.dark.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  nameInput: {
    ...typography.bodySemibold,
    color: colors.dark.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.divider,
    paddingVertical: 4,
  },
  meta: { ...typography.caption, color: colors.dark.textFaint, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md },
  action: { ...typography.bodySemibold, color: colors.dark.accentText },
  danger: { color: colors.dark.error },
});
