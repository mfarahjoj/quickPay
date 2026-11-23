import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton } from '../../components';
import { listPortalSessions, PortalSessionSummary, revokePortalSession } from '../../services/portal.service';
import { logger } from '../../utils/logger';
import { makeStyles, useColors } from '../../theme';

/** Where the dashboard lives. */
export const ZAPP_BUSINESS_URL = 'zapp-business.web.app';

/**
 * Settings → Zapp Business: the shop's live figures on a computer. Sign a
 * computer in by scanning the code it shows; see which computers are
 * signed in, and sign any of them out.
 */
export default function ZappBusinessScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [sessions, setSessions] = useState<PortalSessionSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setSessions(await listPortalSessions());
    } catch (err) {
      logger.error('List web sessions failed:', err);
      setError(t('portal.loadFailed'));
      setSessions([]);
    }
  }, [t]);

  // Back from signing one in, the list is fresh.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const when = (ms: number) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const signOut = (target: PortalSessionSummary | 'all') =>
    Alert.alert(
      target === 'all' ? t('portal.signOutAllTitle') : t('portal.signOutTitle', { browser: target.browser }),
      t('portal.signOutMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('portal.signOut'),
          style: 'destructive',
          onPress: async () => {
            const id = target === 'all' ? 'all' : target.sessionId;
            try {
              setBusy(id);
              await revokePortalSession(id);
              await load();
            } catch {
              Alert.alert(t('common.error'), t('portal.signOutFailed'));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );

  return (
    <DarkScreen scroll contentStyle={styles.content}>
      <ScreenHeader title={t('portal.title')} onBack={() => navigation.goBack()} />
      <Text style={styles.intro}>{t('portal.intro')}</Text>
      <Text style={styles.url} selectable>
        {t('portal.openOnComputer', { url: ZAPP_BUSINESS_URL })}
      </Text>
      <Text style={styles.readOnly}>{t('portal.readOnly')}</Text>

      <Text style={styles.sectionLabel}>{t('portal.signedIn')}</Text>
      {sessions === null ? (
        <ActivityIndicator color={colors.ui.text} style={styles.spinner} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : sessions.length === 0 ? (
        <Text style={styles.empty}>{t('portal.none')}</Text>
      ) : (
        sessions.map((s) => (
          <GlassCard key={s.sessionId} style={styles.card}>
            <Text style={styles.name}>{s.browser}</Text>
            {s.signedInBy ? (
              <Text style={styles.meta}>{t('portal.signedInBy', { name: s.signedInBy.name })}</Text>
            ) : null}
            <Text style={styles.meta}>
              {t('portal.since', { time: when(s.createdAtMs) })} · {t('portal.until', { time: when(s.expiresAtMs) })}
            </Text>
            {busy === s.sessionId ? (
              <ActivityIndicator color={colors.ui.text} style={styles.rowSpinner} />
            ) : (
              <TouchableOpacity onPress={() => signOut(s)} style={styles.actionWrap}>
                <Text style={styles.action}>{t('portal.signOut')}</Text>
              </TouchableOpacity>
            )}
          </GlassCard>
        ))
      )}

      <View style={styles.buttons}>
        <PillButton label={t('portal.signInButton')} onPress={() => navigation.navigate('PortalSignIn')} />
        {sessions && sessions.length > 1 ? (
          <>
            <View style={styles.gap} />
            <PillButton label={t('portal.signOutAll')} variant="glass" disabled={busy !== null} onPress={() => signOut('all')} />
          </>
        ) : null}
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { paddingBottom: 48 },
  intro: { fontSize: 15, color: colors.ui.textDim, lineHeight: 21, marginHorizontal: 24, marginBottom: 12 },
  url: { fontSize: 15, color: colors.ui.text, fontWeight: '600', marginHorizontal: 24, marginBottom: 12 },
  readOnly: { fontSize: 14, color: colors.ui.textFaint, lineHeight: 20, marginHorizontal: 24, marginBottom: 20 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ui.textFaint,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: 24,
    marginBottom: 10,
  },
  spinner: { marginTop: 24 },
  rowSpinner: { marginTop: 12, alignSelf: 'flex-start' },
  error: { fontSize: 14, color: colors.ui.error, marginHorizontal: 24 },
  empty: { fontSize: 15, color: colors.ui.textFaint, marginHorizontal: 24, lineHeight: 21 },
  card: { marginHorizontal: 20, marginBottom: 12, padding: 16 },
  name: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  meta: { fontSize: 13, color: colors.ui.textFaint, marginTop: 6 },
  actionWrap: { marginTop: 12, alignSelf: 'flex-start' },
  action: { fontSize: 15, fontWeight: '600', color: colors.ui.error },
  buttons: { marginHorizontal: 20, marginTop: 20 },
  gap: { height: 12 },
}));
