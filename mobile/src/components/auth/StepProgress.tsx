import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
}

export function StepProgress({ currentStep, totalSteps }: StepProgressProps) {
  const { t } = useTranslation();
  const widthAnim = useRef(new Animated.Value(0)).current;
  const progress = currentStep / totalSteps;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: progress,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  const barWidth = widthAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {t('auth.stepProgress', { current: currentStep, total: totalSteps })}
      </Text>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: barWidth }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.captionBold,
    color: colors.dark.textFaint,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  track: {
    height: 4,
    backgroundColor: colors.dark.glassBorder,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.dark.accent,
    borderRadius: borderRadius.full,
  },
});
