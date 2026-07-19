import { useEffect } from 'react';
import { useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

/**
 * Animates a numeric value from 0 to `target` with momentum (cubic ease-out).
 * Returns a SharedValue<number> — consume with useAnimatedProps on Animated.Text.
 */
export function useCountUp(target: number, duration = 600): SharedValue<number> {
  const value = useSharedValue(0);

  useEffect(() => {
    value.value = 0;
    value.value = withTiming(target, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [target, value]);

  return value;
}
