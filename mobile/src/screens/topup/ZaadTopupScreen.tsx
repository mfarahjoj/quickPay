import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import firestore from '@react-native-firebase/firestore';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useUserProfile } from '../../hooks/useUserProfile';
import { triggerHaptic } from '../../services/haptics.service';
import {
  LinkResult,
  TopupInstructions,
  amountCents,
  canDialUssd,
  dollars,
  formatLocal,
  getTopupInstructions,
  startNumberLink,
  ussdUrl,
} from '../../services/mobileMoney.service';
import { colors } from '../../theme';

/**
 * Top up from Zaad, through Zapp's collection number.
 *
 *   link     → the customer's Zaad number
 *   activate → send the small activation payment from it; turns green when
 *              Zapp sees it (the profile's linkedAccounts.zaadVerified)
 *   amount   → how much, within the limits
 *   send     → dial the prefilled Zaad code; turns green when the top-up's
 *              transaction appears
 *
 * Android opens the dialer with the code typed in. iOS doesn't let apps dial
 * codes with * or #, so there the code is shown to copy.
 */
type Step = 'link' | 'activate' | 'amount' | 'send' | 'done' | 'error';

const ACCENT = '#FF8A7A';
const INCOMING = '#34C77B';
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function ZaadTopupScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile } = useUserProfile();

  const verified = profile?.linkedAccounts?.zaadVerified === true;
  const linkedNumber = profile?.linkedAccounts?.zaadPhone ?? '';
  const linkOnly = route.params?.mode === 'link';

  const [step, setStep] = useState<Step | null>(null);
  const [numberText, setNumberText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState<LinkResult | null>(null);
  const [instructions, setInstructions] = useState<TopupInstructions | null>(null);
  const [credited, setCredited] = useState<number | null>(null);
  const sentAt = useRef<Date | null>(null);

  // Where to start: once the profile has loaded.
  useEffect(() => {
    if (step !== null || profile === undefined || profile === null) return;
    if (verified && !linkOnly) setStep('amount');
    else setStep('link');
    setNumberText(linkedNumber ? formatLocal(linkedNumber) : '');
  }, [profile, step, verified, linkOnly, linkedNumber]);

  // Activation lands: the server marks the number verified on the profile.
  useEffect(() => {
    if (step === 'activate' && verified) {
      triggerHaptic('success');
      setStep(linkOnly ? 'done' : 'amount');
    }
  }, [step, verified, linkOnly]);

  // The top-up lands: its transaction appears.
  useEffect(() => {
    if (step !== 'send' || !user || !sentAt.current) return;
    const since = firestore.Timestamp.fromDate(new Date(sentAt.current.getTime() - 2 * 60 * 1000));
    return firestore()
      .collection('transactions')
      .where('toUserId', '==', user.uid)
      .where('kind', '==', 'mobile_money_topup')
      .where('createdAt', '>=', since)
      .onSnapshot(
        (snap) => {
          const row = snap.docs.map((d) => d.data()).find((d) => d.status === 'completed');
          if (row) {
            setCredited(row.amount as number);
            triggerHaptic('success');
            setStep('done');
          }
        },
        () => undefined // a listener error leaves the waiting screen; the push still arrives
      );
  }, [step, user]);

  const fail = (e: any) => {
    setError(e?.message || t('common.error'));
    setStep('error');
  };

  const submitNumber = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await startNumberLink('zaad', numberText);
      setLink(result);
      triggerHaptic('medium');
      setStep(result.status === 'verified' ? (linkOnly ? 'done' : 'amount') : 'activate');
    } catch (e: any) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [busy, numberText, linkOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitAmount = useCallback(async () => {
    const cents = amountCents(amountText);
    if (!cents || busy) return;
    setBusy(true);
    try {
      const result = await getTopupInstructions('zaad', cents);
      setInstructions(result);
      sentAt.current = new Date();
      triggerHaptic('medium');
      setStep('send');
    } catch (e: any) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [amountText, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const pressKey = (key: string) => {
    triggerHaptic('light');
    if (key === '⌫') return setAmountText((p) => p.slice(0, -1));
    if (key === '.' && amountText.includes('.')) return;
    if (/\.\d{2}$/.test(amountText)) return;
    setAmountText((p) => p + key);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('topup.zaad.title')}</Text>
          <Text style={styles.headerSub}>{t('topup.zaad.subtitle')}</Text>
        </View>
      </View>

      {step === null && <ActivityIndicator color={ACCENT} style={styles.loading} />}

      {step === 'link' && (
        <View style={styles.body}>
          <Text style={styles.label}>{t('topup.zaad.yourNumber')}</Text>
          <TextInput
            value={numberText}
            onChangeText={setNumberText}
            placeholder="063 412 3456"
            placeholderTextColor="rgba(255,255,255,0.25)"
            keyboardType="phone-pad"
            style={styles.input}
            autoFocus
          />
          <Text style={styles.hint}>{t('topup.zaad.linkHint')}</Text>
          <Primary label={t('topup.zaad.linkButton')} onPress={submitNumber} busy={busy} disabled={numberText.length < 9} />
        </View>
      )}

      {step === 'activate' && link && (
        <View style={styles.body}>
          <Text style={styles.big}>{t('topup.zaad.activateTitle', { amount: dollars(link.activationCents) })}</Text>
          <Text style={styles.hint}>
            {t('topup.zaad.activateBody', {
              amount: dollars(link.activationCents),
              from: formatLocal(link.msisdn),
              to: formatLocal(link.collectionNumber),
            })}
          </Text>
          <DialPanel code={link.dialCode} />
          <Waiting text={t('topup.zaad.waitingActivation')} />
        </View>
      )}

      {step === 'amount' && (
        <View style={styles.body}>
          <Text style={styles.amount}>${amountText || '0'}</Text>
          <Text style={styles.hint}>
            {t('topup.zaad.fromNumber', { number: formatLocal(linkedNumber || link?.msisdn || '') })}
          </Text>
          <View style={styles.keypad}>
            {KEYPAD.map((k) => (
              <TouchableOpacity key={k} style={styles.key} onPress={() => pressKey(k)}>
                <Text style={styles.keyText}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Primary label={t('topup.zaad.continue')} onPress={submitAmount} busy={busy} disabled={!amountCents(amountText)} />
          <TouchableOpacity onPress={() => setStep('link')}>
            <Text style={styles.link}>{t('topup.zaad.changeNumber')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'send' && instructions && (
        <View style={styles.body}>
          <Text style={styles.big}>{t('topup.zaad.sendTitle', { amount: dollars(instructions.amountCents) })}</Text>
          <Text style={styles.hint}>
            {t('topup.zaad.sendBody', {
              amount: dollars(instructions.amountCents),
              from: formatLocal(instructions.fromMsisdn),
              to: formatLocal(instructions.collectionNumber),
            })}
          </Text>
          <DialPanel code={instructions.dialCode} />
          <Waiting text={t('topup.zaad.waitingTopup')} />
        </View>
      )}

      {step === 'done' && (
        <View style={[styles.body, styles.center]}>
          <Text style={[styles.big, { color: INCOMING }]}>
            {credited !== null ? t('topup.zaad.doneTopup', { amount: dollars(credited) }) : t('topup.zaad.doneLinked')}
          </Text>
          <Primary label={t('common.done')} onPress={() => navigation.goBack()} />
        </View>
      )}

      {step === 'error' && (
        <View style={[styles.body, styles.center]}>
          <Text style={styles.errorText}>{error}</Text>
          <Primary label={t('common.tryAgain')} onPress={() => setStep(verified && !linkOnly ? 'amount' : 'link')} />
        </View>
      )}
    </View>
  );
}

function Primary({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.primary, (disabled || busy) && styles.primaryDisabled]}
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.85}
    >
      {busy ? <ActivityIndicator color="#0D0B0A" /> : <Text style={styles.primaryText}>{label}</Text>}
    </TouchableOpacity>
  );
}

/** The Zaad code: dial it on Android, copy it on iOS (which can't dial USSD). */
function DialPanel({ code }: { code: string | null }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!code) return <Text style={styles.hint}>{t('topup.zaad.noCode')}</Text>;
  const dial = canDialUssd(Platform.OS);
  return (
    <View style={styles.dialBox}>
      <Text style={styles.code} selectable>{code}</Text>
      {dial ? (
        <Primary label={t('topup.zaad.dial')} onPress={() => Linking.openURL(ussdUrl(code)).catch(() => undefined)} />
      ) : (
        <>
          <Primary
            label={copied ? t('topup.zaad.copied') : t('topup.zaad.copyCode')}
            onPress={() => {
              Clipboard.setString(code);
              setCopied(true);
              triggerHaptic('light');
            }}
          />
          <Text style={styles.hint}>{t('topup.zaad.iosHint')}</Text>
        </>
      )}
    </View>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <View style={styles.waiting}>
      <ActivityIndicator color={ACCENT} />
      <Text style={styles.waitingText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  headerText: { flex: 1 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  backArrow: { fontSize: 24, color: '#FFFFFF', lineHeight: 28 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  loading: { marginTop: 80 },
  body: { paddingHorizontal: 20, paddingTop: 12, gap: 14 },
  center: { alignItems: 'stretch', marginTop: 60 },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.55)' },
  input: {
    fontSize: 24, fontWeight: '700', color: '#FFFFFF', paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  hint: { fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 20 },
  big: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', lineHeight: 28 },
  amount: { fontSize: 48, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', marginTop: 8 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  key: {
    width: '31%', paddingVertical: 16, borderRadius: 14, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  keyText: { fontSize: 24, color: '#FFFFFF', fontWeight: '600' },
  primary: { backgroundColor: ACCENT, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { fontSize: 17, fontWeight: '800', color: '#0D0B0A' },
  dialBox: {
    gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  code: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', letterSpacing: 1 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  waitingText: { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 20 },
  link: { fontSize: 14, color: ACCENT, textAlign: 'center', paddingVertical: 8 },
  errorText: { fontSize: 16, color: '#FFFFFF', textAlign: 'center', lineHeight: 22 },
});
