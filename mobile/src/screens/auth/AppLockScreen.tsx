import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, Alert, SafeAreaView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BiometryTypes } from 'react-native-biometrics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { AuthLayout, AuthHeader } from '../../components/auth';
import { LockIcon } from '../../components/icons/AuthIcons';
import { PinKeypad } from '../../components/PinKeypad';
import ResetPinScreen from './ResetPinScreen';
import {
  authenticateWithBiometrics,
  isBiometricAvailable,
  isBiometricEnabled,
} from '../../services/biometric.service';
import { validatePin, signOut, PinLockoutError } from '../../services/auth.service';
import { markPinVerifiedThisInstall } from '../../hooks/usePinVerifiedThisInstall';
import { colors, typography, spacing } from '../../theme';
import { Springs } from '../../constants/springs';

interface Props {
  onUnlock: () => void;
}

function getBiometricLabelKey(biometryType?: string): string {
  if (biometryType === BiometryTypes.FaceID) return 'biometric.faceId';
  if (biometryType === BiometryTypes.TouchID) return 'biometric.touchId';
  return 'biometric.generic';
}

export default function AppLockScreen({ onUnlock }: Props) {
  const { t } = useTranslation();
  const [biometryType, setBiometryType] = useState<string | undefined>();
  const [bioUsable, setBioUsable] = useState<boolean | null>(null);
  const [showPinFallback, setShowPinFallback] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [loading, setLoading] = useState(false);
  const biometricTriggered = useRef(false);

  const label = useMemo(() => t(getBiometricLabelKey(biometryType)), [biometryType, t]);

  // Breathing glow animation
  const glowScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.4);

  useEffect(() => {
    if (showPinFallback) {
      cancelAnimation(glowScale);
      glowScale.value = withTiming(1, { duration: 200 });
      return;
    }
    glowScale.value = withRepeat(
      withSequence(
        withTiming(1.14, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0, { duration: 2400 }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(glowScale);
  }, [showPinFallback, glowScale]);

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value }],
    opacity: glowOpacity.value,
  }));

  const performUnlock = useCallback(() => {
    // A successful unlock (PIN, or Face ID backed by the keychain PIN)
    // proves the PIN on this install.
    markPinVerifiedThisInstall();
    glowScale.value = withSpring(1.5, Springs.celebration);
    glowOpacity.value = withTiming(0, { duration: 260 });
    setTimeout(onUnlock, 260);
  }, [glowScale, glowOpacity, onUnlock]);

  // Only offer/auto-prompt biometrics when the user actually enabled them —
  // users who skipped or disabled Face ID go straight to the PIN pad.
  useEffect(() => {
    Promise.all([isBiometricAvailable(), isBiometricEnabled()]).then(
      ([{ available, biometryType: bt }, enabled]) => {
        setBiometryType(bt);
        const usable = available && enabled;
        setBioUsable(usable);
        if (!usable) setShowPinFallback(true);
      },
    );
  }, []);

  const handleBiometricUnlock = useCallback(async () => {
    const success = await authenticateWithBiometrics(t('common.unlockQuickPay'));
    if (success) {
      performUnlock();
    }
  }, [t, performUnlock]);

  useEffect(() => {
    if (bioUsable && !showPinFallback && !biometricTriggered.current) {
      biometricTriggered.current = true;
      handleBiometricUnlock();
    }
  }, [bioUsable, showPinFallback, handleBiometricUnlock]);

  const handlePinComplete = async (submittedPin: string) => {
    if (loading) return;
    try {
      setLoading(true);
      setPinError('');
      const valid = await validatePin(submittedPin);
      if (valid) {
        performUnlock();
      } else {
        setPinError(t('auth.appLock.invalidPinMessage'));
        setPin('');
      }
    } catch (err) {
      if (err instanceof PinLockoutError) {
        setPinError(t('pin.lockedOut', { seconds: err.secondsLeft ?? 60 }));
      } else {
        setPinError(t('auth.appLock.verifyError'));
      }
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(t('auth.appLock.signOutTitle'), t('auth.appLock.signOutMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.appLock.signOut'),
        style: 'destructive',
        onPress: () => signOut().catch(() => {}),
      },
    ]);
  };

  // Avoid flashing the biometric view before we know if it's usable.
  if (bioUsable === null) {
    return <SafeAreaView style={styles.fullScreen} />;
  }

  if (showReset) {
    return (
      <ResetPinScreen
        onDone={() => {
          setShowReset(false);
          performUnlock();
        }}
        onCancel={() => setShowReset(false)}
      />
    );
  }

  if (showPinFallback) {
    return (
      <SafeAreaView style={styles.fullScreen}>
        <PinKeypad
          value={pin}
          onChange={(val) => {
            setPin(val);
            if (pinError) setPinError('');
          }}
          onComplete={loading ? undefined : handlePinComplete}
          title={t('auth.appLock.title')}
          subtitle={t('auth.appLock.subtitlePin')}
          error={pinError}
        />
        <View style={styles.footer}>
          {bioUsable ? (
            <TouchableOpacity
              onPress={() => {
                setShowPinFallback(false);
                setPin('');
                setPinError('');
                biometricTriggered.current = false;
              }}
              style={styles.linkButton}
              accessibilityLabel={t('auth.appLock.useBiometricInstead', { label })}
            >
              <Text style={styles.linkText}>{t('auth.appLock.useBiometricInstead', { label })}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => setShowReset(true)}
            style={styles.linkButton}
            accessibilityLabel={t('auth.welcomeBack.forgotPin')}
          >
            <Text style={styles.linkText}>{t('auth.welcomeBack.forgotPin')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSignOut}
            style={styles.signOutLink}
            accessibilityLabel={t('auth.appLock.signOut')}
          >
            <Text style={styles.signOutText}>{t('auth.appLock.signOut')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <AuthLayout scroll={false} contentStyle={styles.biometricContent} footer={
      <TouchableOpacity
        onPress={handleSignOut}
        style={styles.signOutLink}
        accessibilityLabel={t('auth.appLock.signOut')}
      >
        <Text style={styles.signOutText}>{t('auth.appLock.signOut')}</Text>
      </TouchableOpacity>
    }>
      <AuthHeader
        icon={
          <View style={styles.lockIconWrap}>
            <Animated.View style={[styles.lockGlow, glowStyle]} />
            <LockIcon size={40} />
          </View>
        }
        title={t('auth.appLock.title')}
        subtitle={t('auth.appLock.subtitleBiometric', { label })}
      />
      <TouchableOpacity
        onPress={() => setShowPinFallback(true)}
        style={styles.linkButton}
        accessibilityLabel={t('auth.appLock.usePinInstead')}
      >
        <Text style={styles.linkText}>{t('auth.appLock.usePinInstead')}</Text>
      </TouchableOpacity>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  lockIconWrap: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockGlow: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.dark.accentSoft,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  biometricContent: {
    flex: 1,
    justifyContent: 'center',
  },
  footer: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
  },
  linkButton: {
    padding: spacing.sm,
    alignSelf: 'center',
  },
  linkText: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },
  signOutLink: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  signOutText: {
    ...typography.body,
    color: colors.dark.error,
  },
});
