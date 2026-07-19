import React, { useEffect } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import { colors, spacing, borderRadius } from '../theme';

function Shimmer({ width }: { width: number }) {
  const position = useSharedValue(-1);

  useEffect(() => {
    position.value = withRepeat(
      withTiming(2, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      position.value = -1;
    };
  }, [position]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * (width / 2) }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.07)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

interface SkeletonBoxProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: object;
}

function SkeletonBox({ width, height, borderRadius: br = 8, style }: SkeletonBoxProps) {
  const { width: screenWidth } = useWindowDimensions();
  const resolvedWidth = typeof width === 'string' ? screenWidth * 0.9 : width;

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: br,
          backgroundColor: colors.dark.glass,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Shimmer width={resolvedWidth} />
    </View>
  );
}

// ─── Exported variants ────────────────────────────────────────

function Balance() {
  return (
    <View style={styles.balanceWrap}>
      <SkeletonBox width={60} height={14} borderRadius={7} style={styles.balanceLabel} />
      <SkeletonBox width={160} height={44} borderRadius={10} style={styles.balanceAmount} />
      <SkeletonBox width={100} height={12} borderRadius={6} style={styles.balanceSub} />
    </View>
  );
}

function TransactionItem() {
  return (
    <View style={styles.txRow}>
      <SkeletonBox width={44} height={44} borderRadius={22} />
      <View style={styles.txLines}>
        <SkeletonBox width="75%" height={14} borderRadius={7} />
        <SkeletonBox width="50%" height={12} borderRadius={6} style={styles.txLine2} />
      </View>
      <SkeletonBox width={60} height={14} borderRadius={7} />
    </View>
  );
}

function Card({ height = 120, style }: { height?: number; style?: object }) {
  return (
    <SkeletonBox
      width="100%"
      height={height}
      borderRadius={borderRadius.lg}
      style={style}
    />
  );
}

function ProfileHeader() {
  return (
    <View style={styles.profileHeader}>
      <SkeletonBox width={80} height={80} borderRadius={40} />
      <SkeletonBox width={140} height={18} borderRadius={9} style={styles.profileName} />
      <SkeletonBox width={100} height={14} borderRadius={7} style={styles.profileSub} />
    </View>
  );
}

export const Skeleton = { Balance, TransactionItem, Card, ProfileHeader };

const styles = StyleSheet.create({
  balanceWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  balanceLabel: {},
  balanceAmount: {},
  balanceSub: {},
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  txLines: {
    flex: 1,
    gap: spacing.xs,
  },
  txLine2: { marginTop: 4 },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  profileName: {},
  profileSub: {},
});
