import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { functions } from '../../services/firebase.config';
import {
  DarkScreen,
  GlassCard,
  PillButton,
  PinInput,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import { SuccessCheckIcon, CloseIcon } from '../../components/icons/AuthIcons';

type Step = 'enter' | 'pin' | 'processing' | 'success' | 'error';

interface Props {
  navigation: any;
}

export default function ConfirmCashOutScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('enter');
  const [otp, setOtp] = useState('');
  // Confirming pays the customer cash and moves their held balance into this
  // agent's float, so the agent authorises it with their PIN.
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<{ amount: number; customerName: string; commission: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleConfirm = () => {
    if (otp.length !== 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit code from the customer.');
      return;
    }
    setPin('');
    setStep('pin');
  };

  const submit = async (agentPin: string) => {
    setStep('processing');
    try {
      const fn = functions().httpsCallable('agentConfirmCashOut');
      const res = await fn({ otpCode: otp, agentPin });
      const data = (res.data as any).data;
      setResult(data);
      setStep('success');
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to confirm cash-out');
      setStep('error');
    } finally {
      setPin('');
    }
  };

  if (step === 'success' && result) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.resultTitle}>Cash Out Confirmed</Text>
        <Text style={styles.resultAmount}>
          ${(result.amount / 100).toFixed(2)}
        </Text>
        <Text style={styles.resultSub}>
          Paid to {result.customerName}
        </Text>
        {result.commission > 0 && (
          <GlassCard style={styles.commissionCard}>
            <Text style={styles.commissionLabel}>YOUR COMMISSION</Text>
            <Text style={styles.commissionValue}>
              +${(result.commission / 100).toFixed(2)}
            </Text>
          </GlassCard>
        )}
        <View style={styles.resultBtn}>
          <PillButton label="Done" onPress={() => navigation.goBack()} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'error') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <View style={styles.failIcon}>
          <CloseIcon size={32} color="#FF6961" />
        </View>
        <Text style={styles.resultTitle}>Code Not Found</Text>
        <Text style={styles.resultSub}>{errorMsg}</Text>
        <View style={styles.resultBtn}>
          <PillButton
            label="Try Again"
            variant="glass"
            onPress={() => { setStep('enter'); setOtp(''); setErrorMsg(''); }}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'processing') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.processingText}>Verifying code…</Text>
      </DarkScreen>
    );
  }

  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <Text style={styles.resultTitle}>{t('cashout.confirm.pinTitle')}</Text>
        <Text style={styles.resultSub}>{t('cashout.confirm.pinSubtitle')}</Text>
        <PinInput
          value={pin}
          onChange={setPin}
          onComplete={submit}
          style={styles.pinInput}
        />
        <View style={styles.resultBtn}>
          <PillButton
            label={t('common.cancel')}
            variant="glass"
            onPress={() => {
              setPin('');
              setStep('enter');
            }}
          />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard contentStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Confirm Cash Out</Text>
          <Text style={styles.subtitle}>Enter the 6-digit code from the customer</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.label}>CUSTOMER CODE</Text>
        <GlassCard style={styles.otpCard}>
          <TextInput
            style={styles.otpInput}
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="— — — — — —"
            placeholderTextColor="rgba(255,255,255,0.2)"
            autoFocus
          />
        </GlassCard>

        <GlassCard style={styles.infoCard}>
          <Text style={styles.infoTitle}>How to complete a cash-out</Text>
          <Text style={styles.infoStep}>1. Customer shows you a 6-digit code from their app</Text>
          <Text style={styles.infoStep}>2. Enter the code above and tap Confirm</Text>
          <Text style={styles.infoStep}>3. Hand the customer their cash</Text>
          <Text style={styles.infoStep}>4. You earn a commission automatically</Text>
        </GlassCard>
      </View>

      <View style={styles.footer}>
        <PillButton
          label="Confirm & Pay Cash"
          onPress={handleConfirm}
          disabled={otp.length !== 6}
        />
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingTop: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  backArrow: { fontSize: 24, color: '#FFFFFF', lineHeight: 28 },
  title: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: TEXT_DIM, marginTop: 3 },
  body: { flex: 1, paddingHorizontal: 24, gap: 16 },
  label: {
    fontSize: 12, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', color: TEXT_FAINT,
  },
  otpCard: {
    height: 72, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  otpInput: {
    fontSize: 34, fontWeight: '800', color: ACCENT,
    letterSpacing: 8, textAlign: 'center', width: '100%',
  },
  infoCard: { padding: 18, gap: 8 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: TEXT_DIM, marginBottom: 4 },
  infoStep: { fontSize: 13, color: TEXT_FAINT, lineHeight: 20 },
  footer: { paddingHorizontal: 24, paddingBottom: 36 },

  // Result states
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  failIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,59,48,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  resultTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, textAlign: 'center', marginTop: 20 },
  resultAmount: { fontSize: 44, fontWeight: '800', color: '#34C77B', letterSpacing: -2, marginTop: 8 },
  resultSub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  commissionCard: { marginTop: 20, padding: 18, alignItems: 'center', width: '100%' },
  commissionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  commissionValue: { fontSize: 28, fontWeight: '800', color: '#34C77B', marginTop: 4 },
  resultBtn: { alignSelf: 'stretch', marginTop: 28 },
  pinInput: { marginTop: 28 },
  processingText: { fontSize: 16, color: TEXT_DIM, marginTop: 20 },
});
