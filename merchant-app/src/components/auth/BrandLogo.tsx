import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, Text } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { BrandMarkIcon } from '../icons/AuthIcons';
import { colors, typography, spacing, shadows, borderRadius } from '../../theme';

type LogoTheme = 'light' | 'dark';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  animated?: boolean;
  variant?: 'customer' | 'merchant';
  theme?: LogoTheme;
}

const SIZES = { sm: 40, md: 56, lg: 72 };

export function BrandLogo({
  size = 'md',
  showWordmark = false,
  animated = true,
  variant = 'customer',
  theme = 'light',
}: BrandLogoProps) {
  const scale = useRef(new Animated.Value(animated ? 0.85 : 1)).current;
  const opacity = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (!animated) return;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 80 }),
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [animated, opacity, scale]);

  const iconSize = SIZES[size];
  const dark = theme === 'dark';

  return (
    <Animated.View style={[styles.wrap, { opacity, transform: [{ scale }] }]}>
      <View
        style={[
          dark ? styles.iconBoxDark : styles.iconBox,
          { width: iconSize + 16, height: iconSize + 16, borderRadius: borderRadius.xl },
        ]}
      >
        <BrandMarkIcon size={iconSize} onDark={dark} />
      </View>
      {showWordmark && (
        <Text style={[styles.wordmark, dark && styles.wordmarkDark]}>
          Zapp Pay{variant === 'merchant' ? ' Merchant' : ''}
        </Text>
      )}
    </Animated.View>
  );
}

/** Soft ambient radial glow behind the splash logo (Apple "Pro" page feel) */
function AmbientGlow({ size = 480 }: { size?: number }) {
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={colors.primary} stopOpacity={0.38} />
          <Stop offset="55%" stopColor={colors.primary} stopOpacity={0.12} />
          <Stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill="url(#glow)" />
    </Svg>
  );
}

/**
 * Cinematic dark splash: near-black canvas, glowing logo, tight-tracked wordmark.
 */
export function BrandSplash({
  message,
  variant = 'customer',
}: {
  message?: string;
  variant?: 'customer' | 'merchant';
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fade, pulse]);

  return (
    <View style={styles.splash}>
      <Animated.View style={[styles.splashCenter, { opacity: fade }]}>
        <View style={styles.glowWrap} pointerEvents="none">
          <AmbientGlow />
        </View>
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <BrandLogo size="lg" animated={false} theme="dark" />
        </Animated.View>
        <Text style={styles.splashWordmark}>
          Zapp Pay{variant === 'merchant' ? ' Merchant' : ''}
        </Text>
        {message ? <Text style={styles.splashMessage}>{message}</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  iconBox: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    ...shadows.md,
  },
  iconBoxDark: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.hero.pill,
    borderWidth: 1,
    borderColor: colors.hero.border,
  },
  wordmark: {
    ...typography.h2,
    color: colors.text.primary,
    marginTop: spacing.md,
    fontWeight: '700',
  },
  wordmarkDark: {
    color: colors.hero.text,
  },
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.hero.canvas,
  },
  splashCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowWrap: {
    position: 'absolute',
    width: 480,
    height: 480,
    alignSelf: 'center',
  },
  splashWordmark: {
    ...typography.displayL,
    fontSize: 28,
    lineHeight: 34,
    color: colors.hero.text,
    marginTop: spacing.lg,
  },
  splashMessage: {
    ...typography.body,
    color: colors.hero.textSecondary,
    marginTop: spacing.md,
  },
});
