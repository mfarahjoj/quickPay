import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, ACCENT, TEXT_FAINT } from '../../components';
import { isAppLockEnabled, setAppLockEnabled } from '../../utils/appLock';

function LinkRow({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

/**
 * Settings → Security (review B7): the PIN, the app lock, and (as they
 * arrive) devices and Face ID, in one place.
 */
export default function SecurityScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [appLock, setAppLock] = useState(true);

  useEffect(() => {
    isAppLockEnabled().then(setAppLock);
  }, []);

  const toggleAppLock = async (on: boolean) => {
    setAppLock(on);
    await setAppLockEnabled(on).catch(() => setAppLock(!on));
  };

  return (
    <DarkScreen scroll contentStyle={styles.content}>
      <ScreenHeader title={t('security.title')} onBack={() => navigation.goBack()} />

      <Text style={styles.sectionLabel}>{t('security.section.pin')}</Text>
      <GlassCard style={styles.card}>
        <LinkRow label={t('security.change.title')} onPress={() => navigation.navigate('ChangePin')} />
        <View style={styles.divider} />
        <LinkRow
          label={t('security.reset.title')}
          hint={t('security.resetHint')}
          onPress={() => navigation.navigate('ResetPin')}
        />
      </GlassCard>

      <Text style={styles.sectionLabel}>{t('devices.title')}</Text>
      <GlassCard style={styles.card}>
        <LinkRow
          label={t('devices.manage')}
          hint={t('devices.securityDesc')}
          onPress={() => navigation.navigate('Devices')}
        />
      </GlassCard>

      <Text style={styles.sectionLabel}>{t('changePhone.title')}</Text>
      <GlassCard style={styles.card}>
        <LinkRow
          label={t('changePhone.title')}
          hint={t('changePhone.securityDesc')}
          onPress={() => navigation.navigate('ChangePhone')}
        />
      </GlassCard>

      <Text style={styles.sectionLabel}>{t('security.section.app')}</Text>
      <GlassCard style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('security.appLock')}</Text>
            <Text style={styles.rowHint}>{t('security.appLockHint')}</Text>
          </View>
          <Switch
            value={appLock}
            onValueChange={toggleAppLock}
            trackColor={{ true: ACCENT, false: 'rgba(255,255,255,0.15)' }}
            accessibilityLabel={t('security.appLock')}
          />
        </View>
      </GlassCard>

      <Text style={styles.footnote}>{t('security.footnote')}</Text>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
    marginLeft: 28,
    marginBottom: 10,
    marginTop: 8,
  },
  card: { marginHorizontal: 20, marginBottom: 24, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, gap: 16 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  rowHint: { fontSize: 13, color: TEXT_FAINT, marginTop: 3, lineHeight: 18 },
  chevron: { fontSize: 20, color: 'rgba(255,255,255,0.25)', fontWeight: '300' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)' },
  footnote: { fontSize: 13, color: TEXT_FAINT, marginHorizontal: 28, lineHeight: 19 },
});
