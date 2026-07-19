import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { BiometryTypes } from 'react-native-biometrics';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { PinInput } from '../../components/PinInput';
import { colors, typography, spacing } from '../../theme';
import { validatePin, PinLockoutError } from '../../services/auth.service';
import { functions } from '../../services/firebase.config';
import {
  isBiometricEnabled,
  setBiometricEnabled,
  clearPinFromKeychain,
  storePinInKeychain,
  isBiometricAvailable,
} from '../../services/biometric.service';

interface Props {
  navigation: any;
}

function getBiometricLabelKey(biometryType?: string): string {
  if (biometryType === BiometryTypes.FaceID) return 'biometric.faceId';
  if (biometryType === BiometryTypes.TouchID) return 'biometric.touchId';
  return 'biometric.generic';
}

export default function SecurityScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [changingPin, setChangingPin] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<string | undefined>();
  const [showBiometricPin, setShowBiometricPin] = useState(false);
  const [biometricPin, setBiometricPin] = useState('');

  const biometricLabel = useMemo(
    () => t(getBiometricLabelKey(biometryType)),
    [biometryType, t],
  );

  useEffect(() => {
    Promise.all([isBiometricEnabled(), isBiometricAvailable()]).then(
      ([enabled, { available, biometryType: bt }]) => {
        setBiometricEnabledState(enabled);
        setBiometricAvailable(available);
        setBiometryType(bt);
      }
    );
  }, []);

  const handleBiometricDisable = () => {
    Alert.alert(
      t('profile.security.disableBiometricTitle', { label: biometricLabel }),
      t('profile.security.disableBiometricMessage', { label: biometricLabel }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.disable'),
          style: 'destructive',
          onPress: async () => {
            await clearPinFromKeychain();
            await setBiometricEnabled(false);
            setBiometricEnabledState(false);
          },
        },
      ],
    );
  };

  const handleEnableBiometricWithPin = async () => {
    if (biometricPin.length !== 6) {
      Alert.alert(t('common.error'), t('profile.security.enter6DigitPin'));
      return;
    }
    try {
      setLoading(true);
      const isValid = await validatePin(biometricPin);
      if (!isValid) {
        Alert.alert(t('common.error'), t('profile.security.pinIncorrect'));
        setLoading(false);
        return;
      }
      await storePinInKeychain(biometricPin);
      await setBiometricEnabled(true);
      setBiometricEnabledState(true);
      setShowBiometricPin(false);
      setBiometricPin('');
    } catch (err: any) {
      if (err instanceof PinLockoutError) {
        Alert.alert(t('common.error'), t('pin.lockedOut', { seconds: err.secondsLeft ?? 60 }));
      } else {
        Alert.alert(t('common.error'), err.message ?? t('profile.security.failedEnableBiometrics'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChangePin = async () => {
    if (currentPin.length !== 6 || newPin.length !== 6 || confirmPin.length !== 6) {
      Alert.alert(t('common.error'), t('profile.security.enterAllPins'));
      return;
    }
    if (newPin !== confirmPin) {
      Alert.alert(t('common.error'), t('profile.security.pinMismatch'));
      return;
    }
    if (newPin === currentPin) {
      Alert.alert(t('common.error'), t('profile.security.pinMustDiffer'));
      return;
    }

    try {
      setLoading(true);
      const isValid = await validatePin(currentPin);
      if (!isValid) {
        Alert.alert(t('common.error'), t('profile.security.currentPinWrong'));
        setLoading(false);
        return;
      }

      try {
        const changePinFunction = functions().httpsCallable('changePin');
        const result = await changePinFunction({
          currentPin,
          newPin,
        });
        const data = result.data as { success?: boolean; error?: string };
        if (data.success !== false) {
          Alert.alert(t('common.success'), t('profile.security.pinChangeSuccess'));
          setChangingPin(false);
          setCurrentPin('');
          setNewPin('');
          setConfirmPin('');
        } else {
          Alert.alert(t('common.error'), data.error ?? t('profile.security.failedChangePin'));
        }
      } catch (innerErr: any) {
        const code = innerErr?.code;
        if (code === 'functions/not-found' || code === 'functions/unimplemented') {
          Alert.alert(
            t('common.comingSoon'),
            t('profile.security.pinChangeComingSoon')
          );
        } else {
          const msg =
            innerErr?.message?.replace(/^\[.*?\]\s*/, '') ||
            t('common.failedChangePinRetry');
          Alert.alert(t('common.error'), msg);
        }
      }
    } catch (err: any) {
      if (err instanceof PinLockoutError) {
        Alert.alert(t('common.error'), t('pin.lockedOut', { seconds: err.secondsLeft ?? 60 }));
      } else {
        Alert.alert(t('common.error'), err.message ?? t('profile.security.failedChangePin'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title={t('profile.security.title')} onBack={() => navigation.goBack()} />

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.security.changePin')}</Text>
          <Text style={styles.sectionDesc}>
            {t('profile.security.changePinDesc')}
          </Text>

          {!changingPin ? (
            <Button
              title={t('profile.security.changePin')}
              onPress={() => setChangingPin(true)}
              variant="darkGhost"
            />
          ) : (
            <View style={styles.pinForm}>
              <Text style={styles.label}>{t('profile.security.currentPin')}</Text>
              <PinInput value={currentPin} onChange={setCurrentPin} />

              <Text style={styles.label}>{t('profile.security.newPin')}</Text>
              <PinInput value={newPin} onChange={setNewPin} />

              <Text style={styles.label}>{t('profile.security.confirmNewPin')}</Text>
              <PinInput value={confirmPin} onChange={setConfirmPin} />

              <View style={styles.buttonRow}>
                <Button
                  title={t('common.cancel')}
                  onPress={() => {
                    setChangingPin(false);
                    setCurrentPin('');
                    setNewPin('');
                    setConfirmPin('');
                  }}
                  variant="darkGhost"
                  style={styles.cancelButton}
                />
                <Button
                  title={t('profile.security.updatePin')}
                  onPress={handleChangePin}
                  loading={loading}
                  style={styles.submitButton}
                />
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.security.biometrics')}</Text>
          <Text style={styles.sectionDesc}>
            {t('profile.security.biometricsDesc', { label: biometricLabel })}
          </Text>
          {biometricAvailable ? (
            <>
              {showBiometricPin ? (
                <View style={styles.biometricPinForm}>
                  <Text style={styles.label}>{t('profile.security.enterPinEnable')}</Text>
                  <PinInput value={biometricPin} onChange={setBiometricPin} />
                  <View style={styles.buttonRow}>
                    <Button
                      title={t('common.cancel')}
                      onPress={() => {
                        setShowBiometricPin(false);
                        setBiometricPin('');
                      }}
                      variant="darkGhost"
                      style={styles.cancelButton}
                    />
                    <Button
                      title={t('common.enable')}
                      onPress={handleEnableBiometricWithPin}
                      loading={loading}
                      disabled={biometricPin.length !== 6}
                      style={styles.submitButton}
                    />
                  </View>
                </View>
              ) : biometricEnabled ? (
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>
                    {t('profile.security.biometricEnabled', { label: biometricLabel })}
                  </Text>
                  <Switch
                    value={true}
                    onValueChange={() => handleBiometricDisable()}
                    trackColor={{
                      false: 'rgba(255,255,255,0.15)',
                      true: colors.dark.accent,
                    }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              ) : (
                <Button
                  title={t('common.enableBiometric', { label: biometricLabel })}
                  onPress={() => setShowBiometricPin(true)}
                  variant="darkGhost"
                />
              )}
            </>
          ) : (
            <Text style={styles.comingSoon}>
              {t('profile.security.biometricsUnavailable')}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  section: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    padding: spacing.lg,
    borderRadius: 16,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.dark.text,
    marginBottom: spacing.sm,
  },
  sectionDesc: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.lg,
  },
  pinForm: {
    marginTop: spacing.sm,
  },
  label: {
    ...typography.captionBold,
    color: colors.dark.textDim,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  cancelButton: {
    flex: 1,
  },
  submitButton: {
    flex: 1,
  },
  comingSoon: {
    ...typography.caption,
    color: colors.dark.textFaint,
    fontStyle: 'italic',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    ...typography.body,
    color: colors.dark.text,
  },
  biometricPinForm: {
    marginTop: spacing.sm,
  },
});
