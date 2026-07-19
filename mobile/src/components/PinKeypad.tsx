import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { colors, typography, spacing } from '../theme';
import { triggerHaptic } from '../services/haptics.service';
import { Springs } from '../constants/springs';

const PIN_LENGTH = 6;

const KEYS: Array<string | null> = [
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  null, '0', '⌫',
];

// ─── PinDot ──────────────────────────────────────────────────

function PinDot({ filled }: { filled: boolean }) {
  const scale = useSharedValue(filled ? 1 : 0.01);
  const opacity = useSharedValue(filled ? 1 : 0);

  useEffect(() => {
    if (filled) {
      scale.value = withSequence(
        withSpring(1.4, Springs.celebration),
        withSpring(1, Springs.feedback),
      );
      opacity.value = withTiming(1, { duration: 80 });
    } else {
      scale.value = withTiming(0.3, { duration: 60 });
      opacity.value = withTiming(0, { duration: 60 });
    }
  }, [filled, scale, opacity]);

  const filledStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.dotContainer}>
      <View style={styles.dotEmpty} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.dotFilled, filledStyle]} />
    </View>
  );
}

// ─── KeyButton ───────────────────────────────────────────────

function KeyButton({ keyLabel, onPress }: { keyLabel: string; onPress: () => void }) {
  const isBackspace = keyLabel === '⌫';
  const scale = useSharedValue(1);
  const rotateZ = useSharedValue(0);

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotateZ: `${rotateZ.value}deg` }],
  }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withTiming(0.88, { duration: 60, easing: Easing.out(Easing.quad) });
        if (isBackspace) rotateZ.value = withTiming(-15, { duration: 80 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, Springs.feedback);
        if (isBackspace) rotateZ.value = withSpring(0, Springs.feedback);
      }}
      onPress={onPress}
      accessibilityLabel={isBackspace ? 'Delete' : keyLabel}
    >
      <Animated.View
        style={[styles.key, isBackspace && styles.keyBackspace, buttonStyle]}
      >
        <Text style={[styles.keyText, isBackspace && styles.keyBackspaceText]}>
          {keyLabel}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── PinKeypad ───────────────────────────────────────────────

interface PinKeypadProps {
  value: string;
  onChange: (val: string) => void;
  onComplete?: (val: string) => void;
  title: string;
  subtitle?: string;
  error?: string;
}

export function PinKeypad({ value, onChange, onComplete, title, subtitle, error }: PinKeypadProps) {
  const shakeX = useSharedValue(0);
  const errorGlow = useSharedValue(0);

  useEffect(() => {
    if (!error) return;
    shakeX.value = withSequence(
      withTiming(10, { duration: 50 }),
      withTiming(-10, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-8, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
    errorGlow.value = withSequence(
      withTiming(1, { duration: 80 }),
      withTiming(0, { duration: 450 }),
    );
  }, [error, shakeX, errorGlow]);

  const handlePress = (key: string) => {
    triggerHaptic('light');
    if (key === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= PIN_LENGTH) return;
    const next = value + key;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  };

  const dotsRowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255, 92, 92, ${errorGlow.value * 0.12})`,
  }));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <Animated.View style={[styles.dotsGlow, glowStyle]}>
        <Animated.View style={[styles.dotsRow, dotsRowStyle]}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <PinDot key={i} filled={i < value.length} />
          ))}
        </Animated.View>
      </Animated.View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.grid}>
        {KEYS.map((key, i) => {
          if (key === null) return <View key={i} style={styles.keyPlaceholder} />;
          return (
            <KeyButton key={i} keyLabel={key} onPress={() => handlePress(key)} />
          );
        })}
      </View>
    </View>
  );
}

const KEY_SIZE = 76;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.dark.canvas,
  },
  title: {
    ...typography.h2,
    color: colors.dark.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.dark.textDim,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  dotsGlow: {
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dotContainer: {
    width: 14,
    height: 14,
    position: 'relative',
  },
  dotEmpty: {
    ...StyleSheet.absoluteFill,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.dark.glassBorder,
  },
  dotFilled: {
    borderRadius: 7,
    backgroundColor: colors.dark.text,
  },
  errorText: {
    ...typography.caption,
    color: colors.dark.error,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: KEY_SIZE * 3 + spacing.xl * 2,
    gap: spacing.xl,
    marginTop: spacing.xl,
    justifyContent: 'center',
  },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_SIZE / 2,
    borderWidth: 1.5,
    borderColor: colors.dark.glassBorder,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
  },
  keyBackspace: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  keyText: {
    fontSize: 26,
    fontWeight: '400',
    color: colors.dark.text,
    lineHeight: 32,
  },
  keyBackspaceText: {
    fontSize: 22,
    color: colors.dark.textDim,
  },
  keyPlaceholder: {
    width: KEY_SIZE,
    height: KEY_SIZE,
  },
});
