/**
 * Buy float with Zaad.
 *
 * The agent sends Zaad from their own, verified number to Zapp's collection
 * number. The phone holding that SIM forwards Telesom's SMS to Zapp, which
 * matches the sender and puts the money in the agent's float
 * (functions/src/mobileMoney/receipts.ts). No Zaad API is involved, and no
 * one at Zapp has to approve it.
 *
 *   link     → the agent's Zaad number
 *   activate → send the small activation payment from it; done when Zapp sees it
 *   amount   → how much float to buy, in shillings or dollars: each buys
 *              float in its own currency, never converted (SHILLINGS.md)
 *   send     → dial the prefilled Zaad code; done when the float arrives
 *
 * Android opens the dialer with the code typed in. iOS won't let apps dial
 * codes with * or #, so there the code is shown to type.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { firestore, functions } from '../../services/firebase.config';
import { useAuth } from '../../hooks/useAuth';
import { CurrencyToggle, DarkScreen, ScreenHeader, GlassCard, PillButton, type FloatCurrency } from '../../components';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { formatAmount, formatCents, sanitizeAmountFor, toAmount } from '../../utils/money';
import { formatLocal, normaliseSomaliMsisdn } from '../../utils/zaad';
import { callableErrorKey } from '../../utils/errors';
import { AmountInput } from '../../components/AmountInput';
import { makeStyles, useColors } from '../../theme';

type Step = 'loading' | 'link' | 'activate' | 'amount' | 'send' | 'done';

interface Profile {
  linkedAccounts?: { zaadPhone?: string; zaadVerified?: boolean };
  zaad?: { msisdn?: string };
  phoneNumber?: string;
}

interface Pending {
  collectionNumber: string;
  dialCode: string | null;
  /** In [currency]'s smallest unit: cents, or whole shillings. */
  amountCents: number;
  currency: FloatCurrency;
}

const ussdUrl = (code: string) => `tel:${code.replace(/#/g, '%23')}`;

