import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BiometryTypes } from 'react-native-biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '../../components/Button';
import { AuthLayout, AuthHeader, CodeInput, SetupSuccessScreen } from '../../components/auth';
import { FaceIdIcon, FingerprintIcon } from '../../components/icons/AuthIcons';
import { logger } from '../../utils/logger';
import {
  isBiometricAvailable,
  authenticateWithBiometrics,
  setBiometricEnabled,
  storePinInKeychain,
  consumePendingSetupPin,
} from '../../services/biometric.service';
import { validatePin, PinLockoutError } from '../../services/auth.service';
import ResetPinScreen from './ResetPinScreen';
import { colors, typography, spacing } from '../../theme';

interface Props {
  navigation: any;
  onComplete?: () => void;
}

type Step = 'prompt' | 'pin';

/** Scanning-ring hero: dashed orbit, ripple, sweeping scan line, check pop. */
function BiometricHero({ icon }: { icon: React.ReactNode }) {
  const spin = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anims = [
      Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(ripple, { toValue: 1, duration: 3000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(ripple, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(scan, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.delay(1600),
          Animated.timing(scan, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.delay(1650),
          Animated.spring(check, { toValue: 1, tension: 180, friction: 8, useNativeDriver: true }),
          Animated.delay(900),
          Animated.timing(check, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
      ),
    ];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [spin, ripple, scan, check]);

  return (
    <View style={heroStyles.wrap}>
      <Animated.View
        style={[
          heroStyles.ripple,
          {
            transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.8] }) }],
            opacity: ripple.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.8, 0.35, 0] }),
          },
        ]}
      />
      <Animated.View
        style={[
          heroStyles.orbit,
          { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] },
        ]}
      />
      <View style={heroStyles.core}>
        {icon}
        <Animated.View
          style={[
            heroStyles.scanLine,
            {
              opacity: scan.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] }) }],
            },
          ]}
        />
      </View>
      <Animated.View
        style={[
          heroStyles.check,
          { opacity: check, transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] },
        ]}
      >
        <Text style={heroStyles.checkMark}>✓</Text>
      </Animated.View>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  wrap: {
    width: 190,
    height: 190,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  ripple: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 1.5,
    borderColor: 'rgba(255,80,67,0.5)',
  },
  orbit: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,80,67,0.45)',
  },
  core: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#1C1917',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scanLine: {
    position: 'absolute',
    left: 22,
    right: 22,
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255,80,67,0.9)',
  },
  check: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#5DCAA5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    fontSize: 18,
    fontWeight: '800',
    color: '#04342C',
  },
});

function getBiometricLabelKey(biometryType?: string): string {
  if (biometryType === BiometryTypes.FaceID) return 'biometric.faceId';
  if (biometryType === BiometryTypes.TouchID) return 'biometric.touchId';
  return 'biometric.generic';
}

