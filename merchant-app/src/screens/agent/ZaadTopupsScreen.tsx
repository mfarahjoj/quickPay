/**
 * Zaad top-ups through agents, the agent's side.
 *
 * Customers anywhere ask for a top-up; Zapp rings one online agent at a
 * time. The agent who accepts has the amount held from their float. The
 * customer pays the agent's Zaad number and enters the Zaad transaction ID.
 * The agent checks their **own** Zaad (the text from Telesom, or the
 * balance, never a screenshot the customer shows) and confirms with their
 * PIN; the held float goes to the customer and the agent earns commission.
 *
 *   idle      online switch, float, setup or refill notes
 *   offer     amount, customer, countdown: Accept / Decline
 *   accepted  waiting for the customer to send
 *   sent      check your Zaad: Received / Not received / A different amount
 *   pin       PIN for Received
 *   done      credited
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../../hooks/useAuth';
import { DarkScreen, GlassCard, PillButton, PinInput, ScreenHeader, TEXT_DIM, TEXT_FAINT } from '../../components';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { formatCents } from '../../utils/money';
import { formatLocal } from '../../utils/zaad';
import { callableErrorKey } from '../../utils/errors';
import {
  answerZaadOffer,
  confirmZaadTopup,
  getZaadStatus,
  isWrongZaadPin,
  maskMsisdn,
  setZaadOnline,
  watchZaadAgent,
  watchZaadTopup,
  type ZaadAgentDoc,
  type ZaadAgentStatus,
  type ZaadTopupDoc,
} from '../../services/zaadAgent.service';

/** Seconds left until [at], ticking. */
function useCountdown(at: { toMillis(): number } | null | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [at]);
  return at ? Math.max(0, Math.round((at.toMillis() - now) / 1000)) : 0;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function ZaadTopupsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const uid = user?.uid ?? '';

  const [status, setStatus] = useState<ZaadAgentStatus | null>(null);
  const [agent, setAgent] = useState<ZaadAgentDoc | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [req, setReq] = useState<ZaadTopupDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askingPin, setAskingPin] = useState(false);
  const [pin, setPin] = useState('');
  const [done, setDone] = useState<{ amount: number; commission: number } | null>(null);

  const refresh = useCallback(() => {
    getZaadStatus()
      .then(setStatus)
      .catch((e) => setError(t(callableErrorKey(e))));
  }, [t]);

  useFocusEffect(refresh);

  useEffect(() => {
    if (!uid) return;
    return watchZaadAgent(uid, (doc) => {
      setAgent(doc);
      // Keep showing a request after it's freed the agent, until they leave it.
      if (doc?.openRequestId) setRequestId(doc.openRequestId);
    });
  }, [uid]);

  useEffect(() => {
    if (!requestId) return;
    return watchZaadTopup(requestId, setReq);
  }, [requestId]);

  const offerLeft = useCountdown(req?.status === 'offered' ? req.offerExpiresAt : null);
  const sendLeft = useCountdown(req?.status === 'accepted' ? req.sendBy : null);
  const confirmLeft = useCountdown(req?.status === 'customer_sent' ? req.confirmBy : null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      if (isWrongZaadPin(e)) {
        setPin('');
        setError(t('errors.wrongPin'));
      } else if (e?.details?.reason === 'insufficient_float') {
        setError(t('zaadTopups.errors.lowFloat', { float: formatCents(e.details.floatCents ?? 0) }));
      } else if (e?.details?.reason === 'offer_ended') {
        setError(t('zaadTopups.errors.offerEnded'));
      } else if (e?.details?.reason === 'not_set_up') {
        setError(t('zaadTopups.notSetUp'));
      } else if (e?.details?.reason === 'paused') {
        setError(t('zaadTopups.paused', { until: new Date(e.details.pausedUntil).toLocaleString() }));
      } else {
        setError(e?.message ? String(e.message) : t(callableErrorKey(e)));
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleOnline = (online: boolean) =>
    run(async () => {
      await setZaadOnline(online);
      refresh();
    });

  const answer = (accept: boolean) => run(() => answerZaadOffer(requestId!, accept));

  const decline = (kind: 'not_received' | 'different_amount') =>
    Alert.alert(
      t(kind === 'not_received' ? 'zaadTopups.sent.notReceivedTitle' : 'zaadTopups.sent.differentTitle'),
      t('zaadTopups.sent.declineBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('zaadTopups.sent.declineConfirm'),
          style: 'destructive',
          onPress: () => run(() => confirmZaadTopup(requestId!, kind, req!.amount)),
        },
      ],
    );

  const received = (agentPin: string) =>
    run(async () => {
      const res = await confirmZaadTopup(requestId!, 'received', req!.amount, agentPin);
      setDone({ amount: req!.amount, commission: res.commissionCents ?? 0 });
      setAskingPin(false);
      setPin('');
    });

  const leave = () => {
    setRequestId(null);
    setReq(null);
    setDone(null);
    setError('');
    refresh();
  };

  const header = (
    <ScreenHeader title={t('zaadTopups.title')} subtitle={t('zaadTopups.subtitle')} onBack={() => navigation.goBack()} />
  );
  const errorLine = error ? <Text style={styles.error}>{error}</Text> : null;

  if (done) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.bigTitle}>{t('zaadTopups.done.title')}</Text>
        <Text style={styles.bigAmount}>{formatCents(done.amount)}</Text>
        {done.commission > 0 ? (
          <Text style={styles.sub}>{t('zaadTopups.done.commission', { amount: formatCents(done.commission) })}</Text>
        ) : null}
        <View style={styles.block}>
          <PillButton label={t('common.done')} onPress={leave} />
        </View>
      </DarkScreen>
    );
  }

  const mine = req && (req.agentId === uid || req.offeredTo === uid) ? req : null;

  // A request ringing on this agent.
  if (mine?.status === 'offered' && mine.offeredTo === uid) {
    return (
      <DarkScreen edges={[]} scroll contentStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <Text style={styles.label}>{t('zaadTopups.offer.label')}</Text>
          <Text style={styles.bigAmountCentered}>{formatCents(mine.amount)}</Text>
          <Text style={styles.sub}>{t('zaadTopups.offer.body', { name: mine.customerFirstName })}</Text>
          <Text style={styles.countdown}>{clock(offerLeft)}</Text>
          {errorLine}
          <PillButton label={t('zaadTopups.offer.accept')} onPress={() => answer(true)} loading={busy} disabled={busy || offerLeft === 0} />
          <PillButton label={t('zaadTopups.offer.decline')} variant="glass" onPress={() => answer(false)} disabled={busy} />
        </View>
      </DarkScreen>
    );
  }

  // Accepted: the customer is sending.
  if (mine?.status === 'accepted' && mine.agentId === uid) {
    return (
      <DarkScreen edges={[]} scroll contentStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <Text style={styles.bigAmountCentered}>{formatCents(mine.amount)}</Text>
          <Text style={styles.sub}>
            {t('zaadTopups.accepted.body', {
              name: mine.customerFirstName,
              amount: formatCents(mine.amount),
              number: formatLocal(mine.agentReceiveMsisdn ?? ''),
            })}
          </Text>
          <Senders senders={mine.allowedSenders} />
          <View style={styles.waiting}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.hint}>{t('zaadTopups.accepted.waiting', { time: clock(sendLeft) })}</Text>
          </View>
          {errorLine}
          {/* The money can land before the customer taps "I've sent it". */}
          <PillButton label={t('zaadTopups.sent.received')} variant="glass" onPress={() => setAskingPin(true)} disabled={busy} />
          {askingPin ? <PinStep pin={pin} setPin={setPin} onComplete={received} busy={busy} amount={mine.amount} /> : null}
        </View>
      </DarkScreen>
    );
  }

  // The customer says it's sent: check your own Zaad.
  if (mine?.status === 'customer_sent' && mine.agentId === uid) {
    return (
      <DarkScreen edges={[]} scroll keyboard contentStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <Text style={styles.label}>{t('zaadTopups.sent.label')}</Text>
          <Text style={styles.bigAmountCentered}>{formatCents(mine.amount)}</Text>
          <Text style={styles.sub}>{t('zaadTopups.sent.body', { name: mine.customerFirstName })}</Text>
          <GlassCard style={styles.card}>
            <Text style={styles.label}>{t('zaadTopups.sent.txnId')}</Text>
            <Text style={styles.code} selectable>{mine.customerZaadTxnId}</Text>
          </GlassCard>
          <Senders senders={mine.allowedSenders} />
          <Text style={styles.warn}>{t('zaadTopups.sent.ownZaadOnly')}</Text>
          <Text style={styles.hint}>{t('zaadTopups.sent.timeLeft', { time: clock(confirmLeft) })}</Text>
          {errorLine}
          {askingPin ? (
            <PinStep pin={pin} setPin={setPin} onComplete={received} busy={busy} amount={mine.amount} />
          ) : (
            <>
              <PillButton label={t('zaadTopups.sent.received')} onPress={() => setAskingPin(true)} disabled={busy} />
              <PillButton label={t('zaadTopups.sent.notReceived')} variant="glass" onPress={() => decline('not_received')} disabled={busy} />
              <PillButton label={t('zaadTopups.sent.different')} variant="glass" onPress={() => decline('different_amount')} disabled={busy} />
            </>
          )}
        </View>
      </DarkScreen>
    );
  }

  // A request this agent was on has ended some other way.
  if (mine && requestId && !agent?.openRequestId) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t(`zaadTopups.ended.${mine.status}`, { defaultValue: t('zaadTopups.ended.other') })}</Text>
        <View style={styles.block}>
          <PillButton label={t('common.done')} onPress={leave} />
        </View>
      </DarkScreen>
    );
  }

  if (!status) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <ActivityIndicator color="#FFFFFF" />
        {errorLine}
      </DarkScreen>
    );
  }

  const low = status.floatCents < status.floatLowCents;
  const online = agent?.online ?? status.online;
  return (
    <DarkScreen edges={[]} scroll contentStyle={styles.content}>
      {header}
      <View style={styles.body}>
        {!status.open ? (
          <Text style={styles.sub}>{t('zaadTopups.closed')}</Text>
        ) : !status.enabled ? (
          <Text style={styles.sub}>{t('zaadTopups.notSetUp')}</Text>
        ) : (
          <>
            <GlassCard style={styles.switchCard}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>{t(online ? 'zaadTopups.online' : 'zaadTopups.offline')}</Text>
                <Text style={styles.hint}>{t(online ? 'zaadTopups.onlineHint' : 'zaadTopups.offlineHint')}</Text>
              </View>
              <Switch value={online} onValueChange={toggleOnline} disabled={busy} />
            </GlassCard>
            {status.pausedUntil ? (
              <Text style={styles.warn}>{t('zaadTopups.paused', { until: new Date(status.pausedUntil).toLocaleString() })}</Text>
            ) : null}
            <GlassCard style={styles.card}>
              <Text style={styles.label}>{t('zaadTopups.receivesOn')}</Text>
              <Text style={styles.code}>{status.receiveNumber}</Text>
              <Text style={styles.label}>{t('dashboard.float.label')}</Text>
              <Text style={[styles.code, low && styles.lowFloat]}>{formatCents(status.floatCents)}</Text>
              {low ? <Text style={styles.warn}>{t('zaadTopups.lowFloat')}</Text> : null}
            </GlassCard>
            <Text style={styles.hint}>{t('zaadTopups.howItWorks')}</Text>
          </>
        )}
        {errorLine}
      </View>
    </DarkScreen>
  );
}

