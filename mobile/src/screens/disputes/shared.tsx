import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { DisputeStatus } from '../../services/dispute.service';

const TONE: Record<DisputeStatus, { fg: string; bg: string }> = {
  open: { fg: colors.dark.warning, bg: 'rgba(245,166,35,0.15)' },
  under_review: { fg: colors.dark.warning, bg: 'rgba(245,166,35,0.15)' },
  awaiting_funds: { fg: colors.dark.accentText, bg: colors.dark.accentSoft },
  resolved: { fg: colors.dark.incoming, bg: colors.dark.incomingSoft },
  withdrawn: { fg: colors.dark.textDim, bg: colors.dark.glass },
};

/** Status as the person who raised it would put it. */
export function DisputeStatusPill({ status }: { status: DisputeStatus }) {
  const { t } = useTranslation();
  const tone = TONE[status];
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.pillText, { color: tone.fg }]}>{t(`disputes.status.${status}`)}</Text>
    </View>
  );
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  pillText: {
    ...typography.captionBold,
  },
});
