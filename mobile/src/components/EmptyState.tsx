import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from './Button';
import { colors, typography, spacing } from '../theme';
import {
  EmptyTransactionsIcon,
  EmptyNotificationsIcon,
  EmptyRequestsIcon,
} from './icons/UIIcons';

type EmptyVariant = 'transactions' | 'notifications' | 'requests' | 'generic';

interface EmptyStateProps {
  variant?: EmptyVariant;
  icon?: React.ReactNode;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

function DefaultIcon({ variant }: { variant: EmptyVariant }) {
  switch (variant) {
    case 'transactions':
      return <EmptyTransactionsIcon size={120} />;
    case 'notifications':
      return <EmptyNotificationsIcon size={120} />;
    case 'requests':
      return <EmptyRequestsIcon size={120} />;
    default:
      return <EmptyNotificationsIcon size={120} />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  iconWrap: {
    marginBottom: spacing.lg,
    opacity: 0.85,
  },
  title: {
    ...typography.h3,
    color: colors.dark.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    color: colors.dark.textDim,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  button: {
    minWidth: 160,
  },
});

export function EmptyState({
  variant = 'generic',
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        {icon ?? <DefaultIcon variant={variant} />}
      </View>
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {actionLabel && onAction && (
        <Button
          title={actionLabel}
          onPress={onAction}
          variant="primary"
          style={styles.button}
        />
      )}
    </View>
  );
}
