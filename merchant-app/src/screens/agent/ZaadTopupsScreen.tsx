/**
 * Zaad top-ups through agents, the agent's side.
 *
 * Customers anywhere ask for a top-up; Zapp rings one online agent at a
 * time. The agent who accepts has the amount held from their float. The
 * customer pays the agent's Zaad number and taps "I've sent it"; Zapp's
 * reference (ZP-…, D31) names the top-up on both screens.
 * The agent checks their **own** Zaad (the text from Telesom, or the
 * balance, never a screenshot the customer shows) and confirms with their
 * PIN; the held float goes to the customer and the agent earns commission.
 *
 *   idle      online switch, float, setup or refill notes, and the agent's
 *             requests (D32): offers ringing now as a queue, then Check your
 *             Zaad, Waiting for customer, In review, Done today, Earlier
 *   offer     amount, customer, countdown: Accept / Decline
 *   accepted  waiting for the customer to send
 *   sent      check your Zaad: Received / Not received / A different amount
 *   pin       PIN for Received, with Zaad's transaction ID if the agent gives it
 *   done      credited
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../../hooks/useAuth';
import { DarkScreen, GlassCard, PillButton, PinInput, ScreenHeader } from '../../components';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { ZaadRequestList } from '../../components/ZaadRequestList';
import { ZaadJobOffer } from '../../components/ZaadJobOffer';
import { useZaadAgentRequests } from '../../hooks/useZaadAgentRequests';
import { formatCents } from '../../utils/money';
import { formatLocal } from '../../utils/zaad';
import { callableErrorKey } from '../../utils/errors';
import {
  answerZaadOffer,
  confirmZaadTopup,
  getZaadStatus,
  isWrongZaadPin,
  maskMsisdn,
  normaliseTxnId,
  ringsOn,
  setZaadOnline,
  watchZaadAgent,
  watchZaadTopup,
  type ZaadAgentDoc,
  type ZaadAgentStatus,
  type ZaadTopupDoc,
} from '../../services/zaadAgent.service';
import { makeStyles, useColors } from '../../theme';

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
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const uid = user?.uid ?? '';

  const [status, setStatus] = useState<ZaadAgentStatus | null>(null);
  const [agent, setAgent] = useState<ZaadAgentDoc | null>(null);
  // The request open on screen: from a push or a scan (route), a tap in the
  // list, or an offer just accepted. With several at once (D32) nothing
  // switches it but the agent.
  const [requestId, setRequestId] = useState<string | null>(route.params?.requestId ?? null);
  const requests = useZaadAgentRequests(uid || undefined);
  const [req, setReq] = useState<ZaadTopupDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askingPin, setAskingPin] = useState(false);
  const [pin, setPin] = useState('');
  const [zaadTxnText, setZaadTxnText] = useState('');
  const [done, setDone] = useState<{ amount: number; commission: number } | null>(null);
  // An offer this agent was looking at that is no longer theirs to take.
  const [endedOffer, setEndedOffer] = useState<{ amount: number } | null>(null);
  const [accepting, setAccepting] = useState(false);
  // The offer on screen, so that when it disappears (another agent took it: the
  // request stops being readable to this agent) the agent is told why.
  const lastOffer = useRef<{ amount: number } | null>(null);

  const refresh = useCallback(() => {
    getZaadStatus()
      .then(setStatus)
      .catch((e) => setError(t(callableErrorKey(e))));
  }, [t]);

  useFocusEffect(refresh);

  useEffect(() => {
    if (!uid) return;
    return watchZaadAgent(uid, setAgent);
  }, [uid]);

  // Opened again for a different request (a push tapped while here).
  const routeRequestId = route.params?.requestId;
  useEffect(() => {
    if (routeRequestId) {
      setDone(null);
      setRequestId(routeRequestId);
    }
  }, [routeRequestId]);

  useEffect(() => {
    if (!requestId) return;
    return watchZaadTopup(requestId, setReq);
  }, [requestId]);

  // The offer on screen stops being readable once another agent accepts it.
  useEffect(() => {
    if (requestId && req === null && lastOffer.current) {
      setEndedOffer({ amount: lastOffer.current.amount });
      lastOffer.current = null;
    }
  }, [req, requestId]);

  // Accepted: the request moves on from "offered" and the job card is done with.
  useEffect(() => {
    if (req?.status !== 'offered') setAccepting(false);
  }, [req?.status]);

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
        setEndedOffer({ amount: req?.amount ?? lastOffer.current?.amount ?? 0 });
        lastOffer.current = null;
      } else if (e?.details?.reason === 'not_set_up') {
        setError(t('zaadTopups.notSetUp'));
      } else if (e?.details?.reason === 'txn_id_used') {
        setError(t('zaadTopups.errors.txnUsed'));
      } else if (e?.details?.reason === 'txn_id') {
        setError(t('zaadTopups.errors.txnBad'));
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

  const answerOffer = (id: string, accept: boolean) => {
    setAccepting(accept);
    return run(async () => {
      try {
        await answerZaadOffer(id, accept);
      } catch (e) {
        setAccepting(false);
        throw e;
      }
      lastOffer.current = null;
      setRequestId(accept ? id : null);
    });
  };
  const answer = (accept: boolean) => answerOffer(requestId!, accept);

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

  const received = (agentPin: string) => {
    const typed = zaadTxnText.trim().length > 0;
    const zaadTxnId = typed ? normaliseTxnId(zaadTxnText) : null;
    if (typed && !zaadTxnId) {
      setPin('');
      setError(t('zaadTopups.errors.txnBad'));
      return;
    }
    return run(async () => {
      const res = await confirmZaadTopup(requestId!, 'received', req!.amount, agentPin, zaadTxnId ?? undefined);
      setDone({ amount: req!.amount, commission: res.commissionCents ?? 0 });
      setAskingPin(false);
      setPin('');
      setZaadTxnText('');
    });
  };

  const leave = () => {
    lastOffer.current = null;
    setEndedOffer(null);
    setZaadTxnText('');
    setAskingPin(false);
    setPin('');
    navigation.setParams({ requestId: undefined });
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
  // While one request is open, others that need the agent are a tap away.
  const othersWaiting =
    requests.offers.filter((r) => r.id !== requestId).length + requests.toCheck.filter((r) => r.id !== requestId).length;
  const others =
    requestId && othersWaiting > 0 ? (
      <TouchableOpacity onPress={leave} style={styles.others} accessibilityRole="button">
        <Text style={styles.othersText}>{t('zaadTopups.list.othersWaiting', { count: othersWaiting })}</Text>
      </TouchableOpacity>
    ) : null;

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

  const mine = req && (req.agentId === uid || ringsOn(req, uid)) ? req : null;

  // Another agent took the offer, or it ran out, while this agent was looking.
  if (endedOffer) {
    return (
      <DarkScreen edges={[]} scroll contentStyle={styles.content}>
        {header}
        <ZaadJobOffer
          amount={endedOffer.amount}
          customerFirstName=""
          secondsLeft={0}
          phase="taken"
          onAccept={() => undefined}
          onDecline={() => undefined}
          onClose={leave}
        />
      </DarkScreen>
    );
  }

  // A request ringing on this agent: a job, first to accept gets it.
  if (mine?.status === 'offered' && ringsOn(mine, uid)) {
    lastOffer.current = { amount: mine.amount };
    const windowMs = (mine.offerExpiresAt?.toMillis() ?? 0) - (mine.createdAt?.toMillis() ?? 0);
    return (
      <DarkScreen edges={[]} scroll contentStyle={styles.content}>
        {header}
        <ZaadJobOffer
          amount={mine.amount}
          customerFirstName={mine.customerFirstName}
          commissionCents={mine.agentCommissionCents}
          secondsLeft={offerLeft}
          windowMs={windowMs > 0 ? windowMs : undefined}
          phase={accepting ? 'checking' : offerLeft === 0 ? 'expired' : 'deciding'}
          othersWaiting={othersWaiting}
          error={error}
          onAccept={() => answer(true)}
          onDecline={() => answer(false)}
          onClose={leave}
        />
      </DarkScreen>
    );
  }

  // Accepted: the customer is sending.
  if (mine?.status === 'accepted' && mine.agentId === uid) {
    return (
      <DarkScreen edges={[]} scroll contentStyle={styles.content}>
        {header}
        <View style={styles.body}>
          {others}
          <Text style={styles.bigAmountCentered}>{formatCents(mine.amount)}</Text>
          <Text style={styles.sub}>
            {t('zaadTopups.accepted.body', {
              name: mine.customerFirstName,
              amount: formatCents(mine.amount),
              number: formatLocal(mine.agentReceiveMsisdn ?? ''),
            })}
          </Text>
          <Reference value={mine.reference} hint />
          <Senders senders={mine.allowedSenders} />
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.ui.text} />
            <Text style={styles.hint}>{t('zaadTopups.accepted.waiting', { time: clock(sendLeft) })}</Text>
          </View>
          {errorLine}
          {/* The money can land before the customer taps "I've sent it". */}
          <PillButton label={t('zaadTopups.sent.received')} variant="glass" onPress={() => setAskingPin(true)} disabled={busy} />
          {askingPin ? (
            <PinStep pin={pin} setPin={setPin} txn={zaadTxnText} setTxn={setZaadTxnText} onComplete={received} busy={busy} amount={mine.amount} />
          ) : null}
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
          {others}
          <Text style={styles.label}>{t('zaadTopups.sent.label')}</Text>
          <Text style={styles.bigAmountCentered}>{formatCents(mine.amount)}</Text>
          <Text style={styles.sub}>{t('zaadTopups.sent.body', { name: mine.customerFirstName })}</Text>
          <Reference value={mine.reference} hint />
          {/* Customer builds 82–83 may still send Zaad's ID. */}
          {mine.customerZaadTxnId ? (
            <GlassCard style={styles.card}>
              <Text style={styles.label}>{t('zaadTopups.sent.txnId')}</Text>
              <Text style={styles.code} selectable>{mine.customerZaadTxnId}</Text>
            </GlassCard>
          ) : (
            <Text style={styles.hint}>{t('zaadTopups.sent.matchHint')}</Text>
          )}
          <Senders senders={mine.allowedSenders} />
          <Text style={styles.warn}>{t('zaadTopups.sent.ownZaadOnly')}</Text>
          <Text style={styles.hint}>{t('zaadTopups.sent.timeLeft', { time: clock(confirmLeft) })}</Text>
          {errorLine}
          {askingPin ? (
            <PinStep pin={pin} setPin={setPin} txn={zaadTxnText} setTxn={setZaadTxnText} onComplete={received} busy={busy} amount={mine.amount} />
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

  // A request this agent was on has ended, or waits on the customer or Zapp.
  if (mine && requestId) {
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
        <ActivityIndicator color={colors.ui.text} />
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
        {status.enabled || requests.earlier.length + requests.doneToday.length > 0 ? (
          <ZaadRequestList data={requests} onOpen={setRequestId} onAnswer={answerOffer} busy={busy} />
        ) : null}
        {/* In person, cash or Zaad: scan the customer's top-up code. */}
        <PillButton label={t('zaadTopups.scanCustomer')} onPress={() => navigation.navigate('ConfirmTopup')} />
        {errorLine}
      </View>
    </DarkScreen>
  );
}

function Senders({ senders }: { senders?: string[] }) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (!senders?.length) return null;
  return (
    <Text style={styles.hint}>
      {t('zaadTopups.fromNumbers', { numbers: senders.map(maskMsisdn).join(t('zaadTopups.or')) })}
    </Text>
  );
}