function Senders({ senders }: { senders?: string[] }) {
  const { t } = useTranslation();
  if (!senders?.length) return null;
  return (
    <Text style={styles.hint}>
      {t('zaadTopups.fromNumbers', { numbers: senders.map(maskMsisdn).join(t('zaadTopups.or')) })}
    </Text>
  );
}

function PinStep({
  pin,
  setPin,
  onComplete,
  busy,
  amount,
}: {
  pin: string;
  setPin: (p: string) => void;
  onComplete: (p: string) => void;
  busy: boolean;
  amount: number;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.pin}>
      <Text style={styles.sub}>{t('zaadTopups.pinFor', { amount: formatCents(amount) })}</Text>
      <PinInput value={pin} onChange={setPin} onComplete={onComplete} />
      {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  body: { paddingHorizontal: 24, gap: 16 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', marginTop: 20 },
  bigAmount: { fontSize: 44, fontWeight: '800', color: '#34C77B', letterSpacing: -2, marginTop: 8 },
  bigAmountCentered: { fontSize: 52, fontWeight: '800', color: '#FFFFFF', letterSpacing: -2, textAlign: 'center' },
  countdown: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  sub: { fontSize: 15, lineHeight: 22, color: TEXT_DIM, textAlign: 'center' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  hint: { fontSize: 13, lineHeight: 19, color: TEXT_FAINT, textAlign: 'center' },
  warn: { fontSize: 14, lineHeight: 20, color: '#FFB340', textAlign: 'center' },
  error: { fontSize: 14, color: '#FF6961', textAlign: 'center' },
  card: { padding: 18, gap: 8 },
  code: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1 },
  lowFloat: { color: '#FFB340' },
  switchCard: { padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchText: { flex: 1, gap: 4 },
  switchTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pin: { gap: 16, marginTop: 8 },
  block: { alignSelf: 'stretch', marginTop: 28 },
});
