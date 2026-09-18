import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { triggerHaptic } from '../../services/haptics.service';
import { colors } from '../../theme';

interface Method {
  key: string;
  route: string;
  titleKey: string;
  subtitleKey: string;
  glyph: string;
}

// Zaad/eDahab top-up is deliberately absent: `functions/src/integrations/` are
// sandbox stubs that fake success, and the callable behind this entry credited
// a wallet on that fake success. It was deleted from prod on 2026-09-18, so the
// row could only lead to an error. It comes back when a real rail does.
const METHODS: Method[] = [
  {
    key: 'agent',
    route: 'AgentTopup',
    titleKey: 'topup.method.agentTitle',
    subtitleKey: 'topup.method.agentSubtitle',
    glyph: '🧑‍💼',
  },
];

export default function TopUpMethodScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>{t('topup.method.title')}</Text>
          <Text style={styles.headerSub}>{t('topup.method.subtitle')}</Text>
        </View>
      </View>

      <View style={styles.list}>
        {METHODS.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => {
              triggerHaptic('light');
              navigation.navigate(m.route);
            }}
          >
            <View style={styles.cardIcon}>
              <Text style={styles.cardGlyph}>{m.glyph}</Text>
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{t(m.titleKey)}</Text>
              <Text style={styles.cardSubtitle}>{t(m.subtitleKey)}</Text>
            </View>
            <Text style={styles.cardArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 24, color: '#FFFFFF', lineHeight: 28 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  list: { paddingHorizontal: 20, gap: 12, marginTop: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    padding: 18,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,138,122,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardGlyph: { fontSize: 24 },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  cardSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 3, lineHeight: 18 },
  cardArrow: { fontSize: 26, color: 'rgba(255,255,255,0.35)', fontWeight: '300' },
});
