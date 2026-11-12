import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DisputeStatus } from '../../services/dispute.service';

const TONE: Record<DisputeStatus, { fg: string; bg: string }> = {
  open: { fg: '#FFB02E', bg: 'rgba(255,176,46,0.15)' },
  under_review: { fg: '#FFB02E', bg: 'rgba(255,176,46,0.15)' },
  awaiting_funds: { fg: '#FF6961', bg: 'rgba(255,105,97,0.15)' },
  resolved: { fg: '#34C77B', bg: 'rgba(52,199,123,0.15)' },
  withdrawn: { fg: 'rgba(255,255,255,0.45)', bg: 'rgba(255,255,255,0.08)' },
};

/** Status from the shop's side: "Reply needed" rather than "Waiting for reply". */
export function DisputeStatusPill({ status, mine }: { status: DisputeStatus; mine: boolean }) {
  const { t } = useTranslation();
  const tone = TONE[status];
  const key = status === 'open' && mine ? 'disputes.status.replyNeeded' : `disputes.status.${status}`;
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>{t(key)}</Text>
    </View>
  );
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  text: { fontSize: 12, fontWeight: '700' },
});
