/**
 * One dispute from the shop's side: the claim, the deadline, the thread.
 *
 * For a claim on a whole counter payment the merchant can settle it at once
 * with "Accept & refund": that runs the normal refund (refundPayment, under
 * the PIN), and the backend closes the dispute in the same transaction.
 * Anything else — a partial claim, a cash or P2P dispute — is answered with a
 * reply and decided by Zapp Pay.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  DarkScreen,
  ScreenHeader,
  GlassCard,
  PillButton,
  PinInput,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import { useAuth } from '../../hooks/useAuth';
import { functions } from '../../services/firebase.config';
import {
  Dispute,
  canAcceptByRefund,
  disputeErrorKey,
  postDisputeMessage,
  useDispute,
} from '../../services/dispute.service';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { DisputeStatusPill, money } from './shared';

function nextStep(d: Dispute, mine: boolean, t: (k: string, o?: any) => string): string {
  if (d.status === 'open') {
    return mine
      ? t('disputes.next.replyBy', { date: d.respondBy.toLocaleDateString() })
      : t('disputes.next.waitingForThem', { date: d.respondBy.toLocaleDateString() });
  }
  if (d.status === 'under_review') return t('disputes.next.underReview', { date: d.resolveBy.toLocaleDateString() });
  if (d.status === 'awaiting_funds') {
    return mine
      ? t('disputes.next.youOwe', { amount: money(d.owedCents ?? d.amountCents) })
      : t('disputes.next.awaitingFunds', { amount: money(d.resolution?.amountCents ?? d.amountCents) });
  }
  if (d.status === 'withdrawn') return t('disputes.next.withdrawn');
  return d.resolution?.outcome === 'upheld'
    ? t('disputes.next.upheld', { amount: money(d.resolution.amountCents) })
    : t('disputes.next.rejected');
}

export default function DisputeDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const { dispute, loading } = useDispute(route.params?.disputeId);

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [pinStep, setPinStep] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);

  if (loading || !dispute) {
    return (
      <DarkScreen>
        <ScreenHeader title={t('disputes.detail.title')} onBack={() => navigation.goBack()} />
        {loading ? (
          <ActivityIndicator color="#FFFFFF" style={styles.loader} />
        ) : (
          <Text style={styles.muted}>{t('disputes.error.generic')}</Text>
        )}
      </DarkScreen>
    );
  }

  const mine = dispute.against === user?.uid;
  const canTalk = ['open', 'under_review', 'awaiting_funds'].includes(dispute.status);
  const acceptable = canAcceptByRefund(dispute, user?.uid);

  const send = async () => {
    const text = reply.trim();
    if (text.length < 3) return;
    setSending(true);
    try {
      await postDisputeMessage(dispute.id, text);
      setReply('');
    } catch (err) {
      Alert.alert(t('common.error'), t(disputeErrorKey(err)));
    } finally {
      setSending(false);
    }
  };

  const refund = async (enteredPin: string) => {
    if (refunding) return;
    setRefunding(true);
    try {
      await functions().httpsCallable('refundPayment')({ transactionId: dispute.transactionId, pin: enteredPin });
      setPinStep(false);
      Alert.alert(t('common.success'), t('disputes.detail.refunded', { amount: money(dispute.amountCents) }));
    } catch (e: any) {
      if (isWrongPin(e)) {
        setPinError(t('errors.wrongPin'));
      } else {
        setPinStep(false);
        const reason = e?.details?.reason;
        Alert.alert(
          t('common.error'),
          reason === 'refund_window_closed'
            ? t('disputes.detail.refundWindowClosed', { days: e.details.refundWindowDays })
            : t(pinActionErrorKey(e))
        );
      }
    } finally {
      setPin('');
      setRefunding(false);
    }
  };

  if (pinStep) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('disputes.detail.refundPinTitle')}</Text>
        <Text style={styles.sub}>{t('disputes.detail.refundPinSubtitle', { amount: money(dispute.amountCents) })}</Text>
        <PinInput
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (pinError) setPinError(null);
          }}
          onComplete={refund}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        {refunding ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={() => setPinStep(false)} disabled={refunding} />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard>
      <ScreenHeader title={t('disputes.detail.title')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <GlassCard style={styles.summary}>
          <View style={styles.summaryTop}>
            <Text style={styles.kind}>{t(`disputes.kind.${dispute.kind}`)}</Text>
            <DisputeStatusPill status={dispute.status} mine={mine} />
          </View>
          <Text style={styles.amount}>{money(dispute.amountCents)}</Text>
          <Text style={styles.next}>{nextStep(dispute, mine, t)}</Text>
          {dispute.status === 'resolved' && dispute.resolution?.reason ? (
            <Text style={styles.reason}>{dispute.resolution.reason}</Text>
          ) : null}
        </GlassCard>

        {acceptable && (
          <View style={styles.accept}>
            <PillButton label={t('disputes.detail.acceptRefund')} onPress={() => setPinStep(true)} />
            <Text style={styles.acceptHint}>{t('disputes.detail.acceptRefundHint')}</Text>
          </View>
        )}

        <Text style={styles.section}>{t('disputes.detail.thread')}</Text>
        {dispute.messages.map((m, i) => (
          <View key={i} style={[styles.message, m.by === user?.uid && styles.messageMine]}>
            <Text style={styles.messageWho}>
              {m.role === 'ops'
                ? t('disputes.detail.fromZapp')
                : m.by === user?.uid
                  ? t('disputes.detail.fromYou')
                  : t('disputes.detail.fromCustomer')}{' '}
              · {m.at.toLocaleDateString()}
            </Text>
            <Text style={styles.messageText}>{m.text}</Text>
          </View>
        ))}

        {canTalk && (
          <>
            <TextInput
              style={styles.reply}
              value={reply}
              onChangeText={setReply}
              placeholder={t('disputes.detail.replyPlaceholder')}
              placeholderTextColor={TEXT_FAINT}
              multiline
              maxLength={1000}
              textAlignVertical="top"
            />
            <PillButton
              label={t('disputes.detail.send')}
              onPress={send}
              loading={sending}
              disabled={reply.trim().length < 3}
              variant="glass"
            />
          </>
        )}
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  loader: { marginTop: 32 },
  muted: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', letterSpacing: -0.5 },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  summary: { padding: 18, marginBottom: 16 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', flex: 1, marginRight: 10 },
  amount: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', marginVertical: 8, letterSpacing: -0.6 },
  next: { fontSize: 14, color: TEXT_DIM, lineHeight: 20 },
  reason: { fontSize: 13, color: TEXT_FAINT, marginTop: 8 },
  accept: { marginBottom: 16 },
  acceptHint: { fontSize: 13, color: TEXT_FAINT, marginTop: 8, lineHeight: 18 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_FAINT,
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  message: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
    marginRight: 32,
  },
  messageMine: { backgroundColor: 'rgba(26,86,255,0.18)', marginRight: 0, marginLeft: 32 },
  messageWho: { fontSize: 12, color: TEXT_FAINT, marginBottom: 3 },
  messageText: { fontSize: 15, color: '#FFFFFF', lineHeight: 21 },
  reply: {
    fontSize: 15,
    color: '#FFFFFF',
    minHeight: 80,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginTop: 12,
    marginBottom: 10,
  },
});
