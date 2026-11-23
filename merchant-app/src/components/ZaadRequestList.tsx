/**
 * An agent's Zaad top-ups, grouped by what they must do (D32): offers ringing
 * now (a queue, each with its own timer), Check your Zaad, Waiting for
 * customer, In review, Done today, and Earlier. Each row shows Zapp's
 * reference, the amount, the customer's first name, the masked number they
 * pay from, and the time left. Tapping a row opens it.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GlassCard, PillButton } from './DarkScreen';
import { formatCents } from '../utils/money';
import { maskMsisdn, type ZaadTopupRow } from '../services/zaadAgent.service';
import type { ZaadAgentRequests } from '../hooks/useZaadAgentRequests';
import { makeStyles, useColors } from '../theme';

/** The brand's attention colour, as on the dashboard's "needs reply" banner. */

/** One ticking clock for every row on screen. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The deadline that matters for a row in this status. */
function deadline(r: ZaadTopupRow): { toMillis(): number } | null | undefined {
  if (r.status === 'offered') return r.offerExpiresAt;
  if (r.status === 'accepted') return r.sendBy;
  if (r.status === 'customer_sent') return r.confirmBy;
  return null;
}

function Row({
  row,
  now,
  onPress,
  urgent,
}: {
  row: ZaadTopupRow;
  now: number;
  onPress: () => void;
  urgent?: boolean;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const at = deadline(row);
  const left = at ? Math.max(0, Math.round((at.toMillis() - now) / 1000)) : null;
  const sender = row.allowedSenders?.[0];
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      <GlassCard style={[styles.row, urgent && styles.rowUrgent]}>
        <View style={styles.rowMain}>
          <Text style={styles.rowAmount}>{formatCents(row.amount)}</Text>
          <Text style={styles.rowWho} numberOfLines={1}>
            {row.customerFirstName}
            {sender ? ` · ${maskMsisdn(sender)}` : ''}
          </Text>
          {row.reference ? <Text style={styles.rowRef}>{row.reference}</Text> : null}
        </View>
        <View style={styles.rowSide}>
          {left !== null ? (
            <Text style={[styles.rowTime, urgent && { color: colors.ui.warning }]}>{clock(left)}</Text>
          ) : (
            <Text style={styles.rowStatus}>
              {t(`zaadTopups.list.status.${row.status}`, { defaultValue: row.status })}
            </Text>
          )}
          <Text style={styles.chevron}>›</Text>
        </View>
      </GlassCard>
    </TouchableOpacity>
  );
}

function Section({ title, count, color, children }: { title: string; count: number; color?: string; children: React.ReactNode }) {
  const styles = useStyles();
  if (count === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, color ? { color } : null]}>
        {title} · {count}
      </Text>
      {children}
    </View>
  );
}

export function ZaadRequestList({
  data,
  onOpen,
  onAnswer,
  busy,
}: {
  data: ZaadAgentRequests;
  onOpen: (id: string) => void;
  /** Accept or decline an offer straight from the queue. */
  onAnswer: (id: string, accept: boolean) => void;
  busy: boolean;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const now = useNow();
  const nothing =
    data.offers.length + data.toCheck.length + data.waiting.length + data.inReview.length + data.doneToday.length + data.earlier.length === 0;

  return (
    <View style={styles.list}>
      {/* Several offers at once: a queue, not stacked pop-ups. */}
      <Section title={t('zaadTopups.list.offers')} count={data.offers.length} color={colors.ui.warning}>
        {data.offers.map((row) => {
          const left = Math.max(0, Math.round(((row.offerExpiresAt?.toMillis() ?? 0) - now) / 1000));
          return (
            <GlassCard key={row.id} style={[styles.offer, styles.rowUrgent]}>
              <View style={styles.offerTop}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowAmount}>{formatCents(row.amount)}</Text>
                  <Text style={styles.rowWho}>{row.customerFirstName}</Text>
                  {row.reference ? <Text style={styles.rowRef}>{row.reference}</Text> : null}
                </View>
                <Text style={[styles.rowTime, { color: colors.ui.warning }]}>{clock(left)}</Text>
              </View>
              <View style={styles.offerButtons}>
                <View style={styles.flex}>
                  <PillButton
                    label={t('zaadTopups.offer.accept')}
                    onPress={() => onAnswer(row.id, true)}
                    disabled={busy || left === 0}
                  />
                </View>
                <View style={styles.flex}>
                  <PillButton label={t('zaadTopups.offer.decline')} variant="glass" onPress={() => onAnswer(row.id, false)} disabled={busy} />
                </View>
              </View>
            </GlassCard>
          );
        })}
      </Section>
      <Section title={t('zaadTopups.list.toCheck')} count={data.toCheck.length} color={colors.ui.warning}>
        {data.toCheck.map((row) => (
          <Row key={row.id} row={row} now={now} urgent onPress={() => onOpen(row.id)} />
        ))}
      </Section>
      <Section title={t('zaadTopups.list.waiting')} count={data.waiting.length}>
        {data.waiting.map((row) => (
          <Row key={row.id} row={row} now={now} onPress={() => onOpen(row.id)} />
        ))}
      </Section>
      <Section title={t('zaadTopups.list.inReview')} count={data.inReview.length}>
        {data.inReview.map((row) => (
          <Row key={row.id} row={row} now={now} onPress={() => onOpen(row.id)} />
        ))}
      </Section>
      <Section title={t('zaadTopups.list.doneToday')} count={data.doneToday.length}>
        {data.doneToday.map((row) => (
          <Row key={row.id} row={row} now={now} onPress={() => onOpen(row.id)} />
        ))}
      </Section>
      <Section title={t('zaadTopups.list.earlier')} count={data.earlier.length}>
        {data.earlier.map((row) => (
          <Row key={row.id} row={row} now={now} onPress={() => onOpen(row.id)} />
        ))}
      </Section>
      {nothing && data.loaded ? <Text style={styles.empty}>{t('zaadTopups.list.empty')}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  list: { gap: 18 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ui.textFaint },
  row: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowUrgent: { borderColor: colors.ui.warningSoft, borderWidth: 1 },
  rowMain: { flex: 1, gap: 2 },
  rowAmount: { fontSize: 20, fontWeight: '800', color: colors.ui.text, letterSpacing: -0.5 },
  rowWho: { fontSize: 14, color: colors.ui.textDim },
  rowRef: { fontSize: 13, fontWeight: '700', color: colors.ui.textFaint, letterSpacing: 1 },
  rowSide: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTime: { fontSize: 18, fontWeight: '800', color: colors.ui.text },
  rowStatus: { fontSize: 13, color: colors.ui.textDim },
  chevron: { fontSize: 22, color: colors.ui.textFaint },
  offer: { padding: 14, gap: 12 },
  offerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  offerButtons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  empty: { fontSize: 14, color: colors.ui.textFaint, textAlign: 'center' },
}));
