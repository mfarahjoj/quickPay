import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withSpring,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { colors } from '../../theme';
import { Springs } from '../../constants/springs';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface StatusIconProps {
  size?: number;
  color?: string;
  onComplete?: () => void;
}

// Checkmark path length estimate for strokeDasharray (viewBox 0 0 32 32)
// M8,16 → L14,22: ~8.5, L14,22 → L25,10: ~15.6 — total ~24
const CHECK_PATH_LENGTH = 26;

// X mark path length estimate — each diagonal ~19 units
const X_PATH_LENGTH = 20;

// ─── Animated Check Mark ─────────────────────────────────────

export function AnimatedCheckMark({
  size = 36,
  color = colors.dark.incoming,
  onComplete,
}: StatusIconProps) {
  const circleScale = useSharedValue(0);
  const dashOffset = useSharedValue(CHECK_PATH_LENGTH);

  useEffect(() => {
    circleScale.value = withSpring(1, Springs.celebration);
    dashOffset.value = withDelay(
      160,
      withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) }),
    );
    if (onComplete) {
      const timer = setTimeout(onComplete, 600);
      return () => clearTimeout(timer);
    }
  }, [circleScale, dashOffset, onComplete]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
  }));

  const pathProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, circleStyle]}>
      <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        <Circle cx="16" cy="16" r="15" fill={`${color}20`} stroke={color} strokeWidth={1.5} />
        <AnimatedPath
          d="M8 16l6 6 10-10"
          stroke={color}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={CHECK_PATH_LENGTH}
          animatedProps={pathProps as any}
        />
      </Svg>
    </Animated.View>
  );
}

// ─── Animated X Mark ─────────────────────────────────────────

export function AnimatedXMark({
  size = 36,
  color = colors.dark.error,
  onComplete,
}: StatusIconProps) {
  const circleScale = useSharedValue(0);
  const dash1 = useSharedValue(X_PATH_LENGTH);
  const dash2 = useSharedValue(X_PATH_LENGTH);

  useEffect(() => {
    circleScale.value = withSpring(1, Springs.celebration);
    dash1.value = withDelay(120, withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) }));
    dash2.value = withDelay(260, withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) }));
    if (onComplete) {
      const timer = setTimeout(onComplete, 600);
      return () => clearTimeout(timer);
    }
  }, [circleScale, dash1, dash2, onComplete]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
  }));

  const path1Props = useAnimatedProps(() => ({ strokeDashoffset: dash1.value }));
  const path2Props = useAnimatedProps(() => ({ strokeDashoffset: dash2.value }));

  return (
    <Animated.View style={[{ width: size, height: size }, circleStyle]}>
      <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        <Circle cx="16" cy="16" r="15" fill={`${color}20`} stroke={color} strokeWidth={1.5} />
        <AnimatedPath
          d="M10 10l12 12"
          stroke={color}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeDasharray={X_PATH_LENGTH}
          animatedProps={path1Props as any}
        />
        <AnimatedPath
          d="M22 10L10 22"
          stroke={color}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeDasharray={X_PATH_LENGTH}
          animatedProps={path2Props as any}
        />
      </Svg>
    </Animated.View>
  );
}

// ─── Animated Warning ─────────────────────────────────────────

export function AnimatedWarning({
  size = 36,
  color = colors.dark.warning,
  onComplete,
}: StatusIconProps) {
  const scale = useSharedValue(0);
  const exclamOpacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1, Springs.celebration);
    exclamOpacity.value = withDelay(200, withTiming(1, { duration: 180 }));
    if (onComplete) {
      const timer = setTimeout(onComplete, 500);
      return () => clearTimeout(timer);
    }
  }, [scale, exclamOpacity, onComplete]);

  const wrapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const exclamStyle = useAnimatedStyle(() => ({
    opacity: exclamOpacity.value,
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, wrapStyle]}>
      <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        {/* Triangle */}
        <Path
          d="M16 4L29 26H3L16 4z"
          fill={`${color}20`}
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        {/* Exclamation body */}
        <Path
          d="M16 13v6"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {/* Exclamation dot */}
        <Circle cx="16" cy="22" r="1.2" fill={color} />
      </Svg>
    </Animated.View>
  );
}

// ─── Static variants (no animation, for inline use) ──────────

export function CheckMark({ size = 20, color = colors.dark.incoming }: IconProps) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="12" cy="12" r="11" fill={`${color}20`} />
        <Path d="M6 12l4.5 4.5L18 9" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

export function XMark({ size = 20, color = colors.dark.error }: IconProps) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="12" cy="12" r="11" fill={`${color}20`} />
        <Path d="M8 8l8 8M16 8L8 16" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

export function WarningMark({ size = 20, color = colors.dark.warning }: IconProps) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M12 3L22 20H2L12 3z" fill={`${color}20`} stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        <Path d="M12 10v5" stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Circle cx="12" cy="17" r="1" fill={color} />
      </Svg>
    </View>
  );
}

interface IconProps {
  size?: number;
  color?: string;
}
