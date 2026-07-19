import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { BiometryTypes } from 'react-native-biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firestore from '@react-native-firebase/firestore';
import { AuthLayout, AuthHeader } from '../../components/auth';
import { FaceIdIcon, FingerprintIcon } from '../../components/icons/AuthIcons';
import { Button } from '../../components/Button';
import { PinKeypad } from '../../components/PinKeypad';
import ResetPinScreen from './ResetPinScreen';
import {
  validatePin,
  signOut,
  getCurrentUser,
  PinLockoutError,
} from '../../services/auth.service';
import {
  isBiometricAvailable,
  authenticateWithBiometrics,
  setBiometricEnabled,
  storePinInKeychain,
} from '../../services/biometric.service';
import { markPinVerifiedThisInstall } from '../../hooks/usePinVerifiedThisInstall';
import { logger } from '../../utils/logger';
import { colors, typography, spacing } from '../../theme';

interface Props {
  onComplete: () => void;
}

type Step = 'pin' | 'biometric' | 'reset';

function getBiometricLabelKey(biometryType?: string): string {
  if (biometryType === BiometryTypes.FaceID) return 'biometric.faceId';
  if (biometryType === BiometryTypes.TouchID) return 'biometric.touchId';
  return 'biometric.generic';
}

/**
 * Shown when this phone number already has an account (PIN exists on the
 * server) but the PIN hasn't been verified on this install yet — returning
 * users on a new device, after a reinstall, or after signing out. Verifies
 * the existing PIN, then offers to (re-)enable Face ID / Touch ID in one tap.
 */
export default function WelcomeBackScreen({ onComplete }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('pin');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<string | undefined>();
  const [verifiedPin, setVerifiedPin] = useState('');
  const [bioError, setBioError] = useState('');

  const label = useMemo(() => t(getBiometricLabelKey(biometryType)), [biometryType, t]);
  const BiometricIcon =
    biometryType === BiometryTypes.FaceID ? FaceIdIcon : FingerprintIcon;

  useEffect(() => {
    isBiometricAvailable().then(({ available, biometryType: bt }) => {
      setBioAvailable(available);
      setBiometryType(bt);
    });

    const uid = getCurrentUser()?.uid;
    if (uid) {
      firestore()
        .collection('users')
        .doc(uid)
        .get()
        .then((doc) => {
          const name = doc.data()?.fullName;
          if (typeof name === 'string' && name.trim()) {
            setFullName(name.trim().split(/\s+/)[0]);
          }
        })
        .catch(() => {});
    }
  }, []);

  const finish = async () => {
    // The welcome-back flow replaces the biometric-setup ceremony for
    // returning users, so both gates are satisfied together.
    await AsyncStorage.setItem('@quickpay_biometric_setup_done', 'true').catch(() => {});
    onComplete();
  };

  const proceedVerified = async (verified: string) => {
    await markPinVerifiedThisInstall();
    if (bioAvailable) {
      setVerifiedPin(verified);
      setStep('biometric');
    } else {
      await finish();
    }
  };

  const handlePinComplete = async (submittedPin: string) => {
    if (loading) return;
    try {
      setLoading(true);
      setPinError('');
      const valid = await validatePin(submittedPin);
      if (valid) {
        await proceedVerified(submittedPin);
      } else {
        setPinError(t('auth.welcomeBack.invalidPin'));
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

  const handleEnableBiometric = async () => {
    setBioError('');
    const success = await authenticateWithBiometrics(
      t('common.enableBiometricPrompt', { label })
    );
    if (!success) {
      setBioError(t('auth.biometricSetup.failedPrompt'));
      return;
    }
    try {
      setLoading(true);
      await storePinInKeychain(verifiedPin);
      await setBiometricEnabled(true);
    } catch (err) {
      // Keychain hiccups shouldn't block entry — user can enable in Security.
      logger.warn('Welcome-back biometric enable failed:', err);
      await setBiometricEnabled(false).catch(() => {});
    } finally {
      setLoading(false);
    }
    await finish();
  };

  const handleSkipBiometric = async () => {
    await setBiometricEnabled(false).catch(() => {});
    await finish();
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

  if (step === 'reset') {
    return (
      <ResetPinScreen
        onDone={(newPin) => proceedVerified(newPin)}
        onCancel={() => setStep('pin')}
      />
    );
  }

  if (step === 'biometric') {
    return (
      <AuthLayout contentStyle={styles.centered}>
        <AuthHeader
          icon={<BiometricIcon size={40} />}
          title={t('auth.biometricSetup.enableTitle', { label })}
          subtitle={t('auth.biometricSetup.enableSubtitle', { label })}
        />
        {bioError ? <Text style={styles.bioError}>{bioError}</Text> : null}
        <Button
          title={t('auth.biometricSetup.enableButton', { label })}
          onPress={handleEnableBiometric}
          variant="gradient"
          fullWidth
          loading={loading}
          style={styles.button}
        />
        <TouchableOpacity onPress={handleSkipBiometric} style={styles.skipBtn}>
          <Text style={styles.skipText}>{t('auth.biometricSetup.skip')}</Text>
        </TouchableOpacity>
      </AuthLayout>
    );
  }

  return (
    <SafeAreaView style={styles.fullScreen}>
      <PinKeypad
        value={pin}
        onChange={(val) => {
          setPin(val);
          if (pinError) setPinError('');
        }}
        onComplete={loading ? undefined : handlePinComplete}
        title={
          fullName
            ? t('auth.welcomeBack.titleName', { name: fullName })
            : t('auth.welcomeBack.title')
        }
        subtitle={t('auth.welcomeBack.subtitle')}
        error={pinError}
      />
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={() => setStep('reset')}
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

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  centered: {
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
  bioError: {
    ...typography.caption,
    color: colors.dark.error,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  button: {
    marginBottom: spacing.md,
    marginTop: spacing.lg,
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
});