export default function BiometricSetupScreen({ onComplete }: Props) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [biometryType, setBiometryType] = useState<string | undefined>();
  const [step, setStep] = useState<Step>('prompt');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [pinError, setPinError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [showReset, setShowReset] = useState(false);

  const label = useMemo(() => t(getBiometricLabelKey(biometryType)), [biometryType, t]);

  const BiometricIcon =
    biometryType === BiometryTypes.FaceID ? FaceIdIcon : FingerprintIcon;

  useEffect(() => {
    isBiometricAvailable().then(({ available: a, biometryType: bt }) => {
      setAvailable(a);
      setBiometryType(bt);
    });
  }, []);

  const finishSetup = async (enabled: boolean) => {
    try {
      await setBiometricEnabled(enabled);
      await AsyncStorage.setItem('@quickpay_biometric_setup_done', 'true');
      setShowSuccess(true);
    } catch (err) {
      logger.error('Biometric setup complete error:', err);
      setShowSuccess(true);
    }
  };

  const handleEnable = async () => {
    setPromptError('');
    const success = await authenticateWithBiometrics(t('common.enableBiometricPrompt', { label }));
    if (!success) {
      setPromptError(t('auth.biometricSetup.failedPrompt'));
      return;
    }
    // Fresh signups just created their PIN on the previous screen — use it
    // directly instead of asking them to retype it.
    const pendingPin = consumePendingSetupPin();
    if (pendingPin) {
      try {
        setLoading(true);
        await storePinInKeychain(pendingPin);
        await finishSetup(true);
        return;
      } catch (err) {
        logger.warn('Pending PIN keychain store failed, falling back to manual entry:', err);
      } finally {
        setLoading(false);
      }
    }
    setStep('pin');
  };

  const handlePinSubmit = async (submittedPin?: string) => {
    const pinCode = submittedPin ?? pin;
    if (pinCode.length !== 6) return;

    try {
      setLoading(true);
      setPinError('');
      const isValid = await validatePin(pinCode);
      if (!isValid) {
        setPinError(t('auth.biometricSetup.invalidPinMessage'));
        setPin('');
        return;
      }
      await storePinInKeychain(pinCode);
      await finishSetup(true);
    } catch (err: any) {
      if (err instanceof PinLockoutError) {
        setPinError(t('pin.lockedOut', { seconds: err.secondsLeft ?? 60 }));
      } else {
        setPinError(err.message ?? t('auth.biometricSetup.failedEnable'));
      }
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    await finishSetup(false);
  };

  const handleSuccessContinue = () => {
    onComplete?.();
  };

  if (showSuccess) {
    return <SetupSuccessScreen onContinue={handleSuccessContinue} />;
  }

  if (showReset) {
    return (
      <ResetPinScreen
        onDone={async (newPin) => {
          setShowReset(false);
          // Face ID was already approved on the previous step; finish
          // enabling it with the freshly reset PIN.
          try {
            await storePinInKeychain(newPin);
            await finishSetup(true);
          } catch (err) {
            logger.warn('Keychain store after reset failed:', err);
            await finishSetup(false);
          }
        }}
        onCancel={() => setShowReset(false)}
      />
    );
  }

  if (available === null) {
    return null;
  }

  if (!available) {
    return (
      <AuthLayout contentStyle={styles.centered}>
        <AuthHeader
          title={t('auth.biometricSetup.notAvailableTitle')}
          subtitle={t('auth.biometricSetup.notAvailableSubtitle')}
        />
        <Button title={t('common.continue')} onPress={handleSkip} variant="gradient" fullWidth />
      </AuthLayout>
    );
  }

  if (step === 'pin') {
    return (
      <AuthLayout onBack={() => setStep('prompt')} contentStyle={styles.centered}>
        <AuthHeader
          icon={<BiometricIcon size={40} />}
          title={t('auth.biometricSetup.enterPinTitle')}
          subtitle={t('auth.biometricSetup.enterPinSubtitle', { label })}
        />

        <CodeInput
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError('');
          }}
          onComplete={handlePinSubmit}
          secure
          error={pinError}
        />

        <Button
          title={t('auth.biometricSetup.enable')}
          onPress={() => handlePinSubmit()}
          variant="gradient"
          fullWidth
          loading={loading}
          disabled={pin.length !== 6}
          style={styles.button}
        />

        <TouchableOpacity onPress={() => setShowReset(true)} style={styles.forgotBtn}>
          <Text style={styles.forgotText}>{t('auth.welcomeBack.forgotPin')}</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>{t('auth.biometricSetup.keychainNote')}</Text>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout contentStyle={styles.centered}>
      <BiometricHero icon={<BiometricIcon size={62} />} />
      <AuthHeader
        title={t('auth.biometricSetup.enableTitle', { label })}
        subtitle={t('auth.biometricSetup.enableSubtitle', { label })}
      />

      {promptError ? <Text style={styles.promptError}>{promptError}</Text> : null}

      <Button
        title={t('auth.biometricSetup.enableButton', { label })}
        onPress={handleEnable}
        variant="gradient"
        fullWidth
        style={styles.button}
      />
      <TouchableOpacity onPress={handleSkip} style={styles.skipBtn}>
        <Text style={styles.skipText}>{t('auth.biometricSetup.skip')}</Text>
      </TouchableOpacity>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  centered: {
    justifyContent: 'center',
  },
  button: {
    marginBottom: spacing.md,
    marginTop: spacing.lg,
  },
  promptError: {
    ...typography.caption,
    color: colors.dark.error,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  footnote: {
    marginTop: spacing.lg,
    ...typography.caption,
    color: colors.dark.textFaint,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  skipBtn: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.dark.textDim,
  },
  forgotBtn: {
    alignSelf: 'center',
    padding: spacing.sm,
  },
  forgotText: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },
});
