/**
 * Statement (plan 3.6, D11): a calendar month of transactions as CSV, shared
 * to WhatsApp, email or Files. getStatement builds it on the server, so the
 * columns and totals match what ops and accountants see.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton, TEXT_DIM, TEXT_FAINT } from '../../components';
import { functions } from '../../services/firebase.config';
import { formatCents } from '../../utils/money';

/** The last six calendar months, newest first, as [start, end) in local time. */
function months(count = 6) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    return { start, end, label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
  });
}

export default function StatementScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const options = months();
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const exportCsv = async () => {
    const m = options[selected];
    setBusy(true);
    setSummary(null);
    try {
      const res = await functions().httpsCallable('getStatement')({ fromMs: m.start.getTime(), toMs: m.end.getTime() });
      const data = (res.data as any).data as { csv: string; totals: { inCents: number; outCents: number; feeCents: number; count: number }; truncated: boolean };
      setSummary(
        t('statement.summary', {
          count: data.totals.count,
          in: formatCents(data.totals.inCents),
          out: formatCents(data.totals.outCents),
          fees: formatCents(data.totals.feeCents),
        })
      );
      await Share.share({ title: t('statement.shareTitle', { month: m.label }), message: data.csv });
      if (data.truncated) Alert.alert(t('statement.truncatedTitle'), t('statement.truncated'));
    } catch {
      Alert.alert(t('common.error'), t('statement.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DarkScreen scroll>
      <ScreenHeader title={t('statement.title')} subtitle={t('statement.subtitle')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <GlassCard style={styles.card}>
          {options.map((m, i) => (
            <TouchableOpacity
              key={m.label}
              style={[styles.row, i < options.length - 1 && styles.rowBorder]}
              onPress={() => setSelected(i)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === i }}
            >
              <Text style={styles.rowText}>{m.label}</Text>
              {selected === i ? <Text style={styles.check}>✓</Text> : null}
            </TouchableOpacity>
          ))}
        </GlassCard>
        {summary ? <Text style={styles.summary}>{summary}</Text> : null}
        <PillButton style={styles.export} label={t('statement.export')} onPress={exportCsv} loading={busy} />
        {busy ? <ActivityIndicator color="#FFFFFF" style={{ marginTop: 12 }} /> : null}
        <Text style={styles.hint}>{t('statement.hint')}</Text>
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  card: { paddingHorizontal: 16, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  rowText: { fontSize: 15, color: '#FFFFFF' },
  check: { fontSize: 16, color: '#34C77B', fontWeight: '700' },
  summary: { fontSize: 14, color: TEXT_DIM, marginTop: 16, lineHeight: 20 },
  export: { marginTop: 20 },
  hint: { fontSize: 12, color: TEXT_FAINT, marginTop: 14, lineHeight: 17 },
});
