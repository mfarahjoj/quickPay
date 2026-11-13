import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton, TEXT_DIM, TEXT_FAINT } from '../../components';
import { useCounterDisplayOn } from '../../hooks/useCounterDisplayOn';
import {
  CounterDisplay,
  listMyDisplays,
  renameDisplay,
  unlinkDisplay,
} from '../../services/counterDisplay.service';
import { logger } from '../../utils/logger';

const GREEN = '#34C77B';

/**
 * Settings → Counter display: the tablets linked to this shop. Rename one,
 * or unlink one that's lost; linking a new one starts LinkDisplayScreen.
 */
export default function CounterDisplaysScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { url } = useCounterDisplayOn();
  const [displays, setDisplays] = useState<CounterDisplay[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setDisplays(await listMyDisplays());
    } catch (err) {
      logger.error('List displays failed:', err);
      setError(t('counterDisplay.loadFailed'));
      setDisplays([]);
    }
  }, [t]);

  // Back from linking one, the list is fresh.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const when = (ms: number | null) =>
    ms ? new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  const saveName = async (d: CounterDisplay) => {
    const name = draft.trim();
    setEditing(null);
    if (!name || name === d.name) return;
    try {
      setBusy(d.displayId);
      await renameDisplay(d.displayId, name);
      await load();
    } catch {
      Alert.alert(t('common.error'), t('counterDisplay.renameFailed'));
    } finally {
      setBusy(null);
    }
  };

  const unlink = (d: CounterDisplay) =>
    Alert.alert(t('counterDisplay.unlinkTitle', { name: d.name }), t('counterDisplay.unlinkMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('counterDisplay.unlink'),
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(d.displayId);
            await unlinkDisplay(d.displayId);
            await load();
          } catch {
            Alert.alert(t('common.error'), t('counterDisplay.unlinkFailed'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const status = (d: CounterDisplay) => {
    if (d.status === 'pending_confirm') return { text: t('counterDisplay.waitingConfirm'), color: TEXT_FAINT };
    if (d.online) return { text: t('counterDisplay.online'), color: GREEN };
    return { text: t('counterDisplay.offline'), color: TEXT_FAINT };
  };

  return (
    <DarkScreen scroll keyboard contentStyle={styles.content}>
      <ScreenHeader title={t('counterDisplay.title')} onBack={() => navigation.goBack()} />
      <Text style={styles.intro}>{t('counterDisplay.intro')}</Text>
      {url ? (
        <Text style={styles.url} selectable>
          {t('counterDisplay.openOnTablet', { url })}
        </Text>
      ) : null}

      {displays === null ? (
        <ActivityIndicator color="#FFFFFF" style={styles.spinner} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : displays.length === 0 ? (
        <Text style={styles.empty}>{t('counterDisplay.empty')}</Text>
      ) : (
        displays.map((d) => {
          const s = status(d);
          return (
            <GlassCard key={d.displayId} style={styles.card}>
              {editing === d.displayId ? (
                <TextInput
                  style={styles.nameInput}
                  value={draft}
                  onChangeText={setDraft}
                  autoFocus
                  maxLength={40}
                  returnKeyType="done"
                  onSubmitEditing={() => saveName(d)}
                  onBlur={() => saveName(d)}
                  accessibilityLabel={t('counterDisplay.rename')}
                />
              ) : (
                <Text style={styles.name}>{d.name}</Text>
              )}
              <View style={styles.statusRow}>
                <View style={[styles.dot, { backgroundColor: s.color }]} />
                <Text style={[styles.meta, { color: s.color }]}>{s.text}</Text>
                {d.status === 'active' && !d.online && d.lastSeenAtMs ? (
                  <Text style={styles.meta}> · {t('counterDisplay.lastSeen', { time: when(d.lastSeenAtMs) })}</Text>
                ) : null}
              </View>
              {busy === d.displayId ? (
                <ActivityIndicator color="#FFFFFF" style={styles.rowSpinner} />
              ) : (
                <View style={styles.actions}>
                  <TouchableOpacity
                    onPress={() => {
                      setDraft(d.name);
                      setEditing(d.displayId);
                    }}
                  >
                    <Text style={styles.action}>{t('counterDisplay.rename')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => unlink(d)}>
                    <Text style={[styles.action, styles.danger]}>{t('counterDisplay.unlink')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </GlassCard>
          );
        })
      )}

      <View style={styles.linkBtn}>
        <PillButton label={t('counterDisplay.link')} onPress={() => navigation.navigate('LinkDisplay')} />
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  intro: { fontSize: 15, color: TEXT_DIM, lineHeight: 21, marginHorizontal: 24, marginBottom: 12 },
  url: { fontSize: 15, color: '#FFFFFF', fontWeight: '600', marginHorizontal: 24, marginBottom: 20 },
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
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  meta: { fontSize: 13, color: TEXT_FAINT },
  actions: { flexDirection: 'row', gap: 28, marginTop: 12 },
  action: { fontSize: 15, fontWeight: '600', color: '#FF8A7A' },
  danger: { color: '#FF6961' },
  linkBtn: { marginHorizontal: 20, marginTop: 20 },
});
