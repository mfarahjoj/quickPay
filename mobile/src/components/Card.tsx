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
    backgroundColor: colors.dark.glass,
    padding: 16,
  },
  default: {
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
  glass: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
});
