import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PinKeypad } from '../../components/PinKeypad';
import {
  loginWithPin,
  DeviceNotTrustedError,
  IncorrectPinError,
  PinLockoutError, pinLockoutMessage,
} from '../../services/auth.service';
import { markPinVerifiedThisInstall } from '../../hooks/usePinVerifiedThisInstall';
import { getDeviceCredential } from '../../services/device.service';
import { accountLine } from '../../services/accountLabel';
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
  // Whose account this phone signs in to. On a shared phone, someone else
  // typing their own PIN here counts against the owner's lockout.
  const [account, setAccount] = useState<string | null>(null);
  const [wrongPins, setWrongPins] = useState(0);

  useEffect(() => {
    getDeviceCredential()
      .then((cred) => setAccount(accountLine(cred?.label)))
      .catch(() => undefined);
  }, []);

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
        setError(pinLockoutMessage(err, t));
      } else if (err instanceof IncorrectPinError) {
        setError(t('auth.pinLogin.invalidPin'));
        setWrongPins((n) => n + 1);
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
        subtitle={
          account
            ? t('auth.pinLogin.subtitleFor', { account })
            : t('auth.pinLogin.subtitle')
        }
        error={error}
      />
      <View style={styles.footer}>
        {wrongPins > 0 && account ? (
          <Text style={styles.wrongAccountHint}>
            {t('auth.pinLogin.wrongAccountHint', { account })}
          </Text>
        ) : null}
        <TouchableOpacity
          onPress={onUseCode}
          style={[styles.linkButton, wrongPins > 0 && styles.linkButtonProminent]}
          accessibilityLabel={account ? t('auth.pinLogin.notYou') : t('auth.pinLogin.useCode')}
        >
          <Text style={styles.linkText}>
            {account ? t('auth.pinLogin.notYou') : t('auth.pinLogin.useCode')}
          </Text>
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
  linkButtonProminent: {
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.dark.accentText,
  },
  wrongAccountHint: {
    ...typography.body,
    color: colors.dark.textDim,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
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
