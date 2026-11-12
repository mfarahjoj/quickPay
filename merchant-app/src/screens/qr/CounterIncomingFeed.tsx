import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { auth, firestore } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';
import { formatCents } from '../../utils/money';
import { GlassCard, TEXT_DIM, TEXT_FAINT } from '../../components';

/**
 * Live feed of payments landing on the counter code.
 *
 * The dynamic-amount QR can confirm a sale from the code's own document,
 * because the merchant created that code. A printed counter code has no such
 * document: the customer scans it, types an amount and pays, and the only
 * signal the merchant gets is a push notification — which is off, silenced or
 * on a phone in someone's pocket often enough to matter. Staff then confirm
 * the sale by looking at the customer's screen, and a screenshot of a success
 * page is trivially easy to show.
 *
 * So the till needs its own view of what actually arrived. Reads are scoped to
 * this merchant by `toUserId`, which is what the Firestore rule for
 * `transactions` allows, and the composite index for it already exists.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ROWS = 4;

interface IncomingPayment {
  id: string;
  amountCents: number;
  netCents: number;
  at: Date;
}

function useElapsedTick(intervalMs = 30000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export default function CounterIncomingFeed() {
  const { t } = useTranslation();
  const [payments, setPayments] = useState<IncomingPayment[]>([]);
  const [failed, setFailed] = useState(false);
  // Everything present when the screen opened is history, not a new sale, so
  // the first snapshot must not buzz.
  const seeded = useRef(false);
  const seen = useRef<Set<string>>(new Set());

  useElapsedTick();

  useEffect(() => {
    const uid = auth().currentUser?.uid;
    if (!uid) return;

    const unsub = firestore()
      .collection('transactions')
      .where('toUserId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(MAX_ROWS)
      .onSnapshot(
        (snap) => {
          setFailed(false);
          const rows: IncomingPayment[] = [];
          let arrived = false;

          snap.docs.forEach((doc) => {
            const data: any = doc.data();
            if (data?.type !== 'payment') return;
            const at: Date = data.createdAt?.toDate?.() ?? new Date();
            if (Date.now() - at.getTime() > WINDOW_MS) return;

            rows.push({
              id: doc.id,
              amountCents: data.amount ?? 0,
              netCents: data.netCents ?? data.amount ?? 0,
              at,
            });
            if (seeded.current && !seen.current.has(doc.id)) arrived = true;
            seen.current.add(doc.id);
          });

          setPayments(rows);
          if (arrived) triggerHaptic('payment');
          seeded.current = true;
        },
        (err) => {
          // A dead listener must look dead. Staff who believe this feed is
          // live would accept a payment that never arrived.
          console.warn('Counter feed failed:', err);
          setFailed(true);
        },
      );

    return unsub;
  }, []);

  const elapsedLabel = (at: Date) => {
    const minutes = Math.floor((Date.now() - at.getTime()) / 60000);
    if (minutes < 1) return t('qr.counter.justNow');
    return t('qr.counter.minutesAgo', { count: minutes });
  };

  return (
    <GlassCard style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('qr.counter.incomingTitle')}</Text>
        <View style={[styles.liveDot, failed && styles.liveDotDead]} />
      </View>

      {failed ? (
        <Text style={styles.muted}>{t('qr.counter.incomingFailed')}</Text>
      ) : payments.length === 0 ? (
        <Text style={styles.muted}>{t('qr.counter.incomingEmpty')}</Text>
      ) : (
        payments.map((p) => (
          <View key={p.id} style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.amount}>{formatCents(p.amountCents)}</Text>
              <Text style={styles.net}>
                {t('qr.counter.net', { amount: formatCents(p.netCents) })}
              </Text>
            </View>
            <Text style={styles.time}>{elapsedLabel(p.at)}</Text>
          </View>
        ))
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', marginTop: 20, padding: 16 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: TEXT_DIM,
    textTransform: 'uppercase',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C77B' },
  liveDotDead: { backgroundColor: '#FF6961' },
  muted: { fontSize: 13, color: TEXT_FAINT },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  rowLeft: { gap: 2 },
  amount: { fontSize: 17, fontWeight: '700', color: '#34C77B' },
  net: { fontSize: 12, color: TEXT_FAINT },
  time: { fontSize: 12, color: TEXT_DIM },
});
