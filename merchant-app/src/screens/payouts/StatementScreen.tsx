/**
 * Statement (plan 3.6, D11): a calendar month of transactions as CSV, shared
 * to WhatsApp, email or Files. getStatement builds it on the server, so the
 * columns and totals match what ops and accountants see.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton } from '../../components';
import { functions } from '../../services/firebase.config';
import { formatAmount } from '../../utils/money';
import { makeStyles, useColors } from '../../theme';

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
  const colors = useColors();
  const styles = useStyles();
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
      type Totals = { inCents: number; outCents: number; feeCents: number; count: number };
      const data = (res.data as any).data as { csv: string; totals: Totals; totalsSls?: Totals; truncated: boolean };
      // Dollars and shillings are never added together: one line each.
      const line = (x: Totals, currency: 'USD' | 'SLS') =>
        t('statement.summary', {
          count: x.count,
          in: formatAmount(x.inCents, currency),
          out: formatAmount(x.outCents, currency),
          fees: formatAmount(x.feeCents, currency),
        });
      setSummary(
        [line(data.totals, 'USD'), ...(data.totalsSls?.count ? [line(data.totalsSls, 'SLS')] : [])].join('\n')
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
        {busy ? <ActivityIndicator color={colors.ui.text} style={{ marginTop: 12 }} /> : null}
        <Text style={styles.hint}>{t('statement.hint')}</Text>
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  card: { paddingHorizontal: 16, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.ui.divider },
  rowText: { fontSize: 15, color: colors.ui.text },
  check: { fontSize: 16, color: colors.ui.incoming, fontWeight: '700' },
  summary: { fontSize: 14, color: colors.ui.textDim, marginTop: 16, lineHeight: 20 },
  export: { marginTop: 20 },
  hint: { fontSize: 12, color: colors.ui.textFaint, marginTop: 14, lineHeight: 17 },
}));
