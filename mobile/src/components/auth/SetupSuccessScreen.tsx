import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { registerForPushNotifications } from '../../services/notification.service';
import { colors, spacing } from '../../theme';

const CORAL = colors.dark.accent;
const TEAL = '#5DCAA5';
const TEAL_DARK = '#04342C';

interface SetupSuccessScreenProps {
  onContinue: () => void;
  variant?: 'customer' | 'merchant';
}

function Bolt({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Polygon
        points="57,8 26,54 45,54 43,92 74,44 55,44"
        fill={color}
        stroke={color}
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const SPARKS = [
  { dx: -74, dy: -60, color: CORAL, delay: 200 },
  { dx: 80, dy: -44, color: TEAL, delay: 400 },
  { dx: 64, dy: 58, color: CORAL, delay: 700 },
  { dx: -68, dy: 48, color: '#FDE4CB', delay: 1000 },
  { dx: 8, dy: -84, color: TEAL, delay: 1300 },
  { dx: -20, dy: 80, color: CORAL, delay: 1600 },
];

function Spark({ dx, dy, color, delay }: { dx: number; dy: number; color: string; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [v, delay]);

  return (
    <Animated.View
      style={[
        styles.spark,
        {
          backgroundColor: color,
          opacity: v.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 0.9, 0.3, 0] }),
          transform: [
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) },
          ],
        },
      ]}
    />
  );
}

function Ring({ color, delay }: { color: string; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 2800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [v, delay]);

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          borderColor: color,
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.2] }) }],
          opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.9, 0.4, 0] }),
        },
      ]}
    />
  );
}

export function SetupSuccessScreen({ onContinue, variant: _variant = 'customer' }: SetupSuccessScreenProps) {
  const { t } = useTranslation();
  const burst = useRef(new Animated.Value(0)).current;
  const textRise = useRef(new Animated.Value(0)).current;
  const cardRise = useRef(new Animated.Value(0)).current;
  const btnRise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(burst, { toValue: 1, tension: 90, friction: 7, useNativeDriver: true }),
      Animated.stagger(140, [
        Animated.spring(textRise, { toValue: 1, tension: 70, friction: 11, useNativeDriver: true }),
        Animated.spring(cardRise, { toValue: 1, tension: 70, friction: 11, useNativeDriver: true }),
        Animated.spring(btnRise, { toValue: 1, tension: 70, friction: 11, useNativeDriver: true }),
      ]),
    ]).start();

    // Trust is highest right after "You're in." — ask for notifications now,
    // not mid-OTP.
    registerForPushNotifications();
  }, [burst, textRise, cardRise, btnRise]);

  const riseStyle = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
  });

  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.auraOuter} />
      <View pointerEvents="none" style={styles.auraInner} />

      <View style={styles.heroWrap}>
        <Ring color="rgba(93,202,165,0.55)" delay={0} />
        <Ring color="rgba(255,80,67,0.5)" delay={900} />
        {SPARKS.map((s, i) => (
          <Spark key={i} {...s} />
        ))}
        <Animated.View style={[styles.core, { transform: [{ scale: burst }] }]}>
          <Bolt size={48} color="#FFFFFF" />
          <View style={styles.checkBadge}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        </Animated.View>
      </View>

      <Animated.View style={[styles.textWrap, riseStyle(textRise)]}>
        <Text style={styles.title}>{t('auth.success.title')}</Text>
      </Animated.View>

      <Animated.View style={[styles.teaser, riseStyle(cardRise)]}>
        <View style={styles.teaserIcon}>
          <Bolt size={20} color={CORAL} />
        </View>
        <View style={styles.teaserBody}>
          <Text style={styles.teaserLabel}>{t('dashboard.availableBalance')}</Text>
          <Text style={styles.teaserAmount}>$0.00</Text>
        </View>
        <Text style={styles.teaserHint}>{t('auth.success.topUpHint')}</Text>
      </Animated.View>

      <Animated.View style={[styles.btnWrap, riseStyle(btnRise)]}>
        <Button title={t('auth.success.continue')} onPress={onContinue} variant="gradient" fullWidth />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  auraOuter: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(255,80,67,0.05)',
  },
  auraInner: {
    position: 'absolute',
    top: 120,
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,80,67,0.08)',
  },
  heroWrap: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
  },
  spark: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  core: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: CORAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: TEAL,
    borderWidth: 3,
    borderColor: colors.dark.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    fontSize: 19,
    fontWeight: '800',
    color: TEAL_DARK,
  },
  textWrap: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  title: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1.9,
    color: colors.dark.text,
    textAlign: 'center',
  },
  teaser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    width: 258,
    marginTop: spacing.xl,
  },
  teaserIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,80,67,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teaserBody: {
    flex: 1,
  },
  teaserLabel: {
    fontSize: 11,
    color: colors.dark.textDim,
  },
  teaserAmount: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.dark.text,
  },
  teaserHint: {
    fontSize: 11,
    fontWeight: '600',
    color: TEAL,
  },
  btnWrap: {
    width: '100%',
    marginTop: spacing.xxl,
  },
});
