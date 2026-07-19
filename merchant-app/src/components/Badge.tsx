import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, typography, borderRadius } from '../theme';

type BadgeVariant = 'completed' | 'pending' | 'failed' | 'cancelled';

interface BadgeProps {
  status: BadgeVariant;
  label?: string;
}

const BADGE_KEYS: Record<BadgeVariant, string> = {
  completed: 'components.badge.completed',
  pending: 'components.badge.pending',
  failed: 'components.badge.failed',
  cancelled: 'components.badge.cancelled',
};

const variantStyles: Record<BadgeVariant, { bg: string; text: string }> = {
  completed: {
    bg: colors.successLight,
    text: colors.successDark,
  },
  pending: {
    bg: colors.warningLight,
    text: colors.warning,
  },
  failed: {
    bg: colors.errorLight,
    text: colors.error,
  },
  cancelled: {
    bg: colors.background.tertiary,
    text: colors.text.secondary,
  },
};

export function Badge({ status, label }: BadgeProps) {
  const { t } = useTranslation();
  const style = variantStyles[status];
  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.text, { color: style.text }]}>
        {label ?? t(BADGE_KEYS[status])}
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