export default function BuyFloatZaadScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [numberText, setNumberText] = useState('');
  const [currency, setCurrency] = useState<FloatCurrency>('USD');
  const [amount, setAmount] = useState('');
  const [limits, setLimits] = useState<{ min: number; max: number } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [credited, setCredited] = useState<{ amount: number; currency: unknown }>({ amount: 0, currency: 'USD' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sentAt = useRef<Date | null>(null);

  const verified = profile?.linkedAccounts?.zaadVerified === true;

  // The profile says whether the number is linked, and turns verified live.
  useEffect(() => {
    if (!user) return;
    return firestore()
      .collection('users')
      .doc(user.uid)
      .onSnapshot(
        (snap) => setProfile((snap.data() as Profile) ?? {}),
        () => setProfile({}),
      );
  }, [user]);

  // Where to start, once the profile is in.
  useEffect(() => {
    if (step !== 'loading' || profile === null) return;
    const offered = profile.linkedAccounts?.zaadPhone || profile.zaad?.msisdn || '';
    setNumberText(offered ? formatLocal(offered) : '');
    setStep(verified ? 'amount' : 'link');
  }, [profile, step, verified]);

  // The activation payment lands.
  useEffect(() => {
    if (step === 'activate' && verified) setStep('amount');
  }, [step, verified]);

  // The float lands: its transaction appears.
  useEffect(() => {
    if (step !== 'send' || !user || !sentAt.current) return;
    const since = firestore.Timestamp.fromDate(new Date(sentAt.current.getTime() - 2 * 60 * 1000));
    return firestore()
      .collection('transactions')
      .where('toUserId', '==', user.uid)
      .where('kind', '==', 'float')
      .where('createdAt', '>=', since)
      .onSnapshot(
        (snap) => {
          const row = snap.docs
            .map((d) => d.data())
            // Not the activation payment, which can land minutes before.
            .find((d) => d.fromUserId === 'zaad' && d.status === 'completed' && !/linked$/.test(d.description ?? ''));
          if (row) {
            setCredited({ amount: row.amount as number, currency: row.currency });
            setStep('done');
          }
        },
        () => undefined, // the push notification still arrives
      );
  }, [step, user]);

  // The server sends the range in the currency asked for.
  const fail = (e: any) => setError(t(e?.details?.reason === 'amount_out_of_range' ? 'buyFloat.outOfRange' : callableErrorKey(e), {
    min: formatAmount(e?.details?.minCents ?? 0, e?.details?.currency),
    max: formatAmount(e?.details?.maxCents ?? 0, e?.details?.currency),
  }));

  const link = async () => {
    const msisdn = normaliseSomaliMsisdn(numberText);
    if (!msisdn) {
      setError(t('zaadAccount.invalidNumber'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await functions().httpsCallable('startNumberLink')({ provider: 'zaad', msisdn });
      const data = (res.data as any).data;
      setLimits({ min: data.topupMinCents, max: data.topupMaxCents });
      if (data.status === 'verified') {
        setStep('amount');
      } else {
        // Activation is always in dollars.
        setPending({ collectionNumber: data.collectionNumber, dialCode: data.dialCode, amountCents: data.activationCents, currency: 'USD' });
        setStep('activate');
      }
    } catch (e: any) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    const cents = toAmount(amount, currency);
    if (cents <= 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await functions().httpsCallable('getTopupInstructions')({ provider: 'zaad', amountCents: cents, currency });
      const data = (res.data as any).data;
      setPending({ collectionNumber: data.collectionNumber, dialCode: data.dialCode, amountCents: cents, currency });
      sentAt.current = new Date();
      setStep('send');
    } catch (e: any) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const dial = () => {
    if (pending?.dialCode && Platform.OS === 'android') {
      Linking.openURL(ussdUrl(pending.dialCode)).catch(() => undefined);
    }
  };

  const header = <ScreenHeader title={t('buyFloat.title')} subtitle={t('buyFloat.subtitle')} onBack={() => navigation.goBack()} />;

  if (step === 'loading') {
    return (
      <DarkScreen contentStyle={styles.centered}>
        <ActivityIndicator color={colors.ui.text} />
      </DarkScreen>
    );
  }

  if (step === 'done') {
    return (
      <DarkScreen contentStyle={styles.centered}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.bigTitle}>{t('buyFloat.doneTitle')}</Text>
        <Text style={styles.bigAmount}>{formatAmount(credited.amount, credited.currency)}</Text>
        <Text style={styles.sub}>{t('buyFloat.doneHint')}</Text>
        <View style={styles.block}>
          <PillButton label={t('common.done')} onPress={() => navigation.goBack()} />
        </View>
      </DarkScreen>
    );
  }

  // activate and send: dial a code, then wait for Zapp to see the money.
  if ((step === 'activate' || step === 'send') && pending) {
    const activating = step === 'activate';
    return (
      <DarkScreen scroll contentStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <Text style={styles.sub}>
            {t(activating ? 'buyFloat.activateHint' : 'buyFloat.sendHint', {
              amount: formatAmount(pending.amountCents, pending.currency),
              from: numberText,
              to: formatLocal(pending.collectionNumber),
            })}
          </Text>
          {pending.dialCode ? (
            <GlassCard style={styles.codeCard}>
              <Text style={styles.label}>{t('buyFloat.dialLabel')}</Text>
              <Text style={styles.code} selectable>{pending.dialCode}</Text>
            </GlassCard>
          ) : null}
          {Platform.OS === 'android' && pending.dialCode ? (
            <PillButton label={t('buyFloat.dial')} onPress={dial} />
          ) : (
            <Text style={styles.hint}>{t('buyFloat.typeIt')}</Text>
          )}
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.ui.text} />
            <Text style={styles.hint}>{t(activating ? 'buyFloat.waitingActivation' : 'buyFloat.waiting')}</Text>
          </View>
          <Text style={styles.hint}>{t('buyFloat.slowHint')}</Text>
        </View>
      </DarkScreen>
    );
  }

  if (step === 'amount') {
    const cents = toAmount(amount, currency);
    const pickCurrency = (next: FloatCurrency) => {
      if (next === currency) return;
      setCurrency(next);
      setAmount('');
      setError('');
    };
    return (
      <DarkScreen scroll keyboard contentStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <CurrencyToggle value={currency} onChange={pickCurrency} disabled={busy} />
          <Text style={styles.label}>{t('buyFloat.amountLabel')}</Text>
          <GlassCard style={styles.inputCard}>
            <AmountInput
              style={styles.amountInput}
              value={amount}
              onChangeText={(v) => setAmount(sanitizeAmountFor(v, currency))}
              keyboardType={currency === 'SLS' ? 'number-pad' : 'decimal-pad'}
              placeholder={currency === 'SLS' ? '0,000' : '0.00'}
              placeholderTextColor={colors.ui.ink(0.25)}
              autoFocus
            />
          </GlassCard>
          {/* The limits are set in dollars; a shilling amount outside them is
              told its range in shillings when it's checked. */}
          {limits && currency === 'USD' ? (
            <Text style={styles.hint}>{t('buyFloat.limits', { min: formatCents(limits.min), max: formatCents(limits.max) })}</Text>
          ) : null}
          <Text style={styles.hint}>
            {t('buyFloat.fromNumber', { number: formatLocal(profile?.linkedAccounts?.zaadPhone ?? '') })}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PillButton label={t('buyFloat.continue')} onPress={prepare} loading={busy} disabled={cents <= 0 || busy} />
        </View>
      </DarkScreen>
    );
  }

  // link
  return (
    <DarkScreen scroll keyboard contentStyle={styles.content}>
      {header}
      <View style={styles.body}>
        <Text style={styles.sub}>{t('buyFloat.linkHint')}</Text>
        <Text style={styles.label}>{t('zaadAccount.numberLabel')}</Text>
        <GlassCard style={styles.inputCard}>
          <TextInput
            style={styles.numberInput}
            value={numberText}
            onChangeText={(v) => setNumberText(v.replace(/[^\d+ ]/g, '').slice(0, 16))}
            keyboardType="phone-pad"
            placeholder="063 412 3456"
            placeholderTextColor={colors.ui.ink(0.25)}
          />
        </GlassCard>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PillButton label={t('buyFloat.link')} onPress={link} loading={busy} disabled={busy || !numberText.trim()} />
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  body: { paddingHorizontal: 24, gap: 16 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, textAlign: 'center', marginTop: 20 },
  bigAmount: { fontSize: 44, fontWeight: '800', color: colors.ui.incoming, letterSpacing: -2, marginTop: 8 },
  sub: { fontSize: 15, lineHeight: 22, color: colors.ui.textDim, textAlign: 'center' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ui.textFaint },
  hint: { fontSize: 13, lineHeight: 19, color: colors.ui.textFaint, textAlign: 'center' },
  error: { fontSize: 14, color: colors.ui.error, textAlign: 'center' },
  inputCard: { height: 64, justifyContent: 'center', paddingHorizontal: 20 },
  amountInput: { fontSize: 32, fontWeight: '800', color: colors.ui.text },
  numberInput: { fontSize: 22, fontWeight: '700', color: colors.ui.text },
  codeCard: { padding: 18, alignItems: 'center', gap: 8 },
  code: { fontSize: 22, fontWeight: '800', color: colors.ui.text, letterSpacing: 1 },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 },
  block: { alignSelf: 'stretch', marginTop: 28 },
}));
