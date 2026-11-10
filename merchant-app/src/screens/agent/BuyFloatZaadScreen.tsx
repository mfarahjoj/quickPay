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
 *   amount   → how much float to buy
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
import { DarkScreen, ScreenHeader, GlassCard, PillButton, TEXT_DIM, TEXT_FAINT } from '../../components';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { formatCents, toCents, sanitizeAmountInput } from '../../utils/money';
import { formatLocal, normaliseSomaliMsisdn } from '../../utils/zaad';
import { callableErrorKey } from '../../utils/errors';

type Step = 'loading' | 'link' | 'activate' | 'amount' | 'send' | 'done';

interface Profile {
  linkedAccounts?: { zaadPhone?: string; zaadVerified?: boolean };
  zaad?: { msisdn?: string };
  phoneNumber?: string;
}

interface Pending {
  collectionNumber: string;
  dialCode: string | null;
  amountCents: number;
}

const ussdUrl = (code: string) => `tel:${code.replace(/#/g, '%23')}`;

export default function BuyFloatZaadScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [numberText, setNumberText] = useState('');
  const [amount, setAmount] = useState('');
  const [limits, setLimits] = useState<{ min: number; max: number } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [credited, setCredited] = useState(0);
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
            setCredited(row.amount as number);
            setStep('done');
          }
        },
        () => undefined, // the push notification still arrives
      );
  }, [step, user]);

  const fail = (e: any) => setError(t(e?.details?.reason === 'amount_out_of_range' ? 'buyFloat.outOfRange' : callableErrorKey(e), {
    min: formatCents(e?.details?.minCents ?? 0),
    max: formatCents(e?.details?.maxCents ?? 0),
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
        setPending({ collectionNumber: data.collectionNumber, dialCode: data.dialCode, amountCents: data.activationCents });
        setStep('activate');
      }
    } catch (e: any) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    const cents = toCents(amount);
    if (cents <= 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await functions().httpsCallable('getTopupInstructions')({ provider: 'zaad', amountCents: cents });
      const data = (res.data as any).data;
      setPending({ collectionNumber: data.collectionNumber, dialCode: data.dialCode, amountCents: cents });
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
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <ActivityIndicator color="#FFFFFF" />
      </DarkScreen>
    );
  }

  if (step === 'done') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.bigTitle}>{t('buyFloat.doneTitle')}</Text>
        <Text style={styles.bigAmount}>{formatCents(credited)}</Text>
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
      <DarkScreen edges={[]} scroll contentStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <Text style={styles.sub}>
            {t(activating ? 'buyFloat.activateHint' : 'buyFloat.sendHint', {
              amount: formatCents(pending.amountCents),
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
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.hint}>{t(activating ? 'buyFloat.waitingActivation' : 'buyFloat.waiting')}</Text>
          </View>
          <Text style={styles.hint}>{t('buyFloat.slowHint')}</Text>
        </View>
      </DarkScreen>
    );
  }

  if (step === 'amount') {
    const cents = toCents(amount);
    return (
      <DarkScreen edges={[]} scroll keyboard contentStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <Text style={styles.label}>{t('buyFloat.amountLabel')}</Text>
          <GlassCard style={styles.inputCard}>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={(v) => setAmount(sanitizeAmountInput(v))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="rgba(255,255,255,0.25)"
              autoFocus
            />
          </GlassCard>
          {limits ? (
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
    <DarkScreen edges={[]} scroll keyboard contentStyle={styles.content}>
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
            placeholderTextColor="rgba(255,255,255,0.25)"
          />
        </GlassCard>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PillButton label={t('buyFloat.link')} onPress={link} loading={busy} disabled={busy || !numberText.trim()} />
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  body: { paddingHorizontal: 24, gap: 16 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', marginTop: 20 },
  bigAmount: { fontSize: 44, fontWeight: '800', color: '#34C77B', letterSpacing: -2, marginTop: 8 },
  sub: { fontSize: 15, lineHeight: 22, color: TEXT_DIM, textAlign: 'center' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  hint: { fontSize: 13, lineHeight: 19, color: TEXT_FAINT, textAlign: 'center' },
  error: { fontSize: 14, color: '#FF6961', textAlign: 'center' },
  inputCard: { height: 64, justifyContent: 'center', paddingHorizontal: 20 },
  amountInput: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  numberInput: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  codeCard: { padding: 18, alignItems: 'center', gap: 8 },
  code: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1 },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 },
  block: { alignSelf: 'stretch', marginTop: 28 },
});
