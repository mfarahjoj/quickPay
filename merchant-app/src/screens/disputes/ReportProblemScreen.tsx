/**
 * Report a problem with a transaction, from the shop's side. Replaces the
 * old "Contact support and quote this ID" alert with a real dispute.
 *
 * The claims offered come from getDisputeOptions; for most payments a shop
 * received that is just "Something else", which goes to the customer and,
 * failing agreement, to Zapp Pay.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, PillButton, TEXT_DIM, TEXT_FAINT } from '../../components';
import {
  DisputeKind,
  DisputeOptions,
  disputeErrorKey,
  getDisputeOptions,
  openDispute,
} from '../../services/dispute.service';
import { money } from './shared';

export default function ReportProblemScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const transactionId: string = route.params?.transactionId;

  const [options, setOptions] = useState<DisputeOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<DisputeKind | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    getDisputeOptions({ transactionId })
      .then((o) => {
        if (!alive) return;
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
  }, [transactionId]);

  const submit = async () => {
    if (!kind || note.trim().length < 3) return;
    setSending(true);
    try {
      const disputeId = await openDispute({ transactionId, kind, note: note.trim() });
      navigation.replace('DisputeDetail', { disputeId });
    } catch (err: any) {
      Alert.alert(t('common.error'), t(disputeErrorKey(err), { days: options?.disputeWindowDays }));
    } finally {
      setSending(false);
    }
  };

  return (
    <DarkScreen scroll keyboard>
      <ScreenHeader title={t('disputes.report.title')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        {loadError ? (
          <Text style={styles.muted}>{loadError}</Text>
        ) : !options ? (
          <ActivityIndicator color="#FFFFFF" style={styles.loader} />
        ) : !options.windowOpen ? (
          <Text style={styles.muted}>{t('disputes.error.windowClosed', { days: options.disputeWindowDays })}</Text>
        ) : (
          <>
            <Text style={styles.lead}>
              {t('disputes.report.lead', { amount: money(options.transactionAmountCents) })}
            </Text>
            {options.allowedKinds.length > 1 && (
              <View style={styles.kinds}>
                {options.allowedKinds.map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={[styles.kind, kind === k && styles.kindSelected]}
                    onPress={() => setKind(k)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: kind === k }}
                  >
                    <Text style={styles.kindText}>{t(`disputes.kind.${k}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput
              style={styles.note}
              value={note}
              onChangeText={setNote}
              placeholder={t('disputes.report.notePlaceholder')}
              placeholderTextColor={TEXT_FAINT}
              multiline
              maxLength={1000}
              textAlignVertical="top"
            />
            <Text style={styles.hint}>
              {options.hasCounterparty ? t('disputes.report.whatNextCounterparty') : t('disputes.report.whatNextOps')}
            </Text>
            <PillButton
              label={t('disputes.report.send')}
              onPress={submit}
              loading={sending}
              disabled={!kind || note.trim().length < 3}
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
  muted: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 32, lineHeight: 21 },
  lead: { fontSize: 15, color: TEXT_DIM, marginBottom: 16, lineHeight: 21 },
  kinds: { marginBottom: 12 },
  kind: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 8,
  },
  kindSelected: { borderColor: 'rgba(26,86,255,0.8)', backgroundColor: 'rgba(26,86,255,0.18)' },
  kindText: { fontSize: 15, color: '#FFFFFF' },
  note: {
    fontSize: 15,
    color: '#FFFFFF',
    minHeight: 120,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 12,
  },
  hint: { fontSize: 13, color: TEXT_FAINT, marginBottom: 20, lineHeight: 18 },
});
