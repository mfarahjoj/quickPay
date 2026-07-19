import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL, PHONE_PREFIX } from '../../config/constants';
import { Springs } from '../../constants/springs';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { formatCountdown } from '../../utils/time';
import { triggerHaptic } from '../../services/haptics.service';
import { functions } from '../../services/firebase.config';
import {
  TokenResponse,
  CUSTOMER_TOKEN_TTL_SECONDS,
  BACKOFF_SECONDS_ON_FAILURE,
  buildOfflineReceiveToken,
  clearReceiveTokenCache,
  isReceiveTokenPermissionError,
  readCachedReceiveToken,
  resolveReceiveToken,
  secondsLeftFromToken,
} from '../../services/customerToken.service';

type PaymentTab = 'send' | 'receive';
type SendStep = 'phone' | 'amount' | 'review' | 'pin' | 'success';

/** Max automatic generateCustomerToken calls per Receive visit (initial load + expiry renewals). Manual actions are unlimited. */
const MAX_RECEIVE_AUTO_FETCHES = 4;

interface RecipientInfo {
  uid: string;
  fullName: string;
  phoneNumber: string;
}

interface Props {
  route?: { params?: { mode?: PaymentTab } };
}

export default function PaymentsScreen({ route }: Props) {
  const { t } = useTranslation();
  const initialMode = route?.params?.mode === 'receive' ? 'receive' : 'send';
  const [tab, setTab] = useState<PaymentTab>(initialMode);

  const [step, setStep] = useState<SendStep>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [recipient, setRecipient] = useState<RecipientInfo | null>(null);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [sending, setSending] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);

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
  /** When true, timer expiry only rotates local QR — no generateCustomerToken (permission or offline display). */
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

  const bumpOfflineReceiveDisplay = useCallback(() => {
    const offlineToken = buildOfflineReceiveToken();
    if (!offlineToken) return;
    setToken(offlineToken);
    setSecondsLeft(CUSTOMER_TOKEN_TTL_SECONDS);
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
      if (data.tokenId !== 'offline') {
        receiveAutoSkipCloudRef.current = false;
      }
      setToken(data);
      setSecondsLeft(secondsLeftFromToken(data));
      if (!opts?.silent) triggerHaptic('success');
    } catch (e: any) {
      // No Cloud Function round-trip — refund budgeted slot (same as home screen offline QR).
      if (budgetConsumed) {
        receiveAutoFetchRemainingRef.current += 1;
      }
      if (!mountedRef.current) return;
      if (isReceiveTokenPermissionError(e)) {
        receiveAutoSkipCloudRef.current = true;
      }
      const offlineToken = buildOfflineReceiveToken();
      if (offlineToken) {
        await clearReceiveTokenCache().catch(() => {});
        setToken(offlineToken);
        setSecondsLeft(CUSTOMER_TOKEN_TTL_SECONDS);
        if (!opts?.silent) triggerHaptic('success');
      } else if (!opts?.silent) {
        setTokenError(e?.message || t('payments.failedGenerateQr'));
      } else {
        setSecondsLeft(BACKOFF_SECONDS_ON_FAILURE);
      }
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
      bumpOfflineReceiveDisplay();
      return;
    }
    if (receiveAutoFetchRemainingRef.current <= 0) {
      setReceiveCapReached(true);
      clearReceiveTimer();
      return;
    }
    clearReceiveTimer();
    fetchToken({ silent: true, useBudget: true });
  }, [tab, token, secondsLeft, tokenLoading, fetchToken, clearReceiveTimer, bumpOfflineReceiveDisplay]);

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

  const amount = Number(amountText || '0');

  const appendDigit = (digit: string) => {
    if (digit === '.' && amountText.includes('.')) return;
    triggerHaptic('light');
    setAmountText((prev) => `${prev}${digit}`);
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
    setNote('');
    setPin('');
    setSending(false);
    setTransactionId(null);
  };

  const fullPhone = phoneInput.startsWith('+') ? phoneInput : `${PHONE_PREFIX}${phoneInput}`;

  const handleLookup = async () => {
    if (!phoneInput.trim()) {
      Alert.alert(t('common.error'), t('payments.enterPhoneError'));
      return;
    }
    try {
      setLookingUp(true);
      const lookupFn = functions().httpsCallable('lookupUserByPhone');
      const result = await lookupFn({ phoneNumber: fullPhone });
      const data = result.data as { success: boolean; data?: RecipientInfo; error?: string };
      if (!data.success || !data.data) {
        Alert.alert(t('common.notFound'), t('payments.userNotFound'));
        return;
      }
      setRecipient(data.data);
      setStep('amount');
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('payments.lookupFailed'));
    } finally {
      setLookingUp(false);
    }
  };

  const handleConfirmSend = async () => {
    if (pin.length < 6) return;
    try {
      setSending(true);
      triggerHaptic('medium');
      const amountCents = Math.round(amount * 100);
      const sendFn = functions().httpsCallable('sendP2P');
      const result = await sendFn({
        recipientPhone: recipient!.phoneNumber,
        amount: amountCents,
        currency: 'USD',
        pin,
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
      const msg = err.message?.replace(/^\[.*?\]\s*/, '') || t('payments.transferFailed');
      Alert.alert(t('common.error'), msg);
      setPin('');
    } finally {
      setSending(false);
    }
  };

  const shareReceipt = async () => {
    triggerHaptic('success');
    await Share.share({
      title: t('payments.receiptShareTitle'),
      message: t('common.sharePaymentReceipt', {
        recipient: recipient?.fullName ?? fullPhone,
        amount: `${CURRENCY_SYMBOL}${amount.toFixed(2)}`,
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
                onPress={handleLookup}
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
              <View style={styles.recipientBadge}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{recipient.fullName.slice(0, 1)}</Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{recipient.fullName}</Text>
                  <Text style={styles.contactHandle}>{recipient.phoneNumber}</Text>
                </View>
              </View>
              <Animated.Text style={[styles.amountLarge, amountAnimStyle]}>
                {CURRENCY_SYMBOL}
                {amountText || '0'}
              </Animated.Text>
              <TextInput
                placeholder={t('payments.addNote')}
                placeholderTextColor={colors.text.muted}
                value={note}
                onChangeText={setNote}
                style={styles.noteInput}
              />
              <View style={styles.keypad}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '<'].map((key) => (
                  <TouchableOpacity
                    key={key}
                    style={styles.key}
                    onPress={() => (key === '<' ? backspace() : appendDigit(key))}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.keyText}>{key}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Button
                title={t('common.continue')}
                onPress={() => { triggerHaptic('medium'); setStep('review'); }}
                disabled={amount <= 0}
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

          {step === 'review' && recipient && (
            <Card>
              <Text style={styles.stepTitle}>{t('payments.review')}</Text>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewKey}>{t('common.recipient')}</Text>
                <Text style={styles.reviewValue}>{recipient.fullName}</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewKey}>{t('common.phone')}</Text>
                <Text style={styles.reviewValue}>{recipient.phoneNumber}</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewKey}>{t('common.amount')}</Text>
                <Text style={styles.reviewValue}>
                  {CURRENCY_SYMBOL}{amount.toFixed(2)}
                </Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewKey}>{t('common.fee')}</Text>
                <Text style={styles.reviewValue}>{CURRENCY_SYMBOL}0.00</Text>
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
              <Button
                title={t('payments.confirmEnterPin')}
                onPress={() => { triggerHaptic('medium'); setStep('pin'); }}
                fullWidth
                style={styles.primaryCta}
              />
              <Button
                title={t('common.back')}
                onPress={() => { triggerHaptic('light'); setStep('amount'); }}
                variant="secondary"
                fullWidth
                style={styles.secondaryCta}
              />
            </Card>
          )}

          {step === 'pin' && (
            <Card>
              <Text style={styles.stepTitle}>{t('payments.enterPin')}</Text>
              <Text style={styles.pinSubtitle}>
                {t('payments.sendingTo', {
                  amount: `${CURRENCY_SYMBOL}${amount.toFixed(2)}`,
                  name: recipient?.fullName ?? '',
                })}
              </Text>
              <PinInput
                value={pin}
                onChange={setPin}
                secure
              />
              {sending ? (
                <ActivityIndicator style={{ marginTop: spacing.lg }} size="large" color={colors.action.primary} />
              ) : (
                <>
                  <Button
                    title={t('common.send')}
                    onPress={handleConfirmSend}
                    disabled={pin.length < 6}
                    fullWidth
                    style={styles.primaryCta}
                  />
                  <Button
                    title={t('common.back')}
                    onPress={() => { setPin(''); setStep('review'); }}
                    variant="secondary"
                    fullWidth
                    style={styles.secondaryCta}
                  />
                </>
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
                <Text style={styles.successAmount}>{CURRENCY_SYMBOL}{amount.toFixed(2)}</Text>
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
              {token.tokenId === 'offline' ? (
                <Text style={styles.offlineQrHint}>
                  {t('payments.offlineQrHint')}
                </Text>
              ) : null}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
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
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
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
    backgroundColor: colors.dark.glassRaised,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
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
    borderColor: colors.dark.glassBorder,
    borderTopRightRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    paddingHorizontal: spacing.md,
    color: colors.dark.text,
    ...typography.body,
  },
  recipientBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.incomingSoft,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.dark.glass,
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
  noteInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    paddingHorizontal: spacing.md,
    color: colors.dark.text,
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
    borderColor: colors.dark.glassBorder,
    backgroundColor: colors.dark.glass,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: {
    ...typography.bodyLarge,
    color: colors.text.primary,
    fontWeight: '600',
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
    borderColor: colors.dark.incoming,
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
  offlineQrHint: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  timerPill: {
    alignSelf: 'center',
    backgroundColor: colors.dark.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginBottom: spacing.md,
  },
  timerPillWarning: {
    backgroundColor: colors.dark.errorSoft,
  },
  timerText: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },
  timerTextWarning: {
    color: colors.dark.error,
  },
});
