import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, borderRadius, shadows } from '../theme';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'glass';
  style?: ViewStyle;
}

export function Card({
  children,
  variant = 'default',
  style,
}: CardProps) {
  if (variant === 'glass') {
    return (
      <View style={[styles.base, styles.glass, style]}>
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.base, styles.default, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background.primary,
    padding: 16,
  },
  default: {
    ...shadows.md,
  },
  glass: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    ...shadows.md,
  },
});
