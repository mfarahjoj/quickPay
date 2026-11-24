import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { cooldownMessage } from '../../utils/cooldownMessage';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Share,
  Alert,
  ActivityIndicator,
  AppState,
  useWindowDimensions,
  type AppStateStatus,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
} from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { Button, PinInput } from '../../components';
import { typography, spacing, borderRadius, makeStyles, useColors } from '../../theme';
import { PHONE_PREFIX } from '../../config/constants';
import { Springs } from '../../constants/springs';
import { SuccessCheckIcon, QrCodeIcon, LockIcon, ChevronLeftIcon } from '../../components/icons/AuthIcons';
import { formatCountdown } from '../../utils/time';
import { triggerHaptic } from '../../services/haptics.service';
import { functions } from '../../services/firebase.config';
import {
  TokenResponse,
  BACKOFF_SECONDS_ON_FAILURE,
  isReceiveTokenPermissionError,
  readCachedReceiveToken,
  receiveQrErrorKey,
  resolveReceiveToken,
  secondsLeftFromToken,
} from '../../services/customerToken.service';
import type { PaymentLink } from '../../services/paymentLink.service';
import { useWallet } from '../../hooks/useWallet';
import { useHomeCurrency } from '../../hooks/useHomeCurrency';
import { useTransactions } from '../../hooks/useTransactions';
import { useAuth } from '../../hooks/useAuth';
import { useUserProfile } from '../../hooks/useUserProfile';
import { inviteMessage, offerInvite } from '../../utils/invite';
import { formatLocal } from '../../services/mobileMoney.utils';
import { PersonIcon } from '../../components/icons/LineIcons';
import { useBiometricApproval } from '../../hooks/useBiometricApproval';
import { isCompleteLocalNumber, personInitials, recentPeople } from '../../utils/recentPeople';
import { pressAmountKey, type AmountKey } from '../../utils/amountKeypad';
import {
  amountInputLabel,
  amountInputUnits,
  balanceIn,
  formatMoney,
  otherCurrency,
  type Currency,
} from '../../utils/money';

type PaymentTab = 'send' | 'receive';
// Review and PIN are one step: the summary sits above the PIN (or Face ID).
type SendStep = 'phone' | 'amount' | 'confirm' | 'success';

/** Steps the progress bar counts; success fills it. */
const SEND_STEPS = ['phone', 'amount', 'confirm'] as const;

/** Max automatic generateCustomerToken calls per Receive visit (initial load + expiry renewals). Manual actions are unlimited. */
const MAX_RECEIVE_AUTO_FETCHES = 4;

interface RecipientInfo {
  /** Masked by the server ("Amina Y."), so it is safe to show and share. */
  fullName: string;
  phoneNumber: string;
}

/** What `lookupRecipient` answers. */
type LookupResult =
  | { found: false; reason: 'not_found' | 'self' }
  | { found: true; phoneNumber: string; displayName: string; isBusiness: boolean };

interface Props {
  route?: {
    params?: {
      mode?: PaymentTab;
      prefill?: PaymentLink;
      /** From ContactPicker; `at` makes picking the same person twice run again. */
      pickedContact?: { name: string; phone: string; at: number };
    };
  };
}

