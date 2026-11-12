import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, PillButton, PinInput, TEXT_DIM } from '../../components';
import { isWeakPin } from '../../components/auth';
import { changePin, PinLockoutError } from '../../services/auth.service';
import { pinLockoutText } from '../../components/security/AppLockGate';
import { useExitGuard } from '../../hooks/useExitGuard';
import { logger } from '../../utils/logger';

type Step = 'current' | 'new' | 'confirm';

/**
 * Change PIN (review A3): current PIN, new PIN, confirm. Same callable as the
 * customer app; the server checks the current PIN against the shared lockout,
 * refuses weak PINs, ends other sessions and tells the owner.
 */
export default function ChangePinScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [step, setStep] = useState<Step>('current');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useExitGuard(navigation, { blocked: submitting });

  const restart = (message: string) => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(message);
    setStep('current');
  };

  const submit = async (confirmed: string) => {
    if (confirmed !== next) {
      setConfirm('');
      setError(t('security.pinMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await changePin(current, next);
      Alert.alert(t('security.change.doneTitle'), t('security.change.doneMessage'), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      logger.error('Change PIN error:', err);
      if (err instanceof PinLockoutError) {
        restart(pinLockoutText(err, t));
      } else if (err?.code === 'functions/permission-denied') {
        restart(t('security.change.currentWrong'));
      } else if (err?.details?.reason === 'weak_pin') {
        setNext('');
        setConfirm('');
        setError(t('auth.setupPin.weakPin'));
        setStep('new');
      } else {
        restart(t('security.change.failed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onComplete = (val: string) => {
    if (step === 'current') {
      setError('');
      setStep('new');
    } else if (step === 'new') {
      if (isWeakPin(val)) {
        setNext('');
        setError(t('auth.setupPin.weakPin'));
        return;
      }
      if (val === current) {
        setNext('');
        setError(t('security.change.mustDiffer'));
        return;
      }
      setError('');
      setStep('confirm');
    } else {
      submit(val);
    }
  };

  const value = step === 'current' ? current : step === 'new' ? next : confirm;
  const setValue = step === 'current' ? setCurrent : step === 'new' ? setNext : setConfirm;
  const titleKey =
    step === 'current' ? 'security.change.currentTitle' : step === 'new' ? 'security.newPinTitle' : 'security.confirmPinTitle';
  const subKey =
    step === 'current'
      ? 'security.change.currentSubtitle'
      : step === 'new'
        ? 'security.newPinSubtitle'
        : 'security.confirmPinSubtitle';

  return (
    <DarkScreen keyboard>
      <ScreenHeader title={t('security.change.title')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <Text style={styles.title}>{t(titleKey)}</Text>
        <Text style={styles.sub}>{t(subKey)}</Text>
        <PinInput
          key={step}
          value={value}
          onChange={(v) => {
            setValue(v);
            if (error) setError('');
          }}
          onComplete={submitting ? undefined : onComplete}
          style={styles.pin}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {submitting ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
        {step === 'current' && (
          <PillButton
            style={styles.forgot}
            variant="glass"
            label={t('security.forgotPin')}
            onPress={() => navigation.replace('ResetPin')}
          />
        )}
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48, alignItems: 'center' },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 20,
  },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  pin: { marginTop: 28 },
  error: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  forgot: { alignSelf: 'stretch', marginTop: 36 },
});
