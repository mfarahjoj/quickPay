import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import {
  DarkScreen,
  ScreenHeader,
  GlassCard,
  PillButton,
  PinInput,
  TEXT_DIM,
} from '../../components';
import { functions } from '../../services/firebase.config';
import { signOut } from '../../services/auth.service';
import { useExitGuard } from '../../hooks/useExitGuard';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';

type Step = 'info' | 'pin';

const POINTS = ['balance', 'immediate', 'retention'] as const;

/**
 * Delete account: the merchant app's half of Google Play's account-deletion
 * rule (accounts made in the app must be deletable in the app).
 *
 * Same callable as the customer app (`requestAccountDeletion`): it checks the
 * PIN, refuses while the wallet holds money, and marks the user closed, which
 * also stops their Merchant API keys. Personal data goes within 30 days.
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const [step, setStep] = useState<Step>('info');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const backToInfo = () => {
    setPin('');
    setPinError(null);
    setStep('info');
  };

  useExitGuard(navigation, {
    blocked: submitting,
    onExit: step === 'pin' ? backToInfo : undefined,
  });

  const submit = async (enteredPin: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await functions().httpsCallable('requestAccountDeletion')({ pin: enteredPin });
      Alert.alert(t('deleteAccount.doneTitle'), t('deleteAccount.doneMessage'), [
        { text: t('common.ok'), onPress: () => signOut() },
      ]);
    } catch (e: any) {
      if (isWrongPin(e)) {
        setPinError(t('errors.wrongPin'));
      } else {
        // "Withdraw your remaining balance" is failed-precondition, which
        // pinActionErrorKey would read as a short balance.
        const balanceLeft =
          e?.code === 'functions/failed-precondition' && /withdraw/i.test(e?.message ?? '');
        setError(t(balanceLeft ? 'deleteAccount.balanceNotZero' : pinActionErrorKey(e)));
        setStep('info');
      }
    } finally {
      setPin('');
      setSubmitting(false);
    }
  };

  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('deleteAccount.pinTitle')}</Text>
        <Text style={styles.sub}>{t('deleteAccount.pinSubtitle')}</Text>
        <PinInput
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError(null);
          }}
          onComplete={submit}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        {submitting ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={backToInfo} disabled={submitting} />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll>
      <ScreenHeader title={t('deleteAccount.title')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <GlassCard style={styles.card}>
          {POINTS.map((point) => (
            <View key={point} style={styles.point}>
              <View style={styles.dot} />
              <Text style={styles.pointText}>{t(`deleteAccount.point.${point}`)}</Text>
            </View>
          ))}
        </GlassCard>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PillButton
          style={styles.continueButton}
          label={t('common.continue')}
          onPress={() => {
            setError(null);
            setStep('pin');
          }}
        />
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 20,
  },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  card: { padding: 18, gap: 14, marginTop: 4 },
  point: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF6961', marginTop: 8 },
  pointText: { flex: 1, fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.8)' },
  error: { fontSize: 14, color: '#FF6961', marginTop: 16, lineHeight: 20 },
  continueButton: { marginTop: 24 },
});