export default function PaymentsScreen({ route }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const initialMode = route?.params?.mode === 'receive' ? 'receive' : 'send';
  const [tab, setTab] = useState<PaymentTab>(initialMode);
  /** Set when a zapppay:// link started this payment; drives the "check before paying" notice. */
  const [fromLink, setFromLink] = useState(false);

  const [step, setStep] = useState<SendStep>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [recipient, setRecipient] = useState<RecipientInfo | null>(null);
  const [amountText, setAmountText] = useState('');
  // Dollars or shillings. Starts on the currency Home shows; a payment link
  // sets its own (dollars unless it says SLSH). Never converted: it comes out
  // of that balance.
  const { wallet } = useWallet();
  const { currency: homeCurrency } = useHomeCurrency(wallet?.balanceCents ?? 0, wallet?.slsBalance ?? 0);
  const [pickedCurrency, setPickedCurrency] = useState<Currency | null>(null);
  const currency = pickedCurrency ?? homeCurrency;
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [sending, setSending] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  /** Face ID is on, but the person chose to type the PIN this time. */
  const [usePin, setUsePin] = useState(false);
  const biometric = useBiometricApproval();

  // People already paid or paid by, for one-tap picks above the number field.
  const { user } = useAuth();
  // For the referral code in an invite to someone not on Zapp Pay yet.
  const { profile } = useUserProfile();
  // On narrower phones the Contacts button is just its icon, so the number has room.
  const contactsLabel = useWindowDimensions().width >= 410;
  const { transactions: history } = useTransactions(undefined, 30);
  const recents = useMemo(
    () => recentPeople(history, 8, user?.phoneNumber),
    [history, user?.phoneNumber]
  );
  /** The last number looked up on its own, so an edit can't loop the lookup. */
  const autoLookedUp = useRef<string | null>(null);

  // Amount input pulse
  const amountScale = useSharedValue(1);
  const amountAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: amountScale.value }],
  }));

  // P2P success animations
  const successRingScale = useSharedValue(0.8);
  const successRingOpacity = useSharedValue(0);
  const successTitleOp = useSharedValue(0);
  const successTitleY = useSharedValue(12);
  const successAmountOp = useSharedValue(0);
  const successBtnsOp = useSharedValue(0);

  const successRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successRingScale.value }],
    opacity: successRingOpacity.value,
  }));
  const successTitleStyle = useAnimatedStyle(() => ({
    opacity: successTitleOp.value,
    transform: [{ translateY: successTitleY.value }],
  }));
  const successAmountStyle = useAnimatedStyle(() => ({ opacity: successAmountOp.value }));
  const successBtnsStyle = useAnimatedStyle(() => ({ opacity: successBtnsOp.value }));

  // Real customer token QR for the Receive tab
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [receiveCapReached, setReceiveCapReached] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  /** Prevents overlapping generateCustomerToken calls (timer + tab + retry). */
  const tokenFetchInFlightRef = useRef(false);
  /** Slots for budgeted fetches; reset when leaving Receive. */
  const receiveAutoFetchRemainingRef = useRef(MAX_RECEIVE_AUTO_FETCHES);
  /** Set when the server refused for good (e.g. a merchant account): stop asking. */
  const receiveAutoSkipCloudRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const clearReceiveTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchToken = useCallback(async (opts?: { silent?: boolean; useBudget?: boolean; forceRefresh?: boolean }) => {
    if (tokenFetchInFlightRef.current) return;
    const forceRefresh = opts?.forceRefresh === true;
    if (forceRefresh) {
      receiveAutoSkipCloudRef.current = false;
    }
    let budgetConsumed = false;
    tokenFetchInFlightRef.current = true;
    try {
      setTokenLoading(true);
      setTokenError(null);

      if (opts?.useBudget) {
        if (!forceRefresh) {
          const cached = await readCachedReceiveToken();
          if (cached) {
            if (!mountedRef.current) return;
            receiveAutoSkipCloudRef.current = false;
            setToken(cached);
            setSecondsLeft(secondsLeftFromToken(cached));
            if (!opts?.silent) triggerHaptic('success');
            return;
          }
        }
        if (receiveAutoFetchRemainingRef.current <= 0) {
          setReceiveCapReached(true);
          return;
        }
        receiveAutoFetchRemainingRef.current -= 1;
        budgetConsumed = true;
      }

      const data = await resolveReceiveToken({ forceRefresh });
      if (!mountedRef.current) return;
      receiveAutoSkipCloudRef.current = false;
      setToken(data);
      setSecondsLeft(secondsLeftFromToken(data));
      if (!opts?.silent) triggerHaptic('success');
    } catch (e: any) {
      // The call failed, so it didn't use up an automatic refresh.
      if (budgetConsumed) {
        receiveAutoFetchRemainingRef.current += 1;
      }
      if (!mountedRef.current) return;
      // No stand-in QR: nothing can scan one, so it would only look like it works.
      // A silent refresh only runs once the old code has run out, so either
      // way there's no code left to show.
      if (isReceiveTokenPermissionError(e)) receiveAutoSkipCloudRef.current = true;
      setToken(null);
      setTokenError(t(receiveQrErrorKey(e)));
      if (opts?.silent) setSecondsLeft(BACKOFF_SECONDS_ON_FAILURE);
    } finally {
      tokenFetchInFlightRef.current = false;
      if (mountedRef.current) setTokenLoading(false);
    }
  }, [t]);

  // Initial load when switching to Receive — budgeted; leaving Receive resets the 4-call cap.
  useEffect(() => {
    if (tab !== 'receive') {
      receiveAutoFetchRemainingRef.current = MAX_RECEIVE_AUTO_FETCHES;
      receiveAutoSkipCloudRef.current = false;
      setReceiveCapReached(false);
      return;
    }
    receiveAutoFetchRemainingRef.current = MAX_RECEIVE_AUTO_FETCHES;
    setReceiveCapReached(false);
    fetchToken({ useBudget: true });
  }, [tab, fetchToken]);

  // Countdown only on Receive tab while app is active (no fetch inside setState updater).
  useEffect(() => {
    if (tab !== 'receive' || !token) {
      clearReceiveTimer();
      return;
    }
    clearReceiveTimer();
    timerRef.current = setInterval(() => {
      if (appStateRef.current !== 'active') return;
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return clearReceiveTimer;
  }, [tab, token, clearReceiveTimer]);

  useEffect(() => {
    if (tab !== 'receive' || !token || secondsLeft > 0) return;
    if (tokenLoading || tokenFetchInFlightRef.current) return;
    if (receiveAutoSkipCloudRef.current) {
      clearReceiveTimer();
      return;
    }
    if (receiveAutoFetchRemainingRef.current <= 0) {
      setReceiveCapReached(true);
      clearReceiveTimer();
      return;
    }
    clearReceiveTimer();
    fetchToken({ silent: true, useBudget: true });
  }, [tab, token, secondsLeft, tokenLoading, fetchToken, clearReceiveTimer]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!amountText) return;
    amountScale.value = withSequence(
      withSpring(1.08, Springs.feedback),
      withSpring(1, { damping: 18, stiffness: 200 }),
    );
  }, [amountText, amountScale]);

  useEffect(() => {
    if (step !== 'success') return;
    successRingScale.value = withSpring(2.2, Springs.celebration);
    successRingOpacity.value = withSequence(
      withTiming(0.35, { duration: 60 }),
      withTiming(0, { duration: 680 }),
    );
    successTitleOp.value = withDelay(300, withTiming(1, { duration: 280 }));
    successTitleY.value = withDelay(300, withSpring(0, Springs.transition));
    successAmountOp.value = withDelay(440, withTiming(1, { duration: 240 }));
    successBtnsOp.value = withDelay(580, withTiming(1, { duration: 200 }));
  }, [step, successRingScale, successRingOpacity, successTitleOp, successTitleY, successAmountOp, successBtnsOp]);

  /** Cents or whole shillings: what `sendP2P` takes. */
  const amountUnits = amountInputUnits(amountText, currency);
  const amountLabel = formatMoney(amountUnits, currency);

  const appendDigit = (digit: string) => {
    // Shillings have no smaller unit, so no decimal point.
    if (digit === '.' && currency === 'SLS') return;
    const next = pressAmountKey(amountText, digit as AmountKey);
    if (next === amountText) return;
    triggerHaptic('light');
    setAmountText(next);
  };

  const switchSendCurrency = () => {
    triggerHaptic('light');
    setPickedCurrency(otherCurrency(currency));
    // "4.70" dollars is not 4.70 shillings: start the amount again.
    setAmountText('');
  };

  const backspace = () => {
    triggerHaptic('light');
    setAmountText((prev) => prev.slice(0, -1));
  };

  const resetSend = () => {
    setStep('phone');
    setPhoneInput('');
    setRecipient(null);
    setAmountText('');
    setPickedCurrency(null);
    setNote('');
    setPin('');
    setSending(false);
    setTransactionId(null);
    setFromLink(false);
    setUsePin(false);
    autoLookedUp.current = null;
  };

  const fullPhone = phoneInput.startsWith('+') ? phoneInput : `${PHONE_PREFIX}${phoneInput}`;

  /**
   * `phoneOverride` lets a payment link or a picked contact look up before the
   * input state has updated; `contact` names the person if they need inviting.
   */
  const handleLookup = async (phoneOverride?: string, contact?: { name: string }) => {
    const input = (phoneOverride ?? phoneInput).trim();
    if (!input) {
      Alert.alert(t('common.error'), t('payments.enterPhoneError'));
      return;
    }
    const phoneNumber = input.startsWith('+') ? input : `${PHONE_PREFIX}${input}`;
    try {
      setLookingUp(true);
      // lookupUserByPhone is for agents and merchants and refuses customers;
      // this one answers anyone, with a masked name.
      const lookupFn = functions().httpsCallable('lookupRecipient');
      const result = await lookupFn({ phoneNumber });
      const data = result.data as { success: boolean; data?: LookupResult };
      const found = data.data;
      if (!data.success || !found || !found.found) {
        if (found && !found.found && found.reason === 'not_found') {
          // Not on Zapp Pay yet: invite them rather than stop at "not found".
          offerInvite(
            t,
            { name: contact?.name ?? formatLocal(phoneNumber), phone: phoneNumber },
            inviteMessage(t, profile?.referralCode)
          );
        } else {
          Alert.alert(
            t('common.notFound'),
            found && !found.found && found.reason === 'self'
              ? t('payments.cannotSendToSelf')
              : t('payments.userNotFound')
          );
        }
        return;
      }
      // A shop is paid by its QR; sendP2P would refuse the transfer anyway.
      if (found.isBusiness) {
        Alert.alert(found.displayName, t('payments.recipientIsBusiness'));
        return;
      }
      setRecipient({ fullName: found.displayName, phoneNumber: found.phoneNumber });
      setStep('amount');
    } catch (err: any) {
      Alert.alert(
        t('common.error'),
        err?.details?.reason === 'lookup_limit'
          ? t('payments.lookupLimit')
          : t('payments.lookupFailed')
      );
    } finally {
      setLookingUp(false);
    }
  };

  // A payment link pre-fills recipient, amount and note, then runs the same
  // lookup a typed number would. Review and PIN are still the payer's to do.
  const prefill = route?.params?.prefill;
  const lookupRef = useRef(handleLookup);
  lookupRef.current = handleLookup;
  useEffect(() => {
    if (!prefill) return;
    setTab('send');
    resetSend();
    setFromLink(true);
    // The link's own currency; links from before shillings are dollars.
    setPickedCurrency(prefill.currency ?? 'USD');
    const local = prefill.to.startsWith(PHONE_PREFIX) ? prefill.to.slice(PHONE_PREFIX.length) : prefill.to;
    // Looked up just below; the typed-number lookup mustn't run it again.
    autoLookedUp.current = local;
    setPhoneInput(local);
    setAmountText(prefill.amount ?? '');
    setNote(prefill.note ?? '');
    void lookupRef.current(prefill.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // A contact picked from the phone's contacts: the lookup a typed number gets.
  const picked = route?.params?.pickedContact;
  useEffect(() => {
    if (!picked?.phone) return;
    setTab('send');
    resetSend();
    const local = picked.phone.startsWith(PHONE_PREFIX) ? picked.phone.slice(PHONE_PREFIX.length) : picked.phone;
    // Looked up just below; the typed-number lookup mustn't run it again.
    autoLookedUp.current = local;
    setPhoneInput(local);
    void lookupRef.current(picked.phone, { name: picked.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.at]);

  // The ninth digit of a local number looks the person up: no Continue tap.
  useEffect(() => {
    if (tab !== 'send' || step !== 'phone' || lookingUp) return;
    const typed = phoneInput.replace(/\s+/g, '');
    if (!isCompleteLocalNumber(typed) || autoLookedUp.current === typed) return;
    autoLookedUp.current = typed;
    lookupRef.current(typed);
  }, [tab, step, phoneInput, lookingUp]);

  const pickRecent = (phoneNumber: string) => {
    if (lookingUp) return;
    triggerHaptic('light');
    const local = phoneNumber.startsWith(PHONE_PREFIX) ? phoneNumber.slice(PHONE_PREFIX.length) : phoneNumber;
    autoLookedUp.current = local;
    setPhoneInput(local);
    handleLookup(phoneNumber);
  };

  const goToConfirm = () => {
    triggerHaptic('medium');
    setPin('');
    setUsePin(false);
    biometric.prepare();
    setStep('confirm');
  };

  /** `credential` is the typed PIN, or the one-time token Face ID returns. */
  const handleConfirmSend = async (credential: string) => {
    if (sending || !credential) return;
    try {
      setSending(true);
      triggerHaptic('medium');
      const sendFn = functions().httpsCallable('sendP2P');
      const result = await sendFn({
        recipientPhone: recipient!.phoneNumber,
        amount: amountUnits,
        currency,
        pin: credential,
        note: note || undefined,
      });
      const data = result.data as { success: boolean; data?: { transactionId: string }; error?: string };
      if (!data.success) {
        Alert.alert(t('common.failed'), data.error || t('payments.transferFailed'));
        setPin('');
        return;
      }
      setTransactionId(data.data!.transactionId);
      triggerHaptic('success');
      setStep('success');
    } catch (err: any) {
      const msg =
        cooldownMessage(err, t) ??
        (err?.details?.reason === 'recipient_is_merchant'
          ? t('payments.recipientIsBusiness')
          : null) ??
        (err.message?.replace(/^\[.*?\]\s*/, '') || t('payments.transferFailed'));
      Alert.alert(t('common.error'), msg);
      setPin('');
    } finally {
      setSending(false);
    }
  };

  // One tap on a screen that shows who and how much; cancelled means the PIN.
  const sendWithBiometric = async () => {
    if (sending || !recipient) return;
    const approval = await biometric.approve(
      t('payments.sendingTo', { amount: amountLabel, name: recipient.fullName })
    );
    if (approval) {
      await handleConfirmSend(approval);
    } else {
      setUsePin(true);
    }
  };

  const shareReceipt = async () => {
    triggerHaptic('success');
    await Share.share({
      title: t('payments.receiptShareTitle'),
      message: t('common.sharePaymentReceipt', {
        recipient: recipient?.fullName ?? fullPhone,
        amount: amountLabel,
        note: note || 'N/A',
      }),
    });
  };


  const goBack = () => {
    triggerHaptic('light');
    if (step === 'amount') setStep('phone');
    else if (step === 'confirm') { setPin(''); setStep('amount'); }
  };

  const switchTab = (next: PaymentTab) => {
    if (next === tab) return;
    triggerHaptic('light');
    setTab(next);
  };

  const stepIndex = SEND_STEPS.indexOf(step as (typeof SEND_STEPS)[number]);
  const showStepHeader = tab === 'send' && step !== 'phone';
  const amountInput = amountInputLabel(amountText, currency);

  return (
    <View style={styles.container}>
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.glowInner} pointerEvents="none" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('payments.title')}</Text>
        <Text style={styles.subtitle}>{t('payments.subtitle')}</Text>

        <View style={styles.segment} accessibilityRole="tablist">
          {(['send', 'receive'] as const).map((key) => {
            const active = tab === key;
            const mark = active ? colors.ui.onSolid : colors.ui.textDim;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                onPress={() => switchTab(key)}
                activeOpacity={0.85}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                {key === 'send' ? <ArrowUpGlyph size={15} color={mark} /> : <QrCodeIcon size={15} color={mark} />}
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {key === 'send' ? t('payments.tabSend') : t('payments.tabReceive')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {showStepHeader && (
          <View style={styles.stepHeader}>
            {step !== 'success' && !sending ? (
              <TouchableOpacity
                onPress={goBack}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
              >
                <ChevronLeftIcon size={18} color={colors.ui.text} />
              </TouchableOpacity>
            ) : <View style={styles.backBtnSpacer} />}
            <View style={styles.stepTrack}>
              {SEND_STEPS.map((s, i) => (
                <View
                  key={s}
                  style={[styles.stepSeg, (step === 'success' || i <= stepIndex) && styles.stepSegDone]}
                />
              ))}
            </View>
          </View>
        )}

        {tab === 'send' ? (
          <>
            {step === 'phone' && (
              <>
                <View style={styles.panel}>
                  <View style={styles.panelHead}>
                    <View style={[styles.methodIcon, { backgroundColor: colors.tints.coral.fill }]}>
                      <PhoneGlyph size={20} color={colors.tints.coral.mark} />
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.panelTitle}>{t('payments.sendToPhone')}</Text>
                      <Text style={styles.panelSub}>{t('payments.sendToPhoneHint')}</Text>
                    </View>
                  </View>
                  <View style={styles.phoneField}>
                    <View style={styles.prefixChip}>
                      <Text style={styles.prefixText}>{PHONE_PREFIX}</Text>
                    </View>
                    <TextInput
                      placeholder="63 XXX XXXX"
                      placeholderTextColor={colors.ui.textFaint}
                      value={phoneInput}
                      onChangeText={setPhoneInput}
                      keyboardType="phone-pad"
                      style={styles.phoneInput}
                      returnKeyType="next"
                      onSubmitEditing={() => handleLookup()}
                      accessibilityLabel={t('payments.phoneNumber')}
                    />
                    <TouchableOpacity
                      style={[styles.contactsPill, !contactsLabel && styles.contactsPillIcon]}
                      onPress={() => {
                        triggerHaptic('light');
                        navigation.navigate('ContactPicker', { purpose: 'send' });
                      }}
                      disabled={lookingUp}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={t('payments.fromContacts')}
                    >
                      <PersonIcon size={contactsLabel ? 16 : 18} color={colors.ui.accentText} strokeWidth={2} />
                      {contactsLabel ? <Text style={styles.contactsPillText}>{t('payments.contacts')}</Text> : null}
                    </TouchableOpacity>
                  </View>
                  <Button
                    title={lookingUp ? t('common.lookingUp') : t('common.continue')}
                    onPress={() => handleLookup()}
                    disabled={lookingUp || !phoneInput.trim()}
                    loading={lookingUp}
                    fullWidth
                    style={styles.primaryCta}
                  />
                </View>

                {recents.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>{t('payments.recentPeople')}</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.recentScroll}
                      contentContainerStyle={styles.recentRow}
                      keyboardShouldPersistTaps="handled"
                    >
                      {recents.map((person) => (
                        <TouchableOpacity
                          key={person.phoneNumber}
                          style={styles.recentPerson}
                          onPress={() => pickRecent(person.phoneNumber)}
                          disabled={lookingUp}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={t('payments.sendToPerson', { name: person.name })}
                        >
                          <View style={styles.recentAvatar}>
                            <Text style={styles.recentAvatarText}>{personInitials(person.name)}</Text>
                          </View>
                          <Text style={styles.recentName} numberOfLines={1}>
                            {person.name.startsWith('+') ? `…${person.name.slice(-4)}` : person.name.split(' ')[0]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                <Text style={styles.sectionTitle}>{t('payments.otherWays')}</Text>
                <View style={styles.methodList}>
                  <MethodRow
                    icon={<ScanGlyph size={20} color={colors.tints.amber.mark} />}
                    tint={colors.tints.amber.fill}
                    title={t('payments.method.scanTitle')}
                    subtitle={t('payments.method.scanSubtitle')}
                    onPress={() => { triggerHaptic('light'); navigation.navigate('ScanQR'); }}
                  />
                  <MethodRow
                    icon={<QrCodeIcon size={20} color={colors.tints.coral.mark} />}
                    tint={colors.tints.coral.fill}
                    title={t('payments.method.showQrTitle')}
                    subtitle={t('payments.method.showQrSubtitle')}
                    onPress={() => switchTab('receive')}
                  />
                  <MethodRow
                    icon={<CashGlyph size={20} color={colors.tints.blue.mark} />}
                    tint={colors.tints.blue.fill}
                    title={t('payments.method.cashOutTitle')}
                    subtitle={t('payments.method.cashOutSubtitle')}
                    onPress={() => { triggerHaptic('light'); navigation.navigate('CashOut'); }}
                    last
                  />
                </View>
              </>
            )}

            {step === 'amount' && recipient && (
              <View style={styles.flowBlock}>
                <RecipientChip name={recipient.fullName} phone={recipient.phoneNumber} />
                {fromLink && <LinkNotice text={t('payments.linkNotice')} />}
                <Animated.Text
                  style={[
                    styles.amountLarge,
                    amountInput.length > 10 && styles.amountLargeLong,
                    !amountText && styles.amountEmpty,
                    amountAnimStyle,
                  ]}
                  numberOfLines={1}
                >
                  {amountInput}
                </Animated.Text>
                <View style={styles.currencyRow}>
                  <Text style={styles.availableText}>
                    {t('payments.available', { amount: formatMoney(balanceIn(wallet, currency), currency) })}
                  </Text>
                  {!fromLink && (
                    <TouchableOpacity
                      onPress={switchSendCurrency}
                      style={styles.currencyChip}
                      accessibilityRole="button"
                      accessibilityLabel={t(currency === 'SLS' ? 'payments.sendInDollars' : 'payments.sendInShillings')}
                    >
                      <Text style={styles.currencyChipText}>{currency === 'SLS' ? 'SLSH' : 'USD'} ⇄</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  placeholder={t('payments.addNote')}
                  placeholderTextColor={colors.ui.textFaint}
                  value={note}
                  onChangeText={setNote}
                  style={styles.noteInput}
                  maxLength={80}
                />
                <View style={styles.keypad}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '<'].map((key) =>
                    // Shillings have no smaller unit, so no decimal point.
                    key === '.' && currency === 'SLS' ? (
                      <View key={key} style={styles.keyBlank} />
                    ) : (
                      <TouchableOpacity
                        key={key}
                        style={styles.key}
                        onPress={() => (key === '<' ? backspace() : appendDigit(key))}
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel={key === '<' ? t('common.delete') : key}
                      >
                        {key === '<'
                          ? <BackspaceGlyph size={22} color={colors.ui.text} />
                          : <Text style={styles.keyText}>{key}</Text>}
                      </TouchableOpacity>
                    )
                  )}
                </View>
                <Button
                  title={t('common.continue')}
                  onPress={goToConfirm}
                  disabled={amountUnits <= 0}
                  fullWidth
                  style={styles.primaryCta}
                />
              </View>
            )}

            {step === 'confirm' && recipient && (
              <View style={styles.flowBlock}>
                {fromLink && <LinkNotice text={t('payments.linkNotice')} />}
                <View style={styles.receipt}>
                  <Text style={styles.receiptLabel}>{t('payments.youSend')}</Text>
                  <Text
                    style={[styles.receiptAmount, amountLabel.length > 10 && styles.amountLargeLong]}
                    numberOfLines={1}
                  >
                    {amountLabel}
                  </Text>
                  <View style={styles.receiptTo}>
                    <View style={styles.avatarSmall}>
                      <Text style={styles.avatarSmallText}>{personInitials(recipient.fullName)}</Text>
                    </View>
                    <Text style={styles.receiptToText} numberOfLines={1}>
                      {t('common.toRecipient', { name: recipient.fullName })}
                    </Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <ReviewRow label={t('common.phone')} value={recipient.phoneNumber} />
                  <ReviewRow label={t('common.fee')} value={t('payments.free')} valueTone="good" />
                  <ReviewRow label={t('common.delivery')} value={t('common.instant')} />
                  {note ? <ReviewRow label={t('common.note')} value={note} /> : null}
                  <View style={styles.receiptDivider} />
                  <ReviewRow label={t('common.total')} value={amountLabel} strong />
                </View>

                {sending ? (
                  <ActivityIndicator style={styles.pinSpinner} size="large" color={colors.ui.accent} />
                ) : biometric.available && !usePin ? (
                  <>
                    <Button
                      title={t('payments.sendWithBiometric', { amount: amountLabel, label: biometric.label })}
                      onPress={sendWithBiometric}
                      fullWidth
                      style={styles.primaryCta}
                    />
                    <TouchableOpacity
                      onPress={() => setUsePin(true)}
                      style={styles.textLink}
                      accessibilityRole="button"
                    >
                      <Text style={styles.textLinkText}>{t('payments.usePinInstead')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.pinBlock}>
                    <View style={styles.pinHead}>
                      <LockIcon size={16} color={colors.ui.textDim} />
                      <Text style={styles.pinPrompt}>{t('payments.enterPinToSend')}</Text>
                    </View>
                    <PinInput
                      value={pin}
                      onChange={setPin}
                      onComplete={handleConfirmSend}
                      secure
                      autoFocus={biometric.checked}
                    />
                  </View>
                )}
              </View>
            )}

            {step === 'success' && (
              <View style={[styles.flowBlock, styles.center, styles.successBlock]}>
                <View style={styles.successCheckWrap}>
                  <Animated.View style={[styles.successRing, successRingStyle]} />
                  <SuccessCheckIcon size={64} />
                </View>
                <Animated.View style={successTitleStyle}>
                  <Text style={styles.successTitle}>{t('payments.paymentSent')}</Text>
                </Animated.View>
                <Animated.View style={[styles.center, successAmountStyle]}>
                  <Text style={styles.successAmount} numberOfLines={1}>{amountLabel}</Text>
                  <Text style={styles.successRecipient}>
                    {t('common.toRecipient', { name: recipient?.fullName ?? '' })}
                  </Text>
                </Animated.View>
                <Animated.View style={[styles.fullWidth, successBtnsStyle]}>
                  <Button title={t('common.done')} onPress={() => { triggerHaptic('light'); resetSend(); }} fullWidth style={styles.primaryCta} />
                  <Button title={t('payments.shareReceipt')} onPress={shareReceipt} variant="secondary" fullWidth style={styles.secondaryCta} />
                </Animated.View>
              </View>
            )}
          </>
        ) : (
          <>
            <View style={[styles.panel, styles.center]}>
              <Text style={styles.panelTitle}>{t('payments.receivePayment')}</Text>
              <Text style={[styles.panelSub, styles.textCenter]}>{t('payments.receiveHint')}</Text>

              <View style={styles.qrPlate}>
                {tokenLoading && !token ? (
                  <View style={styles.qrPlaceholder}>
                    <ActivityIndicator size="large" color={colors.ui.accent} />
                    <Text style={styles.qrPlaceholderText}>{t('payments.generatingQr')}</Text>
                  </View>
                ) : tokenError ? (
                  <View style={styles.qrPlaceholder}>
                    <Text style={styles.tokenErrorText}>{tokenError}</Text>
                  </View>
                ) : token ? (
                  <View style={styles.qrWhite} accessible accessibilityRole="image" accessibilityLabel={t('dashboard.myQrCode')}>
                    <QRCode value={token.tokenData} size={196} color="#000000" backgroundColor="#FFFFFF" />
                  </View>
                ) : null}
              </View>

              {token && !tokenError ? (
                <View style={[styles.timerPill, (secondsLeft < 30 || receiveCapReached) && styles.timerPillWarning]}>
                  <View style={[styles.timerDot, (secondsLeft < 30 || receiveCapReached) && styles.timerDotWarning]} />
                  <Text style={[styles.timerText, (secondsLeft < 30 || receiveCapReached) && styles.timerTextWarning]}>
                    {receiveCapReached
                      ? t('payments.autoRefreshPaused', { count: MAX_RECEIVE_AUTO_FETCHES })
                      : tokenLoading && secondsLeft <= 0
                        ? t('payments.refreshing')
                        : secondsLeft > 0
                          ? t('payments.expiresIn', { time: formatCountdown(secondsLeft) })
                          : t('payments.refreshing')}
                  </Text>
                </View>
              ) : null}

              {(token || tokenError) && (
                <Button
                  title={tokenError ? t('common.retry') : t('payments.generateNewCode')}
                  onPress={() => {
                    triggerHaptic('medium');
                    setReceiveCapReached(false);
                    fetchToken({ forceRefresh: true });
                  }}
                  variant="secondary"
                  disabled={tokenLoading}
                  fullWidth
                  style={styles.primaryCta}
                />
              )}
            </View>

            <Text style={styles.sectionTitle}>{t('payments.addMoney')}</Text>
            <View style={styles.methodList}>
              <MethodRow
                icon={<PlusGlyph size={20} color={colors.tints.green.mark} />}
                tint={colors.tints.green.fill}
                title={t('payments.method.topUpTitle')}
                subtitle={t('topup.method.agentSubtitle')}
                onPress={() => { triggerHaptic('light'); navigation.navigate('TopUpMethod'); }}
              />
              <MethodRow
                icon={<PinGlyph size={20} color={colors.tints.blue.mark} />}
                tint={colors.tints.blue.fill}
                title={t('agentLocator.title')}
                subtitle={t('agentLocator.subtitle')}
                onPress={() => { triggerHaptic('light'); navigation.navigate('AgentLocator'); }}
                last
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────

function MethodRow({
  icon,
  tint,
  title,
  subtitle,
  onPress,
  last,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  last?: boolean;
}) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.methodRow, !last && styles.methodRowDivider]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    >
      <View style={[styles.methodIcon, { backgroundColor: tint }]}>{icon}</View>
      <View style={styles.flex1}>
        <Text style={styles.methodTitle}>{title}</Text>
        <Text style={styles.methodSub}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function RecipientChip({ name, phone }: { name: string; phone: string }) {
  const styles = useStyles();
  return (
    <View style={styles.recipientChip}>
      <View style={styles.avatarSmall}>
        <Text style={styles.avatarSmallText}>{personInitials(name)}</Text>
      </View>
      <View style={styles.flexShrink}>
        <Text style={styles.recipientName} numberOfLines={1}>{name}</Text>
        <Text style={styles.recipientPhone}>{phone}</Text>
      </View>
    </View>
  );
}

function LinkNotice({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.linkNotice}>
      <Text style={styles.linkNoticeText}>{text}</Text>
    </View>
  );
}

function ReviewRow({
  label,
  value,
  strong,
  valueTone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  valueTone?: 'good';
}) {
  const styles = useStyles();
  return (
    <View style={styles.reviewRow}>
      <Text style={[styles.reviewKey, strong && styles.reviewStrong]}>{label}</Text>
      <Text
        style={[styles.reviewValue, strong && styles.reviewStrong, valueTone === 'good' && styles.valueGood]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Glyphs ──────────────────────────────────────────────────

type GlyphProps = { size?: number; color: string };

function ArrowUpGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7 17 L17 7 M9 7 H17 V15" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function PhoneGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="6.5" y="2.5" width="11" height="19" rx="2.8" stroke={color} strokeWidth="1.9" />
      <Path d="M10.5 18 H13.5" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </Svg>
  );
}

function ScanGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8 V5.5 A1.5 1.5 0 0 1 5.5 4 H8 M16 4 H18.5 A1.5 1.5 0 0 1 20 5.5 V8 M20 16 V18.5 A1.5 1.5 0 0 1 18.5 20 H16 M8 20 H5.5 A1.5 1.5 0 0 1 4 18.5 V16 M4 12 H20"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function CashGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2.5" y="6" width="19" height="12" rx="2.5" stroke={color} strokeWidth="1.9" />
      <Circle cx="12" cy="12" r="2.6" stroke={color} strokeWidth="1.9" />
    </Svg>
  );
}

function PlusGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5 V19 M5 12 H19" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </Svg>
  );
}

function PinGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21 C12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C19 14.5 12 21 12 21 Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="9.5" r="2.4" stroke={color} strokeWidth="1.9" />
    </Svg>
  );
}

function BackspaceGlyph({ size = 22, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5 H19 A2 2 0 0 1 21 7 V17 A2 2 0 0 1 19 19 H9 L3 12 Z M12 9.5 L16.5 14.5 M16.5 9.5 L12 14.5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  glow: {
    position: 'absolute',
    top: -220,
    alignSelf: 'center',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.ui.accent,
    opacity: 0.06,
  },
  glowInner: {
    position: 'absolute',
    top: -120,
    alignSelf: 'center',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.ui.accent,
    opacity: 0.05,
  },
  flex1: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  center: { alignItems: 'center' },
  textCenter: { textAlign: 'center' },
  fullWidth: { width: '100%' },

  // Header
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, color: colors.ui.text },
  subtitle: { fontSize: 13, color: colors.ui.textDim, marginTop: 2, marginBottom: spacing.lg },

  // Send / Receive switch
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.full,
    padding: 4,
    marginBottom: spacing.lg,
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: { backgroundColor: colors.ui.solid },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.ui.textDim },
  segmentTextActive: { color: colors.ui.onSolid },

  // Step header
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnSpacer: { width: 36, height: 36 },
  stepTrack: { flex: 1, flexDirection: 'row', gap: 6 },
  stepSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.ui.ink(0.12) },
  stepSegDone: { backgroundColor: colors.ui.accent },

  // Panels
  panel: {
    backgroundColor: colors.ui.glassRaised,
    borderWidth: 1,
    borderColor: colors.ui.glassBorderStrong,
    borderRadius: 22,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  panelTitle: { fontSize: 17, fontWeight: '700', color: colors.ui.text, letterSpacing: -0.3 },
  panelSub: { fontSize: 13, color: colors.ui.textDim, marginTop: 3, lineHeight: 18 },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.ui.canvas,
    borderWidth: 1,
    borderColor: colors.ui.glassBorderStrong,
    paddingLeft: 6,
  },
  prefixChip: {
    height: 42,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.ui.ink(0.08),
    justifyContent: 'center',
  },
  prefixText: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  contactsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 10,
    marginRight: 10,
    borderRadius: 18,
    backgroundColor: colors.ui.accentSoft,
  },
  contactsPillIcon: {
    width: 36,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  contactsPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ui.accentText,
  },
  phoneInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing.md,
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.ui.text,
  },
  primaryCta: { marginTop: spacing.md },
  secondaryCta: { marginTop: spacing.sm },

  sectionTitle: { ...typography.h3, color: colors.ui.text, marginBottom: spacing.sm },

  // Recent people
  recentScroll: { marginHorizontal: -spacing.lg, marginBottom: spacing.lg },
  recentRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  recentPerson: { width: 64, alignItems: 'center' },
  recentAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.ui.accentSoft,
    borderWidth: 1,
    borderColor: colors.ui.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentAvatarText: { fontSize: 18, fontWeight: '700', color: colors.ui.accentText },
  recentName: { fontSize: 12, color: colors.ui.textDim, marginTop: 6, maxWidth: 64, textAlign: 'center' },

  // Method lists
  methodList: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14, paddingHorizontal: spacing.md },
  methodRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.glassBorderStrong },
  methodIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  methodTitle: { fontSize: 15, fontWeight: '600', color: colors.ui.text },
  methodSub: { fontSize: 12, color: colors.ui.textFaint, marginTop: 2, lineHeight: 16 },
  chevron: { fontSize: 24, color: colors.ui.textFaint, fontWeight: '300', lineHeight: 28 },

  // Send steps
  flowBlock: { marginBottom: spacing.lg },
  recipientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ui.glassRaised,
    borderWidth: 1,
    borderColor: colors.ui.glassBorderStrong,
    borderRadius: borderRadius.full,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: spacing.md,
    marginBottom: spacing.md,
    maxWidth: '100%',
  },
  avatarSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.ui.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSmallText: { fontSize: 13, fontWeight: '700', color: colors.ui.onSolid },
  recipientName: { fontSize: 14, fontWeight: '600', color: colors.ui.text },
  recipientPhone: { fontSize: 11, color: colors.ui.textFaint },
  linkNotice: {
    backgroundColor: colors.ui.warningSoft,
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  linkNoticeText: { ...typography.caption, color: colors.ui.warning },
  amountLarge: {
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -2.5,
    lineHeight: 66,
    color: colors.ui.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  amountLargeLong: { fontSize: 32, lineHeight: 40, letterSpacing: -0.8 },
  amountEmpty: { color: colors.ui.textFaint },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  availableText: { fontSize: 12, color: colors.ui.textDim },
  currencyChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.ui.glassBorderStrong,
    backgroundColor: colors.ui.glass,
  },
  currencyChipText: { fontSize: 12, fontWeight: '700', color: colors.ui.text },
  noteInput: {
    height: 46,
    borderRadius: borderRadius.full,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    paddingHorizontal: spacing.lg,
    color: colors.ui.text,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  key: {
    width: '31.5%',
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBlank: { width: '31.5%', height: 58 },
  keyText: { fontSize: 24, fontWeight: '600', color: colors.ui.text, fontVariant: ['tabular-nums'] },

  // Confirm
  receipt: {
    backgroundColor: colors.ui.glassRaised,
    borderWidth: 1,
    borderColor: colors.ui.glassBorderStrong,
    borderRadius: 22,
    padding: spacing.lg,
  },
  receiptLabel: { fontSize: 12, color: colors.ui.textDim, textAlign: 'center' },
  receiptAmount: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.8,
    color: colors.ui.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  receiptTo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  receiptToText: { fontSize: 14, fontWeight: '600', color: colors.ui.text, flexShrink: 1 },
  receiptDivider: { height: 1, backgroundColor: colors.ui.divider, marginVertical: spacing.md },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 7, gap: spacing.md },
  reviewKey: { fontSize: 14, color: colors.ui.textDim },
  reviewValue: { fontSize: 14, fontWeight: '600', color: colors.ui.text, maxWidth: '62%', textAlign: 'right' },
  reviewStrong: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  valueGood: { color: colors.ui.incoming },
  pinBlock: { marginTop: spacing.lg },
  pinHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: spacing.smPlus },
  pinPrompt: { ...typography.captionBold, color: colors.ui.textDim },
  pinSpinner: { marginTop: spacing.lg },
  textLink: { alignSelf: 'center', paddingVertical: spacing.smPlus, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  textLinkText: { ...typography.captionBold, color: colors.ui.accentText },

  // Success
  successBlock: { paddingTop: spacing.lg },
  successCheckWrap: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  successRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: colors.ui.incoming,
  },
  successTitle: { fontSize: 22, fontWeight: '700', color: colors.ui.text, textAlign: 'center' },
  successAmount: {
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -2,
    color: colors.ui.text,
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  successRecipient: { fontSize: 14, color: colors.ui.textDim, marginTop: spacing.xs, marginBottom: spacing.lg },

  // Receive
  qrPlate: { marginTop: spacing.lg, marginBottom: spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 228 },
  qrWhite: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
  qrPlaceholder: {
    width: 228,
    height: 228,
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.ui.glassBorderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  qrPlaceholderText: { fontSize: 13, color: colors.ui.textDim, marginTop: spacing.md, textAlign: 'center' },
  tokenErrorText: { fontSize: 14, color: colors.ui.error, textAlign: 'center' },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.ui.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
  },
  timerPillWarning: { backgroundColor: colors.ui.errorSoft },
  timerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ui.accentText },
  timerDotWarning: { backgroundColor: colors.ui.error },
  timerText: { fontSize: 13, fontWeight: '600', color: colors.ui.accentText, flexShrink: 1 },
  timerTextWarning: { color: colors.ui.error },
}));
