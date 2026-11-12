import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { borderRadius, shadows, makeStyles } from '../theme';

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
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => StyleSheet.create({
  base: {
    borderRadius: borderRadius.lg,
    backgroundColor: colors.ui.glass,
    padding: 16,
  },
  default: {
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
  glass: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
}));
