import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { PinInput } from '../../components/PinInput';
import { CodeInput } from '../../components/auth/CodeInput';
import { getCurrentUser, sendOTP, verifyOTP } from '../../services/auth.service';
import { finishPhoneChange, sendCodeToNewPhone, startPhoneChange } from '../../services/phoneChange.service';
import { logger } from '../../utils/logger';

/**
 * Change phone number (review B5, E13). The account and its money stay; the
 * number moves. Steps:
 *   number  the new number, and whether they still have the old one
 *   oldCode SMS to the old number            (if they have it)
 *   id      last 4 of their verified ID      (if they don't)
 *   pin     their PIN; the server approves the change
 *   newCode SMS to the new number; the account moves to it
 * Afterwards sending money is paused for a week.
 */
type Step = 'number' | 'oldCode' | 'id' | 'pin' | 'newCode';

const ACCENT = '#FF5043';

export default function ChangePhoneScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const currentPhone = getCurrentUser()?.phoneNumber ?? '';

  const [step, setStep] = useState<Step>('number');
  const [newPhone, setNewPhone] = useState('+252');
  const [hasOld, setHasOld] = useState(true);
  const [code, setCode] = useState('');
  const [idLast4, setIdLast4] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const oldConfirmation = useRef<FirebaseAuthTypes.ConfirmationResult | null>(null);
  const newVerificationId = useRef<string | null>(null);

  const validNumber = /^\+[1-9]\d{7,14}$/.test(newPhone);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err: any) {
      logger.error('Change phone error:', err);
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const messageFor = (err: any): string => {
    switch (err?.details?.reason) {
      case 'phone_taken':
        return t('changePhone.taken');
      case 'phone_change_needs_proof':
        return t('changePhone.needsProof');
      case 'reset_id_wrong':
        return t('changePhone.idWrong', { count: err.details.attemptsLeft });
      case 'reset_id_locked':
      case 'reset_needs_agent':
        return t('changePhone.needsSupport');
      case 'phone_change_expired':
        return t('changePhone.expired');
    }
    if (err?.code === 'functions/permission-denied') return t('changePhone.pinWrong');
    if (err?.code === 'functions/resource-exhausted') return t('changePhone.locked');
    if (err?.code === 'auth/credential-already-in-use' || err?.code === 'auth/account-exists-with-different-credential') {
      return t('changePhone.taken');
    }
    if (err?.code === 'auth/invalid-verification-code') return t('changePhone.codeWrong');
    return t('changePhone.failed');
  };

  const continueFromNumber = () =>
    run(async () => {
      if (newPhone === currentPhone) {
        setError(t('changePhone.same'));
        return;
      }
      if (hasOld) {
        oldConfirmation.current = await sendOTP(currentPhone);
        setCode('');
        setStep('oldCode');
      } else {
        setStep('id');
      }
    });

  const confirmOldCode = (value: string) =>
    run(async () => {
      if (!oldConfirmation.current) return;
      await verifyOTP(oldConfirmation.current, value).catch(() => {
        setCode('');
        throw Object.assign(new Error('bad code'), { code: 'auth/invalid-verification-code' });
      });
      setStep('pin');
    });

  const submitPin = (value: string) =>
    run(async () => {
      try {
        await startPhoneChange(newPhone, value, hasOld ? undefined : idLast4);
      } finally {
        setPin('');
      }
      newVerificationId.current = await sendCodeToNewPhone(newPhone);
      setCode('');
      setStep('newCode');
    });

  const confirmNewCode = (value: string) =>
    run(async () => {
      if (!newVerificationId.current) return;
      try {
        const result = await finishPhoneChange(newVerificationId.current, value);
        const until = new Date(result.sendingPausedUntil).toLocaleDateString([], {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });
        Alert.alert(t('changePhone.doneTitle'), t('changePhone.doneMessage', { phone: result.phoneNumber, date: until }), [
          { text: t('common.ok'), onPress: () => navigation.goBack() },
        ]);
      } catch (err) {
        setCode('');
        throw err;
      }
    });

  const back = () => {
    setError('');
    if (step === 'number') navigation.goBack();
    else if (step === 'newCode') navigation.goBack();
    else setStep('number');
  };

  let title = t('changePhone.title');
  let subtitle = '';
  let body: React.ReactNode = null;

  if (step === 'number') {
    subtitle = t('changePhone.numberSubtitle', { phone: currentPhone });
    body = (
      <>
        <TextInput
          style={styles.phoneInput}
          value={newPhone}
          onChangeText={(v) => setNewPhone('+' + v.replace(/[^0-9]/g, '').slice(0, 15))}
          keyboardType="phone-pad"
          autoFocus
          accessibilityLabel={t('changePhone.newNumber')}
        />
        <TouchableOpacity style={styles.choice} onPress={() => setHasOld(true)} accessibilityRole="radio" accessibilityState={{ selected: hasOld }}>
          <View style={[styles.radio, hasOld && styles.radioOn]} />
          <Text style={styles.choiceText}>{t('changePhone.haveOld')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.choice} onPress={() => setHasOld(false)} accessibilityRole="radio" accessibilityState={{ selected: !hasOld }}>
          <View style={[styles.radio, !hasOld && styles.radioOn]} />
          <Text style={styles.choiceText}>{t('changePhone.lostOld')}</Text>
        </TouchableOpacity>
        <Text style={styles.note}>{t('changePhone.pauseNote')}</Text>
        <PrimaryButton label={t('common.continue')} disabled={!validNumber} busy={busy} onPress={continueFromNumber} />
      </>
    );
  } else if (step === 'oldCode' || step === 'newCode') {
    subtitle = t('changePhone.codeSubtitle', { phone: step === 'oldCode' ? currentPhone : newPhone });
    body = (
      <View style={styles.center}>
        <CodeInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError('');
          }}
          onComplete={step === 'oldCode' ? confirmOldCode : confirmNewCode}
          otpMode
        />
        {busy ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
      </View>
    );
  } else if (step === 'id') {
    subtitle = t('changePhone.idSubtitle');
    body = (
      <>
        <TextInput
          style={styles.idInput}
          value={idLast4}
          onChangeText={(v) => setIdLast4(v.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={4}
          placeholder="····"
          placeholderTextColor="rgba(255,255,255,0.25)"
          accessibilityLabel={t('changePhone.idTitle')}
        />
        <PrimaryButton label={t('common.continue')} disabled={idLast4.length !== 4} busy={busy} onPress={() => setStep('pin')} />
      </>
    );
  } else {
    subtitle = t('changePhone.pinSubtitle');
    body = (
      <View style={styles.center}>
        <PinInput value={pin} onChange={setPin} onComplete={busy ? undefined : submitPin} />
        {busy ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.back} onPress={back} accessibilityLabel={t('common.back')}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{step === 'id' ? t('changePhone.idTitle') : title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {body}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PrimaryButton({ label, disabled, busy, onPress }: { label: string; disabled?: boolean; busy?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.button, (disabled || busy) && styles.buttonDisabled]}
      disabled={disabled || busy}
      onPress={onPress}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  back: { paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' },
  backIcon: { fontSize: 32, color: '#FFFFFF', lineHeight: 36 },
  content: { paddingHorizontal: 24, paddingBottom: 48 },
  center: { alignItems: 'center', marginTop: 28 },
  title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: 'rgba(255,255,255,0.6)', marginTop: 8, lineHeight: 21 },
  phoneInput: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 12,
    marginTop: 28,
    marginBottom: 20,
  },
  idInput: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 12,
    marginTop: 28,
  },
  choice: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  radioOn: { borderColor: ACCENT, backgroundColor: ACCENT },
  choiceText: { flex: 1, fontSize: 15, color: '#FFFFFF' },
  note: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 12, lineHeight: 19 },
  spinner: { marginTop: 20 },
  error: { fontSize: 14, color: '#FF6961', marginTop: 16, lineHeight: 20 },
  button: {
    height: 56,
    borderRadius: 28,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});
