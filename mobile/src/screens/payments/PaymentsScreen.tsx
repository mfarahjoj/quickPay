import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Card, Button, PinInput } from '../../components';
import { typography, spacing, borderRadius, makeStyles, useColors } from '../../theme';
import { PHONE_PREFIX } from '../../config/constants';
import { Springs } from '../../constants/springs';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
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
  route?: { params?: { mode?: PaymentTab; prefill?: PaymentLink } };
}

export default function PaymentsScreen({ route }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
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

  /** `phoneOverride` lets a payment link look up before the input state has updated. */
  const handleLookup = async (phoneOverride?: string) => {
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
        Alert.alert(
          t('common.notFound'),
          found && !found.found && found.reason === 'self'
            ? t('payments.cannotSendToSelf')
            : t('payments.userNotFound')
        );
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('payments.title')}</Text>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === 'send' && styles.tabActive]}
          onPress={() => { triggerHaptic('light'); setTab('send'); }}
        >
          <Text style={[styles.tabText, tab === 'send' && styles.tabTextActive]}>{t('payments.tabSend')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'receive' && styles.tabActive]}
          onPress={() => { triggerHaptic('light'); setTab('receive'); }}
        >
          <Text style={[styles.tabText, tab === 'receive' && styles.tabTextActive]}>{t('payments.tabReceive')}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'send' ? (
        <>
          {step === 'phone' && (
            <Card>
              <Text style={styles.stepTitle}>{t('payments.enterRecipient')}</Text>
              {recents.length > 0 && (
                <>
                  <Text style={styles.groupTitle}>{t('payments.recentPeople')}</Text>
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
              <Text style={styles.groupTitle}>{t('payments.phoneNumber')}</Text>
              <View style={styles.phoneRow}>
                <View style={styles.prefixBox}>
                  <Text style={styles.prefixText}>{PHONE_PREFIX}</Text>
                </View>
                <TextInput
                  placeholder="XX XXX XXXX"
                  placeholderTextColor={colors.text.muted}
                  value={phoneInput}
                  onChangeText={setPhoneInput}
                  keyboardType="phone-pad"
                  style={styles.phoneInput}
                  autoFocus
                />
              </View>
              <Button
                title={lookingUp ? t('common.lookingUp') : t('common.continue')}
                onPress={() => handleLookup()}
                disabled={lookingUp || !phoneInput.trim()}
                fullWidth
                style={styles.primaryCta}
              />
              {lookingUp && <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.action.primary} />}
            </Card>
          )}

          {step === 'amount' && recipient && (
            <Card>
              <Text style={styles.stepTitle}>{t('payments.enterAmount')}</Text>
              {fromLink && (
                <View style={styles.linkNotice}>
                  <Text style={styles.linkNoticeText}>{t('payments.linkNotice')}</Text>
                </View>
              )}
              <View style={styles.recipientBadge}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{recipient.fullName.slice(0, 1)}</Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{recipient.fullName}</Text>
                  <Text style={styles.contactHandle}>{recipient.phoneNumber}</Text>
                </View>
              </View>
              <Animated.Text
                style={[
                  styles.amountLarge,
                  amountInputLabel(amountText, currency).length > 10 && styles.amountLargeLong,
                  amountAnimStyle,
                ]}
                numberOfLines={1}
              >
                {amountInputLabel(amountText, currency)}
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
                placeholderTextColor={colors.text.muted}
                value={note}
                onChangeText={setNote}
                style={styles.noteInput}
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
                      activeOpacity={0.75}
                    >
                      <Text style={styles.keyText}>{key}</Text>
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
              <Button
                title={t('common.back')}
                onPress={() => { setStep('phone'); }}
                variant="secondary"
                fullWidth
                style={styles.secondaryCta}
              />
            </Card>
          )}

          {step === 'confirm' && recipient && (
            <Card>
              <Text style={styles.stepTitle}>{t('payments.checkAndSend')}</Text>
              {fromLink && (
                <View style={styles.linkNotice}>
                  <Text style={styles.linkNoticeText}>{t('payments.linkNotice')}</Text>
                </View>
              )}
              <View style={styles.confirmHero}>
                <View style={styles.confirmAvatar}>
                  <Text style={styles.confirmAvatarText}>{personInitials(recipient.fullName)}</Text>
                </View>
                <Text
                  style={[styles.confirmAmount, amountLabel.length > 10 && styles.amountLargeLong]}
                  numberOfLines={1}
                >
                  {amountLabel}
                </Text>
                <Text style={styles.confirmTo}>{t('common.toRecipient', { name: recipient.fullName })}</Text>
                <Text style={styles.confirmPhone}>{recipient.phoneNumber}</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewKey}>{t('common.fee')}</Text>
                <Text style={styles.reviewValue}>{formatMoney(0, currency)}</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewKey}>{t('common.delivery')}</Text>
                <Text style={styles.reviewValue}>{t('common.instant')}</Text>
              </View>
              {note ? (
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewKey}>{t('common.note')}</Text>
                  <Text style={styles.reviewValue}>{note}</Text>
                </View>
              ) : null}

              {sending ? (
                <ActivityIndicator style={{ marginTop: spacing.lg }} size="large" color={colors.action.primary} />
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
                <>
                  <Text style={styles.pinPrompt}>{t('payments.enterPinToSend')}</Text>
                  <PinInput
                    value={pin}
                    onChange={setPin}
                    onComplete={handleConfirmSend}
                    secure
                    autoFocus={biometric.checked}
                  />
                </>
              )}
              {!sending && (
                <Button
                  title={t('common.back')}
                  onPress={() => { triggerHaptic('light'); setPin(''); setStep('amount'); }}
                  variant="secondary"
                  fullWidth
                  style={styles.secondaryCta}
                />
              )}
            </Card>
          )}

          {step === 'success' && (
            <Card style={styles.successCard}>
              <View style={styles.successCheckWrap}>
                <Animated.View style={[styles.successRing, successRingStyle]} />
                <SuccessCheckIcon size={64} />
              </View>
              <Animated.View style={successTitleStyle}>
                <Text style={styles.successTitle}>{t('payments.paymentSent')}</Text>
              </Animated.View>
              <Animated.View style={successAmountStyle}>
                <Text style={styles.successAmount}>{amountLabel}</Text>
                <Text style={styles.successRecipient}>{t('common.toRecipient', { name: recipient?.fullName ?? '' })}</Text>
              </Animated.View>
              <Animated.View style={successBtnsStyle}>
                <Button title={t('payments.shareReceipt')} onPress={shareReceipt} variant="secondary" fullWidth style={styles.primaryCta} />
                <Button title={t('common.done')} onPress={() => { triggerHaptic('light'); resetSend(); }} fullWidth style={styles.secondaryCta} />
              </Animated.View>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <Text style={styles.stepTitle}>{t('payments.receivePayment')}</Text>
          <Text style={styles.receiveHint}>
            {t('payments.receiveHint')}
          </Text>

          {tokenLoading && !token ? (
            <View style={styles.qrWrap}>
              <ActivityIndicator size="large" color={colors.action.primary} />
              <Text style={styles.tokenLoadingText}>{t('payments.generatingQr')}</Text>
            </View>
          ) : tokenError ? (
            <View style={styles.qrWrap}>
              <Text style={styles.tokenErrorText}>{tokenError}</Text>
              <Button
                title={t('common.retry')}
                onPress={() => fetchToken({ forceRefresh: true })}
                variant="secondary"
                style={styles.primaryCta}
              />
            </View>
          ) : token ? (
            <>
              <View style={styles.qrWrap}>
                <QRCode
                  value={token.tokenData}
                  size={200}
                  color="#000000"
                  backgroundColor="#FFFFFF"
                />
              </View>
              <View style={[
                styles.timerPill,
                (secondsLeft < 30 || receiveCapReached) && styles.timerPillWarning,
              ]}>
                <Text style={[
                  styles.timerText,
                  (secondsLeft < 30 || receiveCapReached) && styles.timerTextWarning,
                ]}>
                  {receiveCapReached
                    ? t('payments.autoRefreshPaused', { count: MAX_RECEIVE_AUTO_FETCHES })
                    : tokenLoading && secondsLeft <= 0
                      ? t('payments.refreshing')
                      : secondsLeft > 0
                        ? t('payments.expiresIn', { time: formatCountdown(secondsLeft) })
                        : t('payments.refreshing')}
                </Text>
              </View>
              <Button
                title={t('payments.generateNewCode')}
                onPress={() => {
                  triggerHaptic('medium');
                  setReceiveCapReached(false);
                  fetchToken({ forceRefresh: true });
                }}
                variant="secondary"
                fullWidth
                style={styles.primaryCta}
              />
            </>
          ) : null}
        </Card>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...typography.h1,
    color: colors.text.primary,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.ui.glass,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    padding: 4,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.action.primary,
  },
  tabText: {
    ...typography.body,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text.inverse,
  },
  stepTitle: {
    ...typography.bodyLarge,
    color: colors.text.primary,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  pinSubtitle: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  groupTitle: {
    ...typography.captionBold,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  phoneRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  prefixBox: {
    height: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.ui.glassRaised,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderTopLeftRadius: borderRadius.md,
    borderBottomLeftRadius: borderRadius.md,
  },
  prefixText: {
    ...typography.body,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: colors.ui.glassBorder,
    borderTopRightRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
    backgroundColor: colors.ui.glass,
    paddingHorizontal: spacing.md,
    color: colors.ui.text,
    ...typography.body,
  },
  linkNotice: {
    backgroundColor: colors.ui.warningSoft,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  linkNoticeText: {
    ...typography.caption,
    color: colors.ui.warning,
  },
  recipientBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ui.incomingSoft,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.ui.glass,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.smPlus,
  },
  avatarText: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: '600',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: '500',
  },
  contactHandle: {
    ...typography.caption,
    color: colors.text.muted,
  },
  primaryCta: {
    marginTop: spacing.md,
  },
  secondaryCta: {
    marginTop: spacing.sm,
  },
  amountLarge: {
    ...typography.balanceNumber,
    color: colors.text.primary,
    textAlign: 'center',
    marginVertical: spacing.smPlus,
    fontVariant: ['tabular-nums'],
  },
  amountLargeLong: {
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  availableText: {
    ...typography.caption,
    color: colors.text.muted,
  },
  currencyChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    backgroundColor: colors.ui.glass,
  },
  currencyChipText: {
    ...typography.captionBold,
    color: colors.text.primary,
  },
  keyBlank: {
    width: '31%',
  },
  noteInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.md,
    backgroundColor: colors.ui.glass,
    paddingHorizontal: spacing.md,
    color: colors.ui.text,
    marginBottom: spacing.md,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  key: {
    width: '31%',
    height: 44,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    backgroundColor: colors.ui.glass,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: {
    ...typography.bodyLarge,
    color: colors.text.primary,
    fontWeight: '600',
  },
  recentScroll: {
    marginHorizontal: -spacing.md,
    marginBottom: spacing.sm,
  },
  recentRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  recentPerson: {
    width: 60,
    alignItems: 'center',
  },
  recentAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.ui.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  recentAvatarText: {
    ...typography.body,
    color: colors.ui.accentText,
    fontWeight: '700',
  },
  recentName: {
    ...typography.caption,
    fontSize: 12,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  confirmHero: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  confirmAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ui.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.smPlus,
  },
  confirmAvatarText: {
    ...typography.bodyLarge,
    color: colors.ui.accentText,
    fontWeight: '700',
  },
  confirmAmount: {
    ...typography.balanceNumber,
    color: colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  confirmTo: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: '600',
    marginTop: 4,
  },
  confirmPhone: {
    ...typography.caption,
    color: colors.text.muted,
    marginTop: 2,
  },
  pinPrompt: {
    ...typography.captionBold,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.smPlus,
  },
  textLink: {
    alignSelf: 'center',
    paddingVertical: spacing.smPlus,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  textLinkText: {
    ...typography.captionBold,
    color: colors.ui.accentText,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
    paddingVertical: spacing.smPlus,
  },
  reviewKey: {
    ...typography.body,
    color: colors.text.secondary,
  },
  reviewValue: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  successCard: {
    alignItems: 'center',
  },
  successCheckWrap: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: colors.ui.incoming,
  },
  successTitle: {
    ...typography.h2,
    color: colors.text.primary,
    marginTop: spacing.sm,
  },
  successAmount: {
    ...typography.balanceNumber,
    color: colors.text.primary,
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  successRecipient: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  qrWrap: {
    alignItems: 'center',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  receiveHint: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  tokenLoadingText: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.md,
  },
  tokenErrorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  timerPill: {
    alignSelf: 'center',
    backgroundColor: colors.ui.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginBottom: spacing.md,
  },
  timerPillWarning: {
    backgroundColor: colors.ui.errorSoft,
  },
  timerText: {
    ...typography.bodySemibold,
    color: colors.ui.accentText,
  },
  timerTextWarning: {
    color: colors.ui.error,
  },
}));
