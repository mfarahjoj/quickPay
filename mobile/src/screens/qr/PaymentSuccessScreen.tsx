import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, Share, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { typography, spacing, borderRadius, makeStyles, useColors, useTheme, wallpaper } from '../../theme';
import { Wallpaper } from '../../components/Wallpaper';
import { CheckIcon, ShareIcon } from '../../components/icons/LineIcons';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { triggerHaptic } from '../../services/haptics.service';
import { Springs } from '../../constants/springs';
import { useCountUp } from '../../hooks/useCountUp';

interface Props {
  navigation: any;
  route: {
    params: {
      transactionId: string;
      receiptNumber?: string;
      amount: number;
      currency: string;
      merchantId?: string;
      merchantName?: string;
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
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const { transactionId, receiptNumber, amount, currency, merchantName } = route.params;
  // Light mode celebrates on the coral wallpaper.
  const { scheme } = useTheme();
  const isLight = scheme === 'light';
  const insets = useSafeAreaInsets();
  const lightStyles = useLightStyles();
  const [paidAt] = useState(() => new Date());

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
      colors.ui.incoming,
      colors.ui.accentText,
      colors.ui.warning,
    ];
    return Array.from({ length: 12 }).map(() => ({
      dx: (Math.random() - 0.5) * 130,
      dy: -(100 + Math.random() * 90),
      color: particleColors[Math.floor(Math.random() * particleColors.length)],
      size: 4 + Math.random() * 3,
      delay: Math.floor(Math.random() * 250),
    }));
  }, [colors]);

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

  const amountText = `${CURRENCY_SYMBOL}${amount.toFixed(2)}`;
  // The Zapp receipt number when the backend issued one; the start of the
  // transaction id for a payment from before they existed.
  const reference = receiptNumber ?? transactionId.slice(0, 12);

  const handleShare = () => {
    triggerHaptic('light');
    Share.share({
      title: t('payments.receiptShareTitle'),
      message: t('qr.success.shareMessage', {
        amount: amountText,
        merchant: merchantName || t('common.merchant'),
        reference,
      }),
    }).catch(() => undefined);
  };

  if (isLight) {
    const time = paidAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = paidAt.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    return (
      <View style={lightStyles.container}>
        <StatusBar barStyle="light-content" backgroundColor={wallpaper.top} />
        <Wallpaper />
        <View style={[lightStyles.body, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 16 }]}>
          <View style={lightStyles.hero}>
            <View style={lightStyles.ringOuter} />
            <View style={lightStyles.ringInner} />
            <Animated.View style={[lightStyles.bloom, ringStyle]} pointerEvents="none" />
            <View style={lightStyles.checkCircle}>
              <CheckIcon size={46} color={colors.ui.accent} strokeWidth={2.6} />
            </View>
          </View>

          <Animated.View style={[lightStyles.titleBlock, titleStyle]}>
            <Text style={lightStyles.title}>{t('qr.success.paid')}</Text>
            <Text style={lightStyles.subtitle}>
              {merchantName ? t('qr.success.paidTo', { amount: amountText, merchant: merchantName }) : amountText}
            </Text>
          </Animated.View>

          <Animated.View style={[lightStyles.card, cardStyle]}>
            <View style={[lightStyles.row, lightStyles.rowDivider]}>
              <Text style={lightStyles.rowKey}>
                {receiptNumber ? t('qr.success.receipt') : t('qr.success.reference')}
              </Text>
              <Text style={lightStyles.rowValue}>{reference}</Text>
            </View>
            <View style={lightStyles.row}>
              <Text style={lightStyles.rowKey}>{t('qr.success.date')}</Text>
              <Text style={lightStyles.rowValue}>{`${day}, ${time}`}</Text>
            </View>
          </Animated.View>

          <View style={lightStyles.spacer} />

          <Animated.View style={[lightStyles.buttons, buttonStyle]}>
            <TouchableOpacity
              style={lightStyles.shareButton}
              onPress={handleShare}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <ShareIcon size={20} color="#FFFFFF" strokeWidth={2.1} />
              <Text style={lightStyles.shareText}>{t('common.share')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={lightStyles.doneButton}
              onPress={handleDone}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={lightStyles.doneText}>{t('qr.success.done')}</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    );
  }

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
            {receiptNumber ? (
              <>
                <Text style={styles.summaryKey}>{t('qr.success.receipt')}</Text>
                <Text style={[styles.summaryValue, styles.receiptValue]} selectable>
                  {receiptNumber}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.summaryKey}>{t('qr.success.reference')}</Text>
                <Text style={styles.summaryValue}>{transactionId.slice(0, 12)}...</Text>
              </>
            )}
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

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
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
    borderColor: colors.ui.incoming,
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
    color: colors.ui.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.ui.textDim,
    marginBottom: spacing.xxl,
    textAlign: 'center',
  },
  summary: {
    width: '100%',
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
  },
  summaryAmount: {
    ...typography.h1,
    color: colors.ui.incoming,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.ui.textFaint,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.ui.divider,
    marginVertical: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  summaryKey: {
    ...typography.caption,
    color: colors.ui.textFaint,
  },
  summaryValue: {
    ...typography.bodySemibold,
    color: colors.ui.text,
  },
  receiptValue: {
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },
  doneWrap: {
    width: '100%',
  },
}));

// ─── Light: the coral wallpaper, a white check, a white receipt ─
const useLightStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: wallpaper.top,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
  hero: {
    alignSelf: 'center',
    width: 196,
    height: 196,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringOuter: {
    position: 'absolute',
    width: 196,
    height: 196,
    borderRadius: 98,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ringInner: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bloom: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  checkCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#500A1E',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  titleBlock: {
    marginTop: 18,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '700',
    letterSpacing: -1,
  },
  subtitle: {
    marginTop: 6,
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  card: {
    marginTop: 28,
    paddingHorizontal: 18,
    paddingVertical: 4,
    borderRadius: 24,
    backgroundColor: colors.ui.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 50,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.ui.divider,
  },
  rowKey: {
    fontSize: 14,
    color: colors.ui.textFaint,
  },
  rowValue: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.ui.text,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  spacer: {
    flex: 1,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  shareButton: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(20,17,15,0.22)',
    borderWidth: 1,
    borderColor: wallpaper.glassBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  doneButton: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    color: colors.ui.text,
    fontSize: 17,
    fontWeight: '600',
  },
}));
