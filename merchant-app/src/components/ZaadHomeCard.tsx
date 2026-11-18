/**
 * The agent's Zaad top-ups on the home screen (D32), while Zaad top-ups are
 * on for them: online or offline with the switch, how many need checking
 * (in the attention colour), how many wait for the customer, and float held
 * vs free. Tapping it opens the Zaad top-ups screen and its list.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { formatCents } from '../utils/money';
import { getZaadStatus, setZaadOnline, watchZaadAgent, type ZaadAgentStatus } from '../services/zaadAgent.service';
import { useZaadAgentRequests } from '../hooks/useZaadAgentRequests';
import { makeStyles } from '../theme';

export function ZaadHomeCard({ uid, onOpen }: { uid: string; onOpen: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [status, setStatus] = useState<ZaadAgentStatus | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const requests = useZaadAgentRequests(uid);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      getZaadStatus()
        .then((s) => live && setStatus(s))
        .catch(() => undefined);
      const stop = watchZaadAgent(uid, (doc) => live && setOnline(doc?.online ?? null));
      return () => {
        live = false;
        stop();
      };
    }, [uid]),
  );

  if (!status?.open || !status.enabled) return null;
  const isOnline = online ?? status.online;
  const toCheck = requests.toCheck.length;
  const ringing = requests.offers.length;
  const waiting = requests.waiting.length;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await setZaadOnline(next);
      setOnline(next);
    } catch {
      // The Top-ups screen says why (paused, not set up).
      onOpen();
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity style={[styles.card, toCheck + ringing > 0 && styles.cardAttention]} onPress={onOpen} activeOpacity={0.85}>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.label}>{t('zaadTopups.home.title')}</Text>
          <Text style={styles.state}>{t(isOnline ? 'zaadTopups.online' : 'zaadTopups.offline')}</Text>
        </View>
        <Switch value={isOnline} onValueChange={toggle} disabled={busy} />
      </View>
      <View style={styles.counts}>
        {ringing > 0 ? <Text style={styles.attention}>{t('zaadTopups.home.ringing', { count: ringing })}</Text> : null}
        <Text style={toCheck > 0 ? styles.attention : styles.count}>{t('zaadTopups.home.toCheck', { count: toCheck })}</Text>
        <Text style={styles.count}>{t('zaadTopups.home.waiting', { count: waiting })}</Text>
      </View>
      <Text style={styles.float}>
        {t('zaadTopups.home.float', { held: formatCents(requests.heldCents), free: formatCents(status.floatCents) })}
      </Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  card: {
    marginBottom: 22,
    padding: 16,
    gap: 10,
    borderRadius: 18,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
  cardAttention: { backgroundColor: colors.ui.warningSoft, borderColor: colors.ui.warningSoft },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  label: { fontSize: 12, fontWeight: '700', color: colors.ui.textFaint, letterSpacing: 1, textTransform: 'uppercase' },
  state: { fontSize: 18, fontWeight: '800', color: colors.ui.text, marginTop: 2 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  count: { fontSize: 15, fontWeight: '700', color: colors.ui.textDim },
  attention: { fontSize: 15, fontWeight: '800', color: colors.ui.warning },
  float: { fontSize: 13, color: colors.ui.textFaint },
}));
