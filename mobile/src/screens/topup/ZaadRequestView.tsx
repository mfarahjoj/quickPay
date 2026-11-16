/**
 * One Zaad top-up through an agent, from "finding an agent" to "in your
 * wallet", whether the agent was found by Zapp (remote) or scanned the
 * customer's code (in person). Shared by AgentTopupScreen and the old
 * ZaadAgentTopupScreen route.
 *
 * Trust points (ZAPP_AGENT_TOPUP_ONE_FLOW_PLAN.md §4): the agent's name with
 * "Verified Zapp agent" (T3), "{agent} has $X set aside for you" only once
 * the float is held (T1), pay only the number shown (T2), the steps with a
 * countdown (T4), "Zapp reviews it" while the agent checks (T5), and a
 * receipt with a "Something wrong?" link (T7, T8). Each line says only
 * what is true at that moment.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { triggerHaptic } from '../../services/haptics.service';
import { formatLocal } from '../../services/mobileMoney.service';
import {
  cancelZaadAgentTopup,
  disputeZaadAgentTopup,
  markZaadSent,
  normaliseTxnId,
  watchZaadAgentTopup,
  type ZaadAgentTopupDoc,
} from '../../services/zaadAgent.service';
import { useColors } from '../../theme';
import { formatMoney } from '../../utils/money';
import { DialPanel, Primary, Waiting, useStyles } from './ZaadTopupScreen';

function useSecondsLeft(at: { toMillis(): number } | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [at]);
  return at ? Math.max(0, Math.round((at.toMillis() - now) / 1000)) : 0;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Agent found → Pay → Agent checking → In your wallet (T4). */
function Steps({ at }: { at: 0 | 1 | 2 | 3 }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const labels = [
    t('topup.agentFlow.steps.found'),
    t('topup.agentFlow.steps.pay'),
    t('topup.agentFlow.steps.checking'),
    t('topup.agentFlow.steps.wallet'),
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {labels.map((label, i) => (
        <Text
          key={label}
          style={[
            styles.hint,
            { fontSize: 12, fontWeight: i === at ? '800' : '500' },
            i < at && { color: colors.ui.incoming },
            i > at && { color: colors.ui.ink(0.3) },
          ]}
        >
          {i < at ? '✓ ' : ''}
          {label}
          {i < labels.length - 1 ? '  ›' : ''}
        </Text>
      ))}
    </View>
  );
}

/** The agent's name and the "Verified Zapp agent" mark (T3), with the amount. */
export function AgentHeader({ name, amount }: { name: string; amount: string }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <View style={[styles.dialBox, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.big, { fontSize: 18 }]} numberOfLines={1}>{name}</Text>
        <Text style={[styles.hint, { color: colors.ui.incoming, fontWeight: '700' }]}>
          ✓ {t('topup.agentFlow.verifiedAgent')}
        </Text>
      </View>
      <Text style={[styles.big, { fontSize: 22 }]}>{amount}</Text>
    </View>
  );
}

