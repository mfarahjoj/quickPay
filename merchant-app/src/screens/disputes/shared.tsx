import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, type Colors, makeStyles } from '../../theme';
import type { DisputeStatus } from '../../services/dispute.service';

const tones = (colors: Colors): Record<DisputeStatus, { fg: string; bg: string }> => ({
  open: { fg: colors.ui.warning, bg: colors.ui.warningSoft },
  under_review: { fg: colors.ui.warning, bg: colors.ui.warningSoft },
  awaiting_funds: { fg: colors.ui.error, bg: colors.ui.errorSoft },
  resolved: { fg: colors.ui.incoming, bg: colors.ui.incomingSoft },
  withdrawn: { fg: colors.ui.textDim, bg: colors.ui.glassRaised },
});

/** Status from the shop's side: "Reply needed" rather than "Waiting for reply". */
export function DisputeStatusPill({ status, mine }: { status: DisputeStatus; mine: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const tone = tones(colors)[status];
  const key = status === 'open' && mine ? 'disputes.status.replyNeeded' : `disputes.status.${status}`;
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>{t(key)}</Text>
    </View>
  );
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const useStyles = makeStyles((colors) => StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  text: { fontSize: 12, fontWeight: '700' },
}));
