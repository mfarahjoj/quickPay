import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PinKeypad } from '../../components/PinKeypad';
import {
  loginWithPin,
  DeviceNotTrustedError,
  IncorrectPinError,
  PinLockoutError,
} from '../../services/auth.service';
import { markPinVerifiedThisInstall } from '../../hooks/usePinVerifiedThisInstall';
import { logger } from '../../utils/logger';
import { colors, typography, spacing } from '../../theme';

interface Props {
  /** Fall back to the phone + SMS code flow. */
  onUseCode: () => void;
  /** Back to the welcome screen. */
  onBack?: () => void;
}

/**
 * PIN-only sign-in for a device that has already verified by SMS once.
 *
 * On success the auth state flips and AppNavigator takes over — there's no
 * onComplete, because signing in is the completion.
 */
export default function PinLoginScreen({ onUseCode, onBack }: Props) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleComplete = async (submitted: string) => {
    if (loading) return;
    try {
      setLoading(true);
      setError('');
      await loginWithPin(submitted);
      // The PIN was just verified server-side, so satisfy the install-scoped
      // flag too — signOut clears it, and without this the navigator would
      // route straight to WelcomeBackScreen and ask for the same PIN again.
      await markPinVerifiedThisInstall();
      // Signed in — the navigator's auth gate swaps this screen out.
    } catch (err) {
      if (err instanceof PinLockoutError) {
        setError(t('pin.lockedOut', { seconds: err.secondsLeft ?? 60 }));
      } else if (err instanceof IncorrectPinError) {
        setError(t('auth.pinLogin.invalidPin'));
      } else if (err instanceof DeviceNotTrustedError) {
        // The credential is gone or rejected; SMS is the only way through.
        setError(t('auth.pinLogin.deviceNotTrusted'));
        setTimeout(onUseCode, 1200);
      } else {
        logger.error('PIN login failed:', err);
        setError(t('auth.appLock.verifyError'));
      }
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.fullScreen}>
      <PinKeypad
        value={pin}
        onChange={(val) => {
          setPin(val);
          if (error) setError('');
        }}
        onComplete={loading ? undefined : handleComplete}
        title={t('auth.pinLogin.title')}
        subtitle={t('auth.pinLogin.subtitle')}
        error={error}
      />
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={onUseCode}
          style={styles.linkButton}
          accessibilityLabel={t('auth.pinLogin.useCode')}
        >
          <Text style={styles.linkText}>{t('auth.pinLogin.useCode')}</Text>
        </TouchableOpacity>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backLink}
            accessibilityLabel={t('common.back')}
          >
            <Text style={styles.backText}>{t('common.back')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
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
  backLink: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  backText: {
    ...typography.body,
    color: colors.dark.textDim,
  },
});
