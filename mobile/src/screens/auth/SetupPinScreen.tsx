import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setupPin } from '../../services/auth.service';
import { setPendingSetupPin } from '../../services/biometric.service';
import { markPinVerifiedThisInstall } from '../../hooks/usePinVerifiedThisInstall';
import { AuthLayout, AuthHeader } from '../../components/auth';
import { isWeakPin } from '../../components/auth/CodeInput';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { PinKeypad } from '../../components/PinKeypad';
import { colors, typography, spacing } from '../../theme';

type Step = 'name' | 'enter' | 'confirm';

interface Props {
  navigation?: any;
  /**
   * Called when this step is done. `verified` is true for a genuinely new PIN
   * (the account had none), false when the account already had a PIN and the
   * one typed here was NOT stored — the caller must then route to welcome-back
   * verification rather than treating it as verified.
   */
  onComplete?: (result: { verified: boolean }) => void;
}

export default function SetupPinScreen({ onComplete }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('name');
  const [fullName, setFullName] = useState('');
  const [nameError, setNameError] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // ─── Step 1: Name ────────────────────────────────────────────

  const handleNameContinue = () => {
    if (!fullName.trim()) {
      setNameError(t('auth.setupPin.requiredMessage'));
      return;
    }
    setNameError('');
    setStep('enter');
  };

  // ─── Step 2: Enter PIN ────────────────────────────────────────

  const handlePinChange = (val: string) => {
    setPin(val);
    if (pinError) setPinError('');
  };

  const handlePinComplete = (val: string) => {
    if (isWeakPin(val)) {
      setPinError(t('auth.setupPin.weakPin'));
      setPin('');
      return;
    }
    setStep('confirm');
  };

  // ─── Step 3: Confirm PIN ──────────────────────────────────────

  const handleConfirmChange = (val: string) => {
    setConfirmPin(val);
    if (confirmError) setConfirmError('');
  };

  const handleConfirmComplete = async (val: string) => {
    if (val !== pin) {
      setConfirmError(t('auth.setupPin.pinMismatchInline'));
      setConfirmPin('');
      return;
    }
    try {
      setLoading(true);
      setSubmitError('');
      const { alreadyHasPin } = await setupPin({ pin, fullName: fullName.trim(), accountType: 'customer', referralCode: referralCode.trim() || undefined });
      await AsyncStorage.setItem('@quickpay_pin_setup_done', 'true');
      if (alreadyHasPin) {
        // The account already had a PIN and the backend kept it — the PIN
        // typed here was never stored. Don't hand it to the biometric screen
        // or mark it verified; the welcome-back gate will verify the real one.
        onComplete?.({ verified: false });
        return;
      }
      await markPinVerifiedThisInstall();
      // Hand the fresh PIN to the biometric setup screen so it isn't retyped.
      setPendingSetupPin(pin);
      onComplete?.({ verified: true });
    } catch (error: any) {
      setSubmitError(error.message ?? t('common.error'));
      setConfirmPin('');
    } finally {
      setLoading(false);
    }
  };

  // ─── Back navigation ─────────────────────────────────────────

  const handleBack = () => {
    if (step === 'confirm') {
      setConfirmPin('');
      setConfirmError('');
      setStep('enter');
    } else if (step === 'enter') {
      setPin('');
      setPinError('');
      setStep('name');
    }
  };

  // ─── Render ───────────────────────────────────────────────────

  if (step === 'name') {
    return (
      <AuthLayout step={{ current: 3, total: 3 }}>
        <AuthHeader
          title={t('auth.setupPin.title')}
          subtitle={t('auth.setupPin.subtitle')}
          centered={false}
        />
        <Input
          label={t('auth.setupPin.fullName')}
          placeholder={t('auth.setupPin.fullNamePlaceholder')}
          value={fullName}
          onChangeText={(text) => {
            setFullName(text);
            if (nameError) setNameError('');
          }}
          autoCapitalize="words"
          error={nameError}
        />
        <Input
          label={t('invite.howInvited')}
          placeholder={t('invite.codePlaceholder')}
          value={referralCode}
          onChangeText={(text) => setReferralCode(text.toUpperCase().replace(/[^A-F0-9]/g, ''))}
          maxLength={8}
          autoCapitalize="characters"
        />
        <Button
          title={t('common.continue')}
          onPress={handleNameContinue}
          variant="gradient"
          fullWidth
          style={styles.button}
        />
      </AuthLayout>
    );
  }

  return (
    <SafeAreaView style={styles.fullScreen}>
      {/* Back button */}
      <TouchableOpacity style={styles.backButton} onPress={handleBack} accessibilityLabel={t('common.back')}>
        <Text style={styles.backIcon}>‹</Text>
      </TouchableOpacity>

      {step === 'enter' ? (
        <PinKeypad
          value={pin}
          onChange={handlePinChange}
          onComplete={handlePinComplete}
          title={t('auth.setupPin.enterPinTitle')}
          subtitle={t('auth.setupPin.enterPinSubtitle')}
          error={pinError}
        />
      ) : (
        <>
          <PinKeypad
            value={confirmPin}
            onChange={handleConfirmChange}
            onComplete={loading ? undefined : handleConfirmComplete}
            title={t('auth.setupPin.confirmPinTitle')}
            subtitle={t('auth.setupPin.confirmPinSubtitle')}
            error={confirmError}
          />
          {submitError ? (
            <Text style={styles.submitError}>{submitError}</Text>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  backButton: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.lg,
    zIndex: 10,
    padding: spacing.sm,
  },
  backIcon: {
    fontSize: 32,
    color: colors.dark.text,
    lineHeight: 36,
  },
  button: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  submitError: {
    ...typography.caption,
    color: colors.dark.error,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
});