export default function ZaadRequestView({ requestId, onStartOver }: { requestId: string; onStartOver: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [req, setReq] = useState<ZaadAgentTopupDoc | null>(null);
  const [txnText, setTxnText] = useState('');
  const [disputeText, setDisputeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () =>
      watchZaadAgentTopup(requestId, (doc) => {
        if (doc?.status === 'completed') triggerHaptic('success');
        setReq(doc);
      }),
    [requestId]
  );

  const sendLeft = useSecondsLeft(req?.status === 'accepted' ? req.sendBy : undefined);
  const confirmLeft = useSecondsLeft(req?.status === 'customer_sent' ? req.confirmBy : undefined);
  const disputeLeft = useSecondsLeft(req?.status === 'declined' ? req.disputeUntil : undefined);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  if (!req) return <ActivityIndicator color={colors.ui.accentText} style={styles.loading} />;

  const inPerson = req.meeting === 'in_person';
  const amount = formatMoney(req.amount, 'USD');
  const agent = req.agentName ?? '';
  const errorLine = error ? <Text style={styles.errorText}>{error}</Text> : null;

  if (req.status === 'offered') {
    return (
      <View style={styles.body}>
        <Text style={styles.big}>{t('topup.zaadAgent.findingTitle', { amount })}</Text>
        <Waiting text={t('topup.zaadAgent.finding')} />
        {errorLine}
        <TouchableOpacity onPress={() => run(() => cancelZaadAgentTopup(requestId))}>
          <Text style={styles.link}>{t('topup.zaadAgent.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (req.status === 'accepted') {
    const txn = normaliseTxnId(txnText);
    const typed = txnText.trim().length > 0;
    return (
      <View style={styles.body}>
        <AgentHeader name={agent} amount={amount} />
        <Steps at={1} />
        {/* T1: true now, because the agent's float is held. */}
        <Text style={[styles.hint, { color: colors.ui.incoming, fontWeight: '700' }]}>
          {t('topup.agentFlow.setAside', { agent, amount })}
        </Text>
        <Text style={styles.hint}>
          {t('topup.zaadAgent.payBody', {
            amount,
            number: formatLocal(req.agentReceiveMsisdn ?? ''),
            time: clock(sendLeft),
          })}
        </Text>
        <DialPanel code={req.dialCode ?? null} />
        <Text style={styles.hint}>{t('topup.agentFlow.onlyThisNumber')}</Text>
        <Text style={styles.label}>
          {t(inPerson ? 'topup.agentFlow.txnLabelOptional' : 'topup.zaadAgent.txnLabel')}
        </Text>
        <TextInput
          value={txnText}
          onChangeText={setTxnText}
          placeholder="e.g. 12345678"
          placeholderTextColor={colors.ui.ink(0.25)}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.hint}>{t('topup.zaadAgent.txnHint')}</Text>
        {errorLine}
        <Primary
          label={t('topup.zaadAgent.sent')}
          onPress={() => run(() => markZaadSent(requestId, txn ?? undefined))}
          busy={busy}
          // D21: optional in person; remote needs it as evidence (D9).
          disabled={inPerson ? typed && !txn : !txn}
        />
        <TouchableOpacity onPress={() => run(() => cancelZaadAgentTopup(requestId))}>
          <Text style={styles.link}>{t('topup.zaadAgent.cancelNotSent')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (req.status === 'customer_sent') {
    return (
      <View style={styles.body}>
        <AgentHeader name={agent} amount={amount} />
        <Steps at={2} />
        <Text style={styles.big}>{t('topup.zaadAgent.checkingTitle', { agent })}</Text>
        <Waiting text={t('topup.zaadAgent.checking', { amount })} />
        {/* T5 */}
        <Text style={styles.hint}>
          {t('topup.agentFlow.zappReviews', { agent, amount, time: clock(confirmLeft) })}
        </Text>
      </View>
    );
  }

  if (req.status === 'declined') {
    return (
      <View style={styles.body}>
        <AgentHeader name={agent} amount={amount} />
        <Text style={styles.big}>
          {t(req.agentAnswer === 'different_amount' ? 'topup.zaadAgent.differentTitle' : 'topup.zaadAgent.notReceivedTitle', {
            agent,
            amount,
          })}
        </Text>
        <Text style={styles.hint}>{t('topup.zaadAgent.disputeHint', { time: clock(disputeLeft) })}</Text>
        <TextInput
          value={disputeText}
          onChangeText={setDisputeText}
          placeholder={t('topup.zaadAgent.disputePlaceholder')}
          placeholderTextColor={colors.ui.ink(0.25)}
          multiline
          style={[styles.input, { fontSize: 16, minHeight: 90 }]}
        />
        {errorLine}
        <Primary
          label={t('topup.zaadAgent.dispute')}
          onPress={() => run(() => disputeZaadAgentTopup(requestId, disputeText.trim()))}
          busy={busy}
          disabled={disputeLeft === 0}
        />
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>{t('topup.zaadAgent.didntSend')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (req.status === 'completed') {
    // T7: the receipt. T8: help for this top-up.
    return (
      <View style={styles.body}>
        <Steps at={3} />
        <Text style={[styles.big, { color: colors.ui.incoming, textAlign: 'center' }]}>
          {t('topup.zaadAgent.done', { amount })}
        </Text>
        <View style={styles.dialBox}>
          <Text style={styles.hint}>{t('topup.agentFlow.receipt.agent', { agent })}</Text>
          <Text style={styles.hint}>{t('topup.agentFlow.receipt.paidByZaad')}</Text>
          {req.customerZaadTxnId ? (
            <Text style={styles.hint}>{t('topup.agentFlow.receipt.txn', { id: req.customerZaadTxnId })}</Text>
          ) : null}
        </View>
        <Primary label={t('common.done')} onPress={() => navigation.goBack()} />
        <TouchableOpacity
          onPress={() => navigation.navigate('RaiseDispute', { transactionId: `zaadagent_${requestId}` })}
        >
          <Text style={styles.link}>{t('topup.agentFlow.somethingWrong')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // no_agent, disputed, released, expired, cancelled
  const again = req.status === 'no_agent' || req.status === 'cancelled' || req.status === 'expired';
  return (
    <View style={[styles.body, styles.center]}>
      <Text style={[styles.big, { textAlign: 'center' }]}>{t(`topup.zaadAgent.ended.${req.status}`, { amount })}</Text>
      {again ? (
        <Primary label={t('common.tryAgain')} onPress={onStartOver} />
      ) : (
        <Primary label={t('common.done')} onPress={() => navigation.goBack()} />
      )}
    </View>
  );
}
