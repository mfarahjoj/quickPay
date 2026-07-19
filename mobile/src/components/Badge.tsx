import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, typography, borderRadius } from '../theme';

type BadgeVariant = 'completed' | 'pending' | 'failed' | 'cancelled';

interface BadgeProps {
  status: BadgeVariant;
  label?: string;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; labelKey: string }> = {
  completed: {
    bg: colors.successLight,
    text: colors.successDark,
    labelKey: 'transaction.status.completed',
  },
  pending: {
    bg: colors.warningLight,
    text: colors.warning,
    labelKey: 'transaction.status.pending',
  },
  failed: {
    bg: colors.errorLight,
    text: colors.error,
    labelKey: 'transaction.status.failed',
  },
  cancelled: {
    bg: colors.background.tertiary,
    text: colors.text.secondary,
    labelKey: 'transaction.status.cancelled',
  },
};

export function Badge({ status, label }: BadgeProps) {
  const { t } = useTranslation();
  const style = variantStyles[status];
  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.text, { color: style.text }]}>
        {label ?? t(style.labelKey)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  text: {
    ...typography.captionBold,
    textTransform: 'capitalize',
  },
});