/** Zapp's reference (D31), the one the customer sees. Nothing on requests made before it. */
function Reference({ value, hint }: { value?: string; hint?: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (!value) return null;
  return (
    <GlassCard style={styles.card}>
      <Text style={styles.label}>{t('zaadTopups.reference')}</Text>
      <Text style={styles.code} selectable>{value}</Text>
      {hint ? <Text style={styles.hintLeft}>{t('zaadTopups.referenceHint')}</Text> : null}
    </GlassCard>
  );
}

function PinStep({
  pin,
  setPin,
  txn,
  setTxn,
  onComplete,
  busy,
  amount,
}: {
  pin: string;
  setPin: (p: string) => void;
  txn: string;
  setTxn: (t: string) => void;
  onComplete: (p: string) => void;
  busy: boolean;
  amount: number;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.pin}>
      {/* D31: optional; claims this Zaad payment for one top-up only. */}
      <Text style={styles.label}>{t('zaadTopups.received.txnLabel')}</Text>
      <TextInput
        value={txn}
        onChangeText={setTxn}
        placeholder="e.g. 12345678"
        placeholderTextColor={colors.ui.ink(0.3)}
        autoCapitalize="characters"
        autoCorrect={false}
        style={styles.input}
      />
      <Text style={styles.hint}>{t('zaadTopups.received.txnHint')}</Text>
      <Text style={styles.sub}>{t('zaadTopups.pinFor', { amount: formatCents(amount) })}</Text>
      <PinInput value={pin} onChange={setPin} onComplete={onComplete} />
      {busy ? <ActivityIndicator color={colors.ui.text} /> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  body: { paddingHorizontal: 24, gap: 16 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, textAlign: 'center', marginTop: 20 },
  bigAmount: { fontSize: 44, fontWeight: '800', color: colors.ui.incoming, letterSpacing: -2, marginTop: 8 },
  bigAmountCentered: { fontSize: 52, fontWeight: '800', color: colors.ui.text, letterSpacing: -2, textAlign: 'center' },
  countdown: { fontSize: 28, fontWeight: '800', color: colors.ui.text, textAlign: 'center' },
  sub: { fontSize: 15, lineHeight: 22, color: colors.ui.textDim, textAlign: 'center' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ui.textFaint },
  hint: { fontSize: 13, lineHeight: 19, color: colors.ui.textFaint, textAlign: 'center' },
  hintLeft: { fontSize: 13, lineHeight: 19, color: colors.ui.textFaint },
  others: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.ui.warningSoft,
    borderWidth: 1,
    borderColor: colors.ui.warningSoft,
  },
  othersText: { fontSize: 14, fontWeight: '700', color: colors.ui.warning, textAlign: 'center' },
  input: {
    alignSelf: 'stretch',
    fontSize: 18,
    fontWeight: '700',
    color: colors.ui.text,
    letterSpacing: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.ui.divider,
  },
  warn: { fontSize: 14, lineHeight: 20, color: colors.ui.warning, textAlign: 'center' },
  error: { fontSize: 14, color: colors.ui.error, textAlign: 'center' },
  card: { padding: 18, gap: 8 },
  code: { fontSize: 22, fontWeight: '800', color: colors.ui.text, letterSpacing: 1 },
  lowFloat: { color: colors.ui.warning },
  switchCard: { padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchText: { flex: 1, gap: 4 },
  switchTitle: { fontSize: 17, fontWeight: '700', color: colors.ui.text },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pin: { gap: 16, marginTop: 8 },
  block: { alignSelf: 'stretch', marginTop: 28 },
}));
