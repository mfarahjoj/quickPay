import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { Button } from '../../components/Button';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { triggerHaptic } from '../../services/haptics.service';
import { Springs } from '../../constants/springs';
import { useCountUp } from '../../hooks/useCountUp';

interface Props {
  navigation: any;
  route: {
    params: {
      transactionId: string;
      amount: number;
      currency: string;
      merchantId?: string;
    };
  };
}

// ─── Confetti particle ────────────────────────────────────────

interface ParticleConfig {
  dx: number;
  dy: number;
  color: string;
  size: number;
  delay: number;
}

function ConfettiParticle({ dx, dy, color, size, delay }: ParticleConfig) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    x.value = withDelay(delay, withTiming(dx, { duration: 750 }));
    y.value = withDelay(delay, withTiming(dy, { duration: 750 }));
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: 60 }),
    );
    opacity.value = withDelay(
      delay + 350,
      withTiming(0, { duration: 400 }),
    );
  }, [delay, dx, dy, opacity, x, y]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 3,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

// ─── Main screen ──────────────────────────────────────────────

export default function PaymentSuccessScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { transactionId, amount, currency } = route.params;

  // Content stagger shared values
  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(14);
  const cardOpacity = useSharedValue(0);
  const cardY = useSharedValue(14);
  const buttonOpacity = useSharedValue(0);

  // Ring bloom behind checkmark
  const ringScale = useSharedValue(0.8);
  const ringOpacity = useSharedValue(0.35);

  // Count-up amount
  const [activeAmount, setActiveAmount] = useState(0);
  const countValue = useCountUp(activeAmount, 650);
  const [displayAmount, setDisplayAmount] = useState('0.00');

  useAnimatedReaction(
    () => countValue.value,
    (current) => {
      runOnJS(setDisplayAmount)(current.toFixed(2));
    },
  );

  // Stable confetti particles
  const particles = useMemo<ParticleConfig[]>(() => {
    const particleColors = [
      colors.dark.incoming,
      colors.dark.accentText,
      colors.dark.warning,
    ];
    return Array.from({ length: 12 }).map(() => ({
      dx: (Math.random() - 0.5) * 130,
      dy: -(100 + Math.random() * 90),
      color: particleColors[Math.floor(Math.random() * particleColors.length)],
      size: 4 + Math.random() * 3,
      delay: Math.floor(Math.random() * 250),
    }));
  }, []);

  useEffect(() => {
    // Immediate: haptic + ring bloom
    triggerHaptic('success');

    ringScale.value = withSpring(2.2, Springs.celebration);
    ringOpacity.value = withTiming(0, { duration: 700 });

    // Stagger content in
    titleOpacity.value = withDelay(300, withTiming(1, { duration: 280 }));
    titleY.value = withDelay(300, withSpring(0, Springs.transition));

    cardOpacity.value = withDelay(480, withTiming(1, { duration: 280 }));
    cardY.value = withDelay(480, withSpring(0, Springs.transition));

    buttonOpacity.value = withDelay(650, withTiming(1, { duration: 240 }));

    // Amount count-up starts with card
    const timer = setTimeout(() => {
      setActiveAmount(amount);
    }, 480);

    // Confirmation echo haptic
    const echo = setTimeout(() => triggerHaptic('light'), 600);

    return () => {
      clearTimeout(timer);
      clearTimeout(echo);
    };
  }, [amount, ringOpacity, ringScale, titleOpacity, titleY, cardOpacity, cardY, buttonOpacity]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardY.value }],
  }));

  const buttonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
  }));

  const handleDone = () => {
    triggerHaptic('light');
    navigation.navigate('MainTabs', { screen: 'Home' });
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Checkmark + ring bloom + confetti */}
        <View style={styles.heroArea}>
          {/* Ring bloom */}
          <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />

          {/* Confetti particles — positioned at center */}
          <View style={styles.confettiAnchor} pointerEvents="none">
            {particles.map((p, i) => (
              <ConfettiParticle key={i} {...p} />
            ))}
          </View>

          {/* The checkmark (already animated internally) */}
          <SuccessCheckIcon size={100} />
        </View>

        {/* Title */}
        <Animated.View style={titleStyle}>
          <Text style={styles.title}>{t('qr.success.title')}</Text>
          <Text style={styles.subtitle}>{t('qr.success.subtitle')}</Text>
        </Animated.View>

        {/* Summary card with count-up amount */}
        <Animated.View style={[styles.summary, cardStyle]}>
          <Text style={styles.summaryAmount}>
            {CURRENCY_SYMBOL}{displayAmount}
          </Text>
          <Text style={styles.summaryLabel}>{currency}</Text>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryKey}>{t('qr.success.reference')}</Text>
            <Text style={styles.summaryValue}>{transactionId.slice(0, 12)}...</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryKey}>{t('qr.success.date')}</Text>
            <Text style={styles.summaryValue}>
              {new Date().toLocaleDateString()}{' '}
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </Animated.View>

        {/* Done button */}
        <Animated.View style={[styles.doneWrap, buttonStyle]}>
          <Button
            title={t('qr.success.done')}
            onPress={handleDone}
            variant="primary"
            fullWidth
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
    justifyContent: 'center',
  },
  content: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  heroArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    height: 120,
    width: 120,
  },
  ring: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: colors.dark.incoming,
  },
  confettiAnchor: {
    position: 'absolute',
    width: 1,
    height: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  title: {
    ...typography.h1,
    color: colors.dark.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.xxl,
    textAlign: 'center',
  },
  summary: {
    width: '100%',
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
  },
  summaryAmount: {
    ...typography.h1,
    color: colors.dark.incoming,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.dark.textFaint,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.dark.divider,
    marginVertical: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  summaryKey: {
    ...typography.caption,
    color: colors.dark.textFaint,
  },
  summaryValue: {
    ...typography.bodySemibold,
    color: colors.dark.text,
  },
  doneWrap: {
    width: '100%',
  },
});
