import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, typography, spacing, shadows } from '../../theme';

interface AuthHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  highlight?: string;
  centered?: boolean;
}

export function AuthHeader({ icon, title, subtitle, highlight, centered = true }: AuthHeaderProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [fade, slide]);

  return (
    <Animated.View
      style={[
        styles.container,
        centered && styles.centered,
        { opacity: fade, transform: [{ translateY: slide }] },
      ]}
    >
      {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
      <Text style={[styles.title, centered && styles.textCenter]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, centered && styles.textCenter]}>{subtitle}</Text>
      ) : null}
      {highlight ? <Text style={[styles.highlight, centered && styles.textCenter]}>{highlight}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  centered: {
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.background.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.medium,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.2,
    color: '#000000',
    marginBottom: spacing.smPlus,
  },
  subtitle: {
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 26,
    color: '#8E8E93',
  },
  highlight: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  textCenter: {
    textAlign: 'center',
  },
});
