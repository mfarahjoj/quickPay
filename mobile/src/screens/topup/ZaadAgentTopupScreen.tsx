/**
 * Top up with Zaad through an agent, from anywhere.
 *
 *   amount    how much, in dollars
 *   finding   Zapp rings online agents one at a time
 *   pay       an agent accepted: send the amount to their Zaad (dial button
 *             on Android, copy on iOS), then enter the Zaad transaction ID
 *   waiting   the agent checks their Zaad and confirms
 *   declined  the agent says nothing arrived: dispute it if you sent it
 *   done      credited
 *
 * The agent's float pays the wallet; the agent is repaid by the Zaad the
 * customer sent. Only pay from your own number: the agent checks it.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { triggerHaptic } from '../../services/haptics.service';
import { amountCents, formatLocal } from '../../services/mobileMoney.service';
import {
  cancelZaadAgentTopup,
  disputeZaadAgentTopup,
  markZaadSent,
  normaliseTxnId,
  requestZaadAgentTopup,
  watchZaadAgentTopup,
  type ZaadAgentTopupDoc,
} from '../../services/zaadAgent.service';
import { useColors } from '../../theme';
import { formatMoney } from '../../utils/money';
import { DialPanel, Primary, Waiting, useStyles } from './ZaadTopupScreen';

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

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

export default function ZaadAgentTopupScreen() {
  const colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [amountText, setAmountText] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [req, setReq] = useState<ZaadAgentTopupDoc | null>(null);
  const [txnText, setTxnText] = useState('');
  const [disputeText, setDisputeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!requestId) return;
    return watchZaadAgentTopup(requestId, (doc) => {
      if (doc?.status === 'completed') triggerHaptic('success');
      setReq(doc);
    });
  }, [requestId]);

  const sendLeft = useSecondsLeft(req?.status === 'accepted' ? req.sendBy : undefined);
  const disputeLeft = useSecondsLeft(req?.status === 'declined' ? req.disputeUntil : undefined);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      // A top-up already in progress: carry on with it.
      if (e?.details?.reason === 'in_progress' && e.details.requestId) {
        setRequestId(e.details.requestId);
      } else {
        setError(e?.message || t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  const ask = () => {
    const cents = amountCents(amountText);
    if (!cents) return;
    triggerHaptic('medium');
    return run(async () => setRequestId((await requestZaadAgentTopup(cents)).requestId));
  };

  const startOver = () => {
    setRequestId(null);
    setReq(null);
    setTxnText('');
    setDisputeText('');
    setError('');
  };

  const pressKey = (key: string) => {
    triggerHaptic('light');
    if (key === '⌫') return setAmountText((p) => p.slice(0, -1));
    if (key === '.' && amountText.includes('.')) return;
    if (/\.\d{2}$/.test(amountText)) return;
    setAmountText((p) => p + key);
  };

  const amount = req ? formatMoney(req.amount, 'USD') : '';
  const errorLine = error ? <Text style={styles.errorText}>{error}</Text> : null;

  let body: React.ReactNode;
  if (!requestId) {
    body = (
      <View style={styles.body}>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
          ${amountText || '0'}
        </Text>
        <Text style={styles.hint}>{t('topup.zaadAgent.amountHint')}</Text>
        <View style={styles.keypad}>
          {KEYPAD.map((k) => (
            <TouchableOpacity key={k} style={styles.key} onPress={() => pressKey(k)}>
              <Text style={styles.keyText}>{k}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {errorLine}
        <Primary label={t('topup.zaadAgent.findAgent')} onPress={ask} busy={busy} disabled={!amountCents(amountText)} />
      </View>
    );
  } else if (!req) {
    body = <ActivityIndicator color={colors.ui.accentText} style={styles.loading} />;
  } else if (req.status === 'offered') {
    body = (
      <View style={styles.body}>
        <Text style={styles.big}>{t('topup.zaadAgent.findingTitle', { amount })}</Text>
        <Waiting text={t('topup.zaadAgent.finding')} />
        {errorLine}
        <TouchableOpacity onPress={() => run(() => cancelZaadAgentTopup(requestId))}>
          <Text style={styles.link}>{t('topup.zaadAgent.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (req.status === 'accepted') {
    const txn = normaliseTxnId(txnText);
    body = (
      <View style={styles.body}>
        <Text style={styles.big}>
          {t('topup.zaadAgent.payTitle', { agent: req.agentName ?? '', amount })}
        </Text>
        <Text style={styles.hint}>
          {t('topup.zaadAgent.payBody', {
            amount,
            number: formatLocal(req.agentReceiveMsisdn ?? ''),
            time: clock(sendLeft),
          })}
        </Text>
        <DialPanel code={req.dialCode ?? null} />
        <Text style={styles.label}>{t('topup.zaadAgent.txnLabel')}</Text>
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
          onPress={() => txn && run(() => markZaadSent(requestId, txn))}
          busy={busy}
          disabled={!txn}
        />
        <TouchableOpacity onPress={() => run(() => cancelZaadAgentTopup(requestId))}>
          <Text style={styles.link}>{t('topup.zaadAgent.cancelNotSent')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (req.status === 'customer_sent') {
    body = (
      <View style={styles.body}>
        <Text style={styles.big}>{t('topup.zaadAgent.checkingTitle', { agent: req.agentName ?? '' })}</Text>
        <Waiting text={t('topup.zaadAgent.checking', { amount })} />
        <Text style={styles.hint}>{t('topup.zaadAgent.checkingHint')}</Text>
      </View>
    );
  } else if (req.status === 'declined') {
    body = (
      <View style={styles.body}>
        <Text style={styles.big}>
          {t(req.agentAnswer === 'different_amount' ? 'topup.zaadAgent.differentTitle' : 'topup.zaadAgent.notReceivedTitle', {
            agent: req.agentName ?? '',
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
  } else if (req.status === 'completed') {
    body = (
      <View style={[styles.body, styles.center]}>
        <Text style={[styles.big, { color: colors.ui.incoming, textAlign: 'center' }]}>
          {t('topup.zaadAgent.done', { amount })}
        </Text>
        <Primary label={t('common.done')} onPress={() => navigation.goBack()} />
      </View>
    );
  } else {
    // no_agent, disputed, released, expired, cancelled
    const again = req.status === 'no_agent' || req.status === 'cancelled' || req.status === 'expired';
    body = (
      <View style={[styles.body, styles.center]}>
        <Text style={[styles.big, { textAlign: 'center' }]}>{t(`topup.zaadAgent.ended.${req.status}`, { amount })}</Text>
        {again ? (
          <Primary label={t('common.tryAgain')} onPress={startOver} />
        ) : (
          <Primary label={t('common.done')} onPress={() => navigation.goBack()} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('topup.zaadAgent.title')}</Text>
          <Text style={styles.headerSub}>{t('topup.zaadAgent.subtitle')}</Text>
        </View>
      </View>
      {body}
    </View>
  );
}
