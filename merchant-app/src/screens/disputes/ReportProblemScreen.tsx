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
import { DarkScreen, ScreenHeader, PillButton } from '../../components';
import {
  DisputeKind,
  DisputeOptions,
  disputeErrorKey,
  getDisputeOptions,
  openDispute,
} from '../../services/dispute.service';
import { money } from './shared';
import { makeStyles, useColors } from '../../theme';

export default function ReportProblemScreen() {
  const colors = useColors();
  const styles = useStyles();
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
          <ActivityIndicator color={colors.ui.text} style={styles.loader} />
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
              placeholderTextColor={colors.ui.textFaint}
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

const useStyles = makeStyles((colors) => StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  loader: { marginTop: 32 },
  muted: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', marginTop: 32, lineHeight: 21 },
  lead: { fontSize: 15, color: colors.ui.textDim, marginBottom: 16, lineHeight: 21 },
  kinds: { marginBottom: 12 },
  kind: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    marginBottom: 8,
  },
  kindSelected: { borderColor: 'rgba(26,86,255,0.8)', backgroundColor: colors.ui.accentSoft },
  kindText: { fontSize: 15, color: colors.ui.text },
  note: {
    fontSize: 15,
    color: colors.ui.text,
    minHeight: 120,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    marginBottom: 12,
  },
  hint: { fontSize: 13, color: colors.ui.textFaint, marginBottom: 20, lineHeight: 18 },
}));
