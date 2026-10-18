/**
 * One dispute: where it stands, what happens next, the thread, and a reply
 * box. The raiser can withdraw while it is still being looked at.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header, Button, Card } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import {
  Dispute,
  disputeErrorKey,
  postDisputeMessage,
  useDispute,
  withdrawDispute,
} from '../../services/dispute.service';
import { DisputeStatusPill, money } from './shared';

interface Props {
  navigation: any;
  route: { params: { disputeId: string; justOpened?: boolean } };
}

/** One line on what happens next, from the raiser's side. */
function nextStep(d: Dispute, t: (k: string, o?: any) => string): string {
  switch (d.status) {
    case 'open':
      return t('disputes.next.open', { date: d.respondBy.toLocaleDateString() });
    case 'under_review':
      return t('disputes.next.underReview', { date: d.resolveBy.toLocaleDateString() });
    case 'awaiting_funds':
      return t('disputes.next.awaitingFunds', { amount: money(d.resolution?.amountCents ?? d.amountCents) });
    case 'resolved':
      return d.resolution?.outcome === 'upheld'
        ? t('disputes.next.upheld', { amount: money(d.resolution.amountCents) })
        : t('disputes.next.rejected');
    case 'withdrawn':
      return t('disputes.next.withdrawn');
  }
}

export default function DisputeDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { dispute, loading } = useDispute(route.params.disputeId);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  if (loading || !dispute) {
    return (
      <View style={styles.container}>
        <Header title={t('disputes.detail.title')} onBack={() => navigation.goBack()} />
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.dark.accent} />
        ) : (
          <Text style={styles.muted}>{t('disputes.error.generic')}</Text>
        )}
      </View>
    );
  }

  const isRaiser = dispute.raisedBy === user?.uid;
  const canTalk = dispute.status === 'open' || dispute.status === 'under_review' || dispute.status === 'awaiting_funds';
  const canWithdraw = isRaiser && (dispute.status === 'open' || dispute.status === 'under_review');

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

  const confirmWithdraw = () =>
    Alert.alert(t('disputes.detail.withdrawTitle'), t('disputes.detail.withdrawMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('disputes.detail.withdraw'),
        style: 'destructive',
        onPress: () =>
          withdrawDispute(dispute.id).catch((err) => Alert.alert(t('common.error'), t(disputeErrorKey(err)))),
      },
    ]);

  const who = (role: 'raiser' | 'counterparty' | 'ops', by: string) =>
    role === 'ops'
      ? t('disputes.detail.fromZapp')
      : by === user?.uid
        ? t('disputes.detail.fromYou')
        : t('disputes.detail.fromOther');

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title={t('disputes.detail.title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {route.params.justOpened && <Text style={styles.sent}>{t('disputes.detail.sent')}</Text>}

        <Card style={styles.summary}>
          <View style={styles.summaryTop}>
            <Text style={styles.kind}>{t(`disputes.kind.${dispute.kind}`)}</Text>
            <DisputeStatusPill status={dispute.status} />
          </View>
          <Text style={styles.amount}>{money(dispute.amountCents)}</Text>
          <Text style={styles.next}>{nextStep(dispute, t)}</Text>
          {dispute.resolution?.reason && dispute.status === 'resolved' && (
            <Text style={styles.reason}>{dispute.resolution.reason}</Text>
          )}
        </Card>

        <Text style={styles.sectionLabel}>{t('disputes.detail.thread')}</Text>
        {dispute.messages.map((m, i) => (
          <View key={i} style={[styles.message, m.by === user?.uid && styles.messageMine]}>
            <Text style={styles.messageWho}>
              {who(m.role, m.by)} · {m.at.toLocaleDateString()}
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
              placeholderTextColor={colors.dark.textFaint}
              multiline
              maxLength={1000}
              textAlignVertical="top"
            />
            <Button
              title={t('disputes.detail.send')}
              onPress={send}
              loading={sending}
              disabled={reply.trim().length < 3}
              fullWidth
            />
          </>
        )}

        {canWithdraw && (
          <TouchableOpacity style={styles.withdraw} onPress={confirmWithdraw}>
            <Text style={styles.withdrawText}>{t('disputes.detail.withdraw')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  loader: { marginTop: spacing.xl },
  muted: { ...typography.body, color: colors.dark.textDim, textAlign: 'center', marginTop: spacing.xl },
  sent: {
    ...typography.bodySemibold,
    color: colors.dark.incoming,
    backgroundColor: colors.dark.incomingSoft,
    padding: spacing.smPlus,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  summary: { marginBottom: spacing.lg },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kind: { ...typography.bodySemibold, color: colors.dark.text, flex: 1, marginRight: spacing.sm },
  amount: { ...typography.display, color: colors.dark.text, marginVertical: spacing.sm },
  next: { ...typography.body, color: colors.dark.textDim },
  reason: { ...typography.caption, color: colors.dark.textFaint, marginTop: spacing.sm },
  sectionLabel: {
    ...typography.captionBold,
    color: colors.dark.textDim,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  message: {
    padding: spacing.smPlus,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    marginBottom: spacing.sm,
    marginRight: spacing.xl,
  },
  messageMine: { backgroundColor: colors.dark.glassRaised, marginRight: 0, marginLeft: spacing.xl },
  messageWho: { ...typography.caption, color: colors.dark.textFaint, marginBottom: 2 },
  messageText: { ...typography.body, color: colors.dark.text },
  reply: {
    ...typography.body,
    color: colors.dark.text,
    minHeight: 80,
    padding: spacing.smPlus,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  withdraw: { alignSelf: 'center', marginTop: spacing.lg, padding: spacing.sm },
  withdrawText: { ...typography.bodySemibold, color: colors.dark.error },
});
