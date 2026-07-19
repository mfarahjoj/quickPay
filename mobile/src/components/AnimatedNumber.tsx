import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';
import { typography } from '../theme';

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  style?: object;
}

export function AnimatedNumber({
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  style,
}: AnimatedNumberProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSequence(
      withSpring(1.08, { damping: 12 }),
      withSpring(1)
    );
  }, [value]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.Text style={[styles.text, style, animatedStyle]}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  text: {
    ...typography.h1,
  },
});
