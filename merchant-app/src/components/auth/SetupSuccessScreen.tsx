import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SuccessCheckIcon } from '../icons/AuthIcons';
import { Button } from '../Button';
import { colors, typography, spacing } from '../../theme';

interface SetupSuccessScreenProps {
  onContinue: () => void;
  variant?: 'customer' | 'merchant';
}

export function SetupSuccessScreen({ onContinue, variant = 'customer' }: SetupSuccessScreenProps) {
  const { t } = useTranslation();
  const scale = useRef(new Animated.Value(0.4)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const textFade = useRef(new Animated.Value(0)).current;
  const textSlide = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 60 }),
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(textFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(textSlide, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();
  }, [opacity, scale, textFade, textSlide]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.checkWrap, { opacity, transform: [{ scale }] }]}>
        <SuccessCheckIcon size={88} />
      </Animated.View>
      <Animated.View style={[styles.textWrap, { opacity: textFade, transform: [{ translateY: textSlide }] }]}>
        <Text style={styles.title}>{t('auth.success.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.success.subtitle')}</Text>
      </Animated.View>
      <Button title={t('auth.success.continue')} onPress={onContinue} variant="gradient" fullWidth style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  checkWrap: {
    marginVertical: spacing.xl,
  },
  textWrap: {
    alignItems: 'center',
  },
  title: {
    ...typography.displayL,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.smPlus,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  btn: {
    width: '100%',
  },
});
