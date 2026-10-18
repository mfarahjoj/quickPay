/**
 * Get help with a payment: pick what went wrong, say what happened, send.
 *
 * The claims offered come from the server (getDisputeOptions), so the app
 * never offers one the backend would refuse. If this transaction was already
 * disputed, it goes straight to that dispute instead.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header, Button } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';
import {
  DisputeKind,
  DisputeOptions,
  DisputeTarget,
  disputeErrorKey,
  getDisputeOptions,
  openDispute,
} from '../../services/dispute.service';
import { money } from './shared';

interface Props {
  navigation: any;
  route: { params: DisputeTarget & { title?: string } };
}

const MIN_NOTE = 3;

export default function RaiseDisputeScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const target: DisputeTarget = {
    ...(route.params.transactionId ? { transactionId: route.params.transactionId } : {}),
    ...(route.params.agentTopupRequestId
      ? { agentTopupRequestId: route.params.agentTopupRequestId }
      : {}),
  };

  const [options, setOptions] = useState<DisputeOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<DisputeKind | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    getDisputeOptions(target)
      .then((o) => {
        if (!alive) return;
        // Already disputed: show that one rather than a dead end.
        if (o.existingDisputeId) {
          navigation.replace('DisputeDetail', { disputeId: o.existingDisputeId });
          return;
        }
        setOptions(o);
        if (o.allowedKinds.length === 1) setKind(o.allowedKinds[0]);
      })
      .catch((err) => alive && setLoadError(t(disputeErrorKey(err))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!kind || note.trim().length < MIN_NOTE) return;
    setSending(true);
    try {
      const disputeId = await openDispute({ ...target, kind, note: note.trim() });
      navigation.replace('DisputeDetail', { disputeId, justOpened: true });
    } catch (err: any) {
      Alert.alert(t('common.error'), t(disputeErrorKey(err), { days: options?.disputeWindowDays }));
    } finally {
      setSending(false);
    }
  };

  const body = () => {
    if (loadError) {
      return <Text style={styles.errorText}>{loadError}</Text>;
    }
    if (!options) {
      return <ActivityIndicator style={styles.loader} color={colors.dark.accent} />;
    }
    if (!options.windowOpen) {
      return (
        <Text style={styles.errorText}>
          {t('disputes.error.windowClosed', { days: options.disputeWindowDays })}
        </Text>
      );
    }
    return (
      <>
        <Text style={styles.lead}>
          {t('disputes.raise.lead', { amount: money(options.transactionAmountCents) })}
        </Text>

        <Text style={styles.sectionLabel}>{t('disputes.raise.whatHappened')}</Text>
        <View style={styles.kinds}>
          {options.allowedKinds.map((k) => (
            <TouchableOpacity
              key={k}
              style={[styles.kind, kind === k && styles.kindSelected]}
              onPress={() => setKind(k)}
              accessibilityRole="radio"
              accessibilityState={{ selected: kind === k }}
            >
              <View style={[styles.radio, kind === k && styles.radioSelected]} />
              <Text style={styles.kindText}>{t(`disputes.kind.${k}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>{t('disputes.raise.tellUs')}</Text>
        <TextInput
          style={styles.note}
          value={note}
          onChangeText={setNote}
          placeholder={t('disputes.raise.notePlaceholder')}
          placeholderTextColor={colors.dark.textFaint}
          multiline
          maxLength={1000}
          textAlignVertical="top"
        />

        <Text style={styles.hint}>
          {options.hasCounterparty ? t('disputes.raise.whatNextCounterparty') : t('disputes.raise.whatNextOps')}
        </Text>

        <Button
          title={t('disputes.raise.send')}
          onPress={submit}
          loading={sending}
          disabled={!kind || note.trim().length < MIN_NOTE}
          fullWidth
          style={styles.send}
        />
      </>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title={t('disputes.raise.title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {body()}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  loader: { marginTop: spacing.xl },
  lead: { ...typography.body, color: colors.dark.textDim, marginBottom: spacing.lg },
  sectionLabel: {
    ...typography.captionBold,
    color: colors.dark.textDim,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  kinds: { marginBottom: spacing.lg },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.smPlus,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    marginBottom: spacing.sm,
  },
  kindSelected: { borderColor: colors.dark.accentBorder, backgroundColor: colors.dark.accentSoft },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.dark.textFaint,
    marginRight: spacing.smPlus,
  },
  radioSelected: { borderColor: colors.dark.accent, backgroundColor: colors.dark.accent },
  kindText: { ...typography.body, color: colors.dark.text, flex: 1 },
  note: {
    ...typography.body,
    color: colors.dark.text,
    minHeight: 120,
    padding: spacing.smPlus,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    marginBottom: spacing.md,
  },
  hint: { ...typography.caption, color: colors.dark.textFaint, marginBottom: spacing.lg },
  send: { marginTop: spacing.sm },
  errorText: { ...typography.body, color: colors.dark.textDim, marginTop: spacing.xl, textAlign: 'center' },
});
