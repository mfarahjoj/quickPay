import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { typography, spacing, borderRadius, useColors, type Colors } from '../../theme';
import type { DisputeStatus } from '../../services/dispute.service';
import { formatMoney } from '../../utils/money';

const tones = (colors: Colors): Record<DisputeStatus, { fg: string; bg: string }> => ({
  open: { fg: colors.ui.warning, bg: 'rgba(245,166,35,0.15)' },
  under_review: { fg: colors.ui.warning, bg: 'rgba(245,166,35,0.15)' },
  awaiting_funds: { fg: colors.ui.accentText, bg: colors.ui.accentSoft },
  resolved: { fg: colors.ui.incoming, bg: colors.ui.incomingSoft },
  withdrawn: { fg: colors.ui.textDim, bg: colors.ui.glass },
});

/** Status as the person who raised it would put it. */
export function DisputeStatusPill({ status }: { status: DisputeStatus }) {
  const colors = useColors();
  const { t } = useTranslation();
  const tone = tones(colors)[status];
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.pillText, { color: tone.fg }]}>{t(`disputes.status.${status}`)}</Text>
    </View>
  );
}

/** A disputed amount in its own currency: "$12.00" or "25,000 SLSH", never shillings read as cents. */
export const money = (amount: number, currency: unknown = 'USD') => formatMoney(amount, currency);

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
