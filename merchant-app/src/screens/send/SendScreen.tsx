/**
 * Send money from the shop's balance to a person, in shillings or dollars.
 *
 * The two balances are separate and never converted (SHILLINGS.md): a send in
 * shillings comes out of the shop's shillings. `sendP2P` refuses a business
 * as the recipient (a shop is paid by its QR), so this is for paying people.
 *
 *   recipient → the person's number, checked with `lookupRecipient`
 *   amount    → in the chosen currency
 *   pin       → `sendP2P`
 */

import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { CurrencyToggle, DarkScreen, ScreenHeader, GlassCard, PillButton, PinInput, type FloatCurrency } from '../../components';
import { functions } from '../../services/firebase.config';
import { useWallet } from '../../hooks/useWallet';
import { formatAmount, sanitizeAmountFor, toAmount } from '../../utils/money';
import { normaliseSomaliMsisdn } from '../../utils/zaad';
import { callableErrorKey, isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { makeStyles, useColors } from '../../theme';

type Step = 'recipient' | 'amount' | 'pin';

interface Recipient {
  phoneNumber: string;
  displayName: string;
}

/** "+44…" as typed; anything else is read as a Somaliland number. */
function toE164(raw: string): string | null {
  const trimmed = raw.replace(/[\s-]/g, '');
  if (/^\+[0-9]{8,15}$/.test(trimmed)) return trimmed;
  return normaliseSomaliMsisdn(raw);
}

export default function SendScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { wallet } = useWallet();

  const [step, setStep] = useState<Step>('recipient');
  const [phone, setPhone] = useState('');
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  // Starts in the currency the shop holds: always opening on shillings showed
  // "Available: 0 SLSH" to a shop with only dollars. Their pick then sticks.
  const [picked, setPicked] = useState<FloatCurrency | null>(null);
  const currency: FloatCurrency =
    picked ?? ((wallet?.balanceCents ?? 0) === 0 && (wallet?.slsBalance ?? 0) > 0 ? 'SLS' : 'USD');
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const units = toAmount(amount, currency);
  const available = (currency === 'SLS' ? wallet?.slsBalance : wallet?.balanceCents) ?? 0;
  const show = (n: number) => formatAmount(n, currency);
  const valid = units > 0 && units <= available;

  const findRecipient = async () => {
    const e164 = toE164(phone);
    if (!e164) {
      setError(t('send.invalidNumber'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await functions().httpsCallable('lookupRecipient')({ phoneNumber: e164 });
      const found = (res.data as any)?.data;
      if (!found?.found) {
        setError(t(found?.reason === 'self' ? 'send.self' : 'send.notFound'));
        return;
      }
      // A shop is paid by its QR; sendP2P would refuse it anyway.
      if (found.isBusiness) {
        setError(t('send.recipientIsBusiness', { name: found.displayName }));
        return;
      }
      setRecipient({ phoneNumber: found.phoneNumber, displayName: found.displayName });
      setStep('amount');
    } catch (e: any) {
      setError(e?.details?.reason === 'lookup_limit' ? t('send.lookupLimit') : t(callableErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const pickCurrency = (next: FloatCurrency) => {
    if (next === currency) return;
    setPicked(next);
    setAmount('');
  };

  const send = async (enteredPin: string) => {
    if (busy || !recipient) return;
    setBusy(true);
    try {
      await functions().httpsCallable('sendP2P')({
        recipientPhone: recipient.phoneNumber,
        amount: units,
        currency,
        pin: enteredPin,
      });
      Alert.alert(t('common.success'), t('send.done', { amount: show(units), name: recipient.displayName }), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      if (isWrongPin(e)) {
        setPinError(t('errors.wrongPin'));
      } else {
        setStep('amount');
        const message =
          e?.details?.reason === 'recipient_is_merchant'
            ? t('send.recipientIsBusiness', { name: recipient.displayName })
            : t(pinActionErrorKey(e));
        Alert.alert(t('common.error'), message);
      }
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  if (step === 'pin' && recipient) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('payout.pinTitle')}</Text>
        <Text style={styles.sub}>{t('send.pinSubtitle', { amount: show(units), name: recipient.displayName })}</Text>
        <PinInput
          autoFocus
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (pinError) setPinError(null);
          }}
          onComplete={send}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        {busy ? <ActivityIndicator color={colors.ui.text} style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={() => setStep('amount')} disabled={busy} />
        </View>
      </DarkScreen>
    );
  }

  const header = (
    <ScreenHeader
      title={t('send.title')}
      subtitle={t('send.subtitle')}
      onBack={() => (step === 'amount' ? setStep('recipient') : navigation.goBack())}
    />
  );

  if (step === 'amount' && recipient) {
    return (
      <DarkScreen scroll keyboard>
        {header}
        <View style={styles.body}>
          <GlassCard style={styles.recipientCard}>
            <Text style={styles.label}>{t('send.to')}</Text>
            <Text style={styles.recipientName}>{recipient.displayName}</Text>
            <Text style={styles.hint}>{recipient.phoneNumber}</Text>
          </GlassCard>

          <CurrencyToggle value={currency} onChange={pickCurrency} disabled={busy} style={styles.toggle} />
          <Text style={styles.label}>{t('send.amountLabel')}</Text>
          <GlassCard>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(v) => setAmount(sanitizeAmountFor(v, currency))}
              keyboardType={currency === 'SLS' ? 'number-pad' : 'decimal-pad'}
              placeholder={currency === 'SLS' ? '0,000' : '0.00'}
              placeholderTextColor={colors.ui.textFaint}
              autoFocus
            />
          </GlassCard>
          <Text style={styles.hint}>{t('send.available', { amount: show(available) })}</Text>
          {units > available ? <Text style={styles.error}>{t('send.notEnough')}</Text> : null}

          <PillButton style={styles.next} label={t('common.continue')} disabled={!valid} onPress={() => setStep('pin')} />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard>
      {header}
      <View style={styles.body}>
        <Text style={styles.label}>{t('send.numberLabel')}</Text>
        <GlassCard>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(v) => {
              setPhone(v.replace(/[^\d+ ]/g, '').slice(0, 18));
              if (error) setError('');
            }}
            keyboardType="phone-pad"
            placeholder="063 412 3456"
            placeholderTextColor={colors.ui.textFaint}
            autoFocus
          />
        </GlassCard>
        <Text style={styles.hint}>{t('send.numberHint')}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PillButton
          style={styles.next}
          label={t('send.find')}
          onPress={findRecipient}
          loading={busy}
          disabled={busy || !phone.trim()}
        />
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', marginTop: 6 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: colors.ui.error, textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  recipientCard: { padding: 16, marginTop: 8 },
  recipientName: { fontSize: 20, fontWeight: '800', color: colors.ui.text, marginTop: 4 },
  toggle: { marginTop: 20 },
  label: { fontSize: 12, fontWeight: '700', color: colors.ui.textFaint, letterSpacing: 1, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  input: { fontSize: 22, fontWeight: '700', color: colors.ui.text, padding: 16 },
  hint: { fontSize: 12, color: colors.ui.textFaint, marginTop: 8, lineHeight: 17 },
  error: { fontSize: 14, color: colors.ui.error, marginTop: 12 },
  next: { marginTop: 24 },
}));
