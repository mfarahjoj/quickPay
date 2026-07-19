import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { Springs } from '../../constants/springs';

interface TabIconProps {
  focused: boolean;
  color: string;
  size: number;
}

function AnimatedTabWrapper({
  focused,
  color,
  size,
  children,
}: TabIconProps & { children: React.ReactNode }) {
  const scale = useSharedValue(focused ? 1.12 : 1);
  const dotScale = useSharedValue(focused ? 1 : 0);
  const dotOpacity = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.12 : 1, Springs.feedback);
    dotScale.value = withSpring(focused ? 1 : 0, Springs.feedback);
    dotOpacity.value = withTiming(focused ? 1 : 0, { duration: 180 });
  }, [focused, scale, dotScale, dotOpacity]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dotScale.value }],
    opacity: dotOpacity.value,
  }));

  return (
    <View style={styles.wrapper}>
      <Animated.View style={iconStyle}>{children}</Animated.View>
      <Animated.View
        style={[styles.dot, { backgroundColor: color, width: size * 0.18, height: size * 0.18, borderRadius: size * 0.09 }, dotStyle]}
      />
    </View>
  );
}

export function HomeTabIcon({ focused, color, size }: TabIconProps) {
  return (
    <AnimatedTabWrapper focused={focused} color={color} size={size}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* House body */}
        <Path
          d="M3 10L12 3l9 7v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-9z"
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
          fill={focused ? `${color}22` : 'none'}
        />
        {/* Door */}
        <Path
          d="M9 20v-6h6v6"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </AnimatedTabWrapper>
  );
}

export function PayTabIcon({ focused, color, size }: TabIconProps) {
  return (
    <AnimatedTabWrapper focused={focused} color={color} size={size}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Arrow shaft */}
        <Path
          d="M5 19L19 5"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
        {/* Arrowhead */}
        <Path
          d="M9 5h10v10"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={focused ? `${color}22` : 'none'}
        />
      </Svg>
    </AnimatedTabWrapper>
  );
}

export function HistoryTabIcon({ focused, color, size }: TabIconProps) {
  return (
    <AnimatedTabWrapper focused={focused} color={color} size={size}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Clock circle */}
        <Circle
          cx="12"
          cy="12"
          r="9"
          stroke={color}
          strokeWidth={1.8}
          fill={focused ? `${color}22` : 'none'}
        />
        {/* Hour hand */}
        <Path
          d="M12 7v5"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {/* Minute hand */}
        <Path
          d="M12 12l3.5 2"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {/* Center dot */}
        <Circle cx="12" cy="12" r="1" fill={color} />
      </Svg>
    </AnimatedTabWrapper>
  );
}

export function ProfileTabIcon({ focused, color, size }: TabIconProps) {
  return (
    <AnimatedTabWrapper focused={focused} color={color} size={size}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Head */}
        <Circle
          cx="12"
          cy="8"
          r="4"
          stroke={color}
          strokeWidth={1.8}
          fill={focused ? `${color}22` : 'none'}
        />
        {/* Shoulders */}
        <Path
          d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </AnimatedTabWrapper>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dot: {
    marginTop: 1,
  },
});
