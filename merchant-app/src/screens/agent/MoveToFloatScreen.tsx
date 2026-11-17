/**
 * Move to float (AGENT_FLOAT_SEPARATION.md): an agent tops up their float
 * from their own sales and earnings, so they can serve more cash-ins
 * without a trip to ops. One way only: float goes back to sales only
 * through Zapp Pay's float desk.
 *
 * In shillings or dollars: wallet shillings become shilling float, never
 * converted (SHILLINGS.md).
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import {
  CurrencyToggle,
  DarkScreen,
  ScreenHeader,
  GlassCard,
  PillButton,
  PinInput,
  TEXT_DIM,
  TEXT_FAINT,
  type FloatCurrency,
} from '../../components';
import { functions } from '../../services/firebase.config';
import { useWallet } from '../../hooks/useWallet';
import { useFloat } from '../../hooks/useFloat';
import { formatAmount, sanitizeAmountFor, toAmount } from '../../utils/money';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { newIdempotencyKey } from '../../utils/idempotency';

export default function MoveToFloatScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { wallet } = useWallet();
  const { floatCents, floatSls } = useFloat(true, wallet?.lastTransactionAt?.getTime());

  const [currency, setCurrency] = useState<FloatCurrency>('USD');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'amount' | 'pin'>('amount');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt, kept across retries of that attempt.
  const [key, setKey] = useState(newIdempotencyKey);

  // In the chosen currency's smallest unit: cents, or whole shillings.
  const cents = toAmount(amount, currency);
  const available = (currency === 'SLS' ? wallet?.slsBalance : wallet?.balanceCents) ?? 0;
  const float = currency === 'SLS' ? floatSls : floatCents;
  const valid = cents > 0 && cents <= available;
  const show = (n: number) => formatAmount(n, currency);

  const pickCurrency = (next: FloatCurrency) => {
    if (next === currency) return;
    setCurrency(next);
    setAmount('');
    setKey(newIdempotencyKey());
  };

  const submit = async (enteredPin: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await functions().httpsCallable('moveToFloat')({
        amountCents: cents,
        currency,
        pin: enteredPin,
        idempotencyKey: key,
      });
      Alert.alert(t('common.success'), t('moveToFloat.done', { amount: show(cents) }), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      if (isWrongPin(e)) {
        setPinError(t('errors.wrongPin'));
      } else {
        setStep('amount');
        setKey(newIdempotencyKey());
        Alert.alert(
          t('common.error'),
          e?.details?.reason === 'insufficient_balance'
            ? t(currency === 'SLS' ? 'moveToFloat.notEnoughSls' : 'moveToFloat.notEnough')
            : t(pinActionErrorKey(e))
        );
      }
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('payout.pinTitle')}</Text>
        <Text style={styles.sub}>{t('moveToFloat.pinSubtitle', { amount: show(cents) })}</Text>
        <PinInput
          autoFocus
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (pinError) setPinError(null);
          }}
          onComplete={submit}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        {busy ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={() => setStep('amount')} disabled={busy} />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard>
      <ScreenHeader title={t('moveToFloat.title')} subtitle={t('moveToFloat.subtitle')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <CurrencyToggle value={currency} onChange={pickCurrency} />
        <View style={styles.balances}>
          <GlassCard style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>{t('dashboard.balance.salesLabel')}</Text>
            <Text style={styles.balanceValue}>{show(available)}</Text>
          </GlassCard>
          <GlassCard style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>{t('dashboard.float.label')}</Text>
            <Text style={styles.balanceValue}>{float === null ? '…' : show(float)}</Text>
          </GlassCard>
        </View>

        <Text style={styles.label}>{t('moveToFloat.amountLabel')}</Text>
        <GlassCard>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={(v) => setAmount(sanitizeAmountFor(v, currency))}
            keyboardType={currency === 'SLS' ? 'number-pad' : 'decimal-pad'}
            placeholder={currency === 'SLS' ? '0,000' : '0.00'}
            placeholderTextColor={TEXT_FAINT}
          />
        </GlassCard>
        <Text style={styles.hint}>{t('moveToFloat.hint')}</Text>

        <PillButton style={styles.next} label={t('common.continue')} disabled={!valid} onPress={() => setStep('pin')} />
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  balances: { flexDirection: 'row', gap: 10, marginTop: 16 },
  balanceCard: { flex: 1, padding: 14 },
  balanceLabel: { fontSize: 11, fontWeight: '700', color: TEXT_FAINT, letterSpacing: 1, textTransform: 'uppercase' },
  balanceValue: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', marginTop: 6 },
  label: { fontSize: 12, fontWeight: '700', color: TEXT_FAINT, letterSpacing: 1, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 },
  input: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', padding: 16 },
  hint: { fontSize: 12, color: TEXT_FAINT, marginTop: 10, lineHeight: 17 },
  next: { marginTop: 24 },
});
