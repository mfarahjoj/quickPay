import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { PinInput } from '../../components/PinInput';
import { approvePayment, rejectPayment } from '../../services/customerToken.service';
import { firestore } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { Springs } from '../../constants/springs';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { AnimatedXMark, AnimatedWarning } from '../../components/icons/StatusIcons';

type ApprovePaymentParams = {
  ApprovePayment: {
    requestId: string;
    merchantName: string;
    amount: number;
    currency: string;
    createdAt?: string;
    reference?: string;
  };
};

type Step = 'review' | 'pin' | 'result';
type ResultKind = 'approved' | 'declined' | 'error' | 'closed';

/** Requests raised before `expiresAt` was stored were payable for five minutes. */
const LEGACY_TTL_MS = 5 * 60 * 1000;
/** Grace for a phone clock running slightly ahead of the server's. */
const CLOCK_GRACE_MS = 3000;

const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

export default function ApprovePaymentScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ApprovePaymentParams, 'ApprovePayment'>>();
  const { requestId, merchantName, amount, currency, createdAt, reference } = route.params;

  const [step, setStep] = useState<Step>('review');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [resultKind, setResultKind] = useState<ResultKind>('approved');
  const [resultMessage, setResultMessage] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');
  const [closedTitle, setClosedTitle] = useState('');

  // The charge as the server has it. The screen opens with what the push or
  // the list carried, then follows the live request: the shop can cancel, the
  // window can run out, and the customer pays exactly the amount shown here.
  const [liveAmount, setLiveAmount] = useState<number | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  // Ticks every second while the request is open, so the countdown and the
  // lock at zero both re-render (a repeated 0 alone would not).
  const [now, setNow] = useState(() => Date.now());
  const approving = useRef(false);
  const resultShown = useRef(false);

  // Result animation
  const resultRingScale = useSharedValue(0.8);
  const resultRingOpacity = useSharedValue(0);
  const resultTitleOp = useSharedValue(0);
  const resultTitleY = useSharedValue(16);
  const resultAmountOp = useSharedValue(0);
  const resultDetailsOp = useSharedValue(0);
  const resultBtnOp = useSharedValue(0);

  const resultRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: resultRingScale.value }],
    opacity: resultRingOpacity.value,
  }));
  const resultTitleStyle = useAnimatedStyle(() => ({
    opacity: resultTitleOp.value,
    transform: [{ translateY: resultTitleY.value }],
  }));
  const resultAmountStyle = useAnimatedStyle(() => ({ opacity: resultAmountOp.value }));
  const resultDetailsStyle = useAnimatedStyle(() => ({ opacity: resultDetailsOp.value }));
  const resultBtnStyle = useAnimatedStyle(() => ({ opacity: resultBtnOp.value }));

  useEffect(() => {
    if (step !== 'result') return;
    resultRingScale.value = withSpring(2.2, Springs.celebration);
    resultRingOpacity.value = withSequence(
      withTiming(0.35, { duration: 60 }),
      withTiming(0, { duration: 680 }),
    );
    resultTitleOp.value = withDelay(280, withTiming(1, { duration: 260 }));
    resultTitleY.value = withDelay(280, withSpring(0, Springs.transition));
    resultAmountOp.value = withDelay(400, withTiming(1, { duration: 220 }));
    resultDetailsOp.value = withDelay(500, withTiming(1, { duration: 220 }));
    resultBtnOp.value = withDelay(600, withTiming(1, { duration: 200 }));
  }, [step, resultRingScale, resultRingOpacity, resultTitleOp, resultTitleY, resultAmountOp, resultDetailsOp, resultBtnOp]);

  const shownAmount = liveAmount ?? amount;
  const amountFormatted = (shownAmount / 100).toFixed(2);

  const showResult = (kind: ResultKind, message: string, title = '') => {
    resultShown.current = true;
    setResultKind(kind);
    setResultMessage(message);
    setClosedTitle(title);
    setStep('result');
  };

  const showClosed = (why: 'cancelled' | 'expired') =>
    showResult(
      'closed',
      why === 'cancelled'
        ? t('payments.approve.cancelledMessage', { merchant: merchantName })
        : t('payments.approve.expiredMessage'),
      why === 'cancelled' ? t('payments.approve.cancelledTitle') : t('payments.approve.expiredTitle'),
    );

  useEffect(() => {
    return firestore()
      .collection('paymentRequests')
      .doc(requestId)
      .onSnapshot(
        (doc) => {
          const d = doc.data();
          if (!d) return;
          if (typeof d.amount === 'number') setLiveAmount(d.amount);
          setExpiresAtMs(
            d.expiresAt?.toMillis?.() ??
              (d.createdAt?.toMillis?.() ?? Date.now()) + LEGACY_TTL_MS,
          );
          // This screen's own approval decides its result; a result already
          // on screen is not replaced.
          if (approving.current || resultShown.current) return;
          if (d.status === 'cancelled') showClosed('cancelled');
          else if (d.status === 'expired') showClosed('expired');
          else if (d.status === 'approved') {
            setTransactionAmount(`${CURRENCY_SYMBOL}${(d.amount / 100).toFixed(2)}`);
            showResult('approved', t('payments.approve.alreadyPaid'));
          } else if (d.status === 'rejected') {
            showResult('declined', t('payments.approve.declinedMessage'));
          }
        },
        () => undefined,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const lapsed = expiresAtMs !== null && now > expiresAtMs + CLOCK_GRACE_MS;
  const secondsLeft =
    expiresAtMs === null ? null : Math.max(0, Math.ceil((expiresAtMs - now) / 1000));

  useEffect(() => {
    if (expiresAtMs === null || step === 'result' || lapsed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAtMs, step, lapsed]);

  const countdown =
    secondsLeft === null ? null : (
      <Text style={[styles.countdown, lapsed && styles.countdownLapsed]}>
        {lapsed
          ? t('payments.approve.expiredNow')
          : t('payments.approve.expiresIn', { time: formatClock(secondsLeft) })}
      </Text>
    );
  const requestDate = createdAt ? new Date(createdAt) : new Date();
  const formattedDate = requestDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = requestDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const shortRef = reference?.trim()
    || (requestId.length > 12
      ? `${requestId.slice(0, 6)}...${requestId.slice(-4)}`
      : requestId);

  const handleAccept = () => {
    triggerHaptic('medium');
    setStep('pin');
  };

  const handleApprove = async (submittedPin: string) => {
    if (loading) return;
    approving.current = true;
    try {
      setLoading(true);
      await approvePayment(requestId, submittedPin, shownAmount);
      triggerHaptic('success');
      setTransactionAmount(`${CURRENCY_SYMBOL}${amountFormatted}`);
      setResultKind('approved');
      setResultMessage(
        t('payments.approve.successMessage', {
          amount: `${CURRENCY_SYMBOL}${amountFormatted}`,
          merchant: merchantName,
        })
      );
      setStep('result');
    } catch (e: any) {
      triggerHaptic('medium');
      const message: string = typeof e?.message === 'string' ? e.message : '';
      if (/already cancelled/i.test(message)) {
        showClosed('cancelled');
      } else if (/expired/i.test(message)) {
        showClosed('expired');
      } else if (/already rejected/i.test(message)) {
        showResult('declined', t('payments.approve.declinedMessage'));
      } else if (/does not match/i.test(message)) {
        showResult('error', t('payments.approve.amountChanged'));
      } else if (e?.code === 'functions/permission-denied' && /invalid pin/i.test(message)) {
        showResult('error', t('auth.pinLogin.invalidPin'));
      } else if (e?.code === 'functions/resource-exhausted' && e?.details?.secondsLeft) {
        showResult('error', t('pin.lockedOut', { seconds: e.details.secondsLeft }));
      } else {
        showResult(
          'error',
          message.replace(/^\[.*?\]\s*/, '') || t('common.failedApprovePayment'),
        );
      }
    } finally {
      approving.current = false;
      setLoading(false);
    }
  };

  const handleReject = async () => {
    try {
      setRejecting(true);
      await rejectPayment(requestId);
      triggerHaptic('medium');
      setResultKind('declined');
      setResultMessage(t('payments.approve.declinedMessage'));
      setStep('result');
    } catch (e: any) {
      triggerHaptic('medium');
      const message: string = typeof e?.message === 'string' ? e.message : '';
      if (/already cancelled/i.test(message)) {
        showClosed('cancelled');
      } else if (/expired/i.test(message)) {
        showClosed('expired');
      } else {
        showResult(
          'error',
          message.replace(/^\[.*?\]\s*/, '') || t('common.failedDeclinePayment'),
        );
      }
    } finally {
      setRejecting(false);
    }
  };

  const handleDone = () => {
    navigation.goBack();
  };

  const handleRetryPin = () => {
    // Back to a live request: let the listener report a cancel or expiry again.
    resultShown.current = false;
    setPin('');
    setStep('pin');
  };

  if (step === 'review') {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.headerSection}>
          <View style={styles.merchantAvatar}>
            <Text style={styles.merchantAvatarText}>
              {merchantName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.merchantNameLarge}>{merchantName}</Text>
          <Text style={styles.requestLabel}>{t('payments.approve.requesting')}</Text>
        </View>

        <View
          style={styles.amountCard}
          accessibilityLabel={`Total amount ${amountFormatted} ${currency}`}
          accessibilityRole="text"
        >
          <Text style={styles.amountCardLabel}>{t('payments.approve.totalAmount')}</Text>
          <Text style={styles.amountCardValue}>
            {CURRENCY_SYMBOL}{amountFormatted}
          </Text>
          <Text style={styles.amountCardCurrency}>{currency}</Text>
          {countdown}
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('payments.approve.merchant')}</Text>
            <Text style={styles.detailValue}>{merchantName}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('common.amount')}</Text>
            <Text style={styles.detailValue}>
              {CURRENCY_SYMBOL}{amountFormatted}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('common.fee')}</Text>
            <Text style={styles.detailValue}>{CURRENCY_SYMBOL}0.00</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('common.total')}</Text>
            <Text style={[styles.detailValue, styles.detailValueBold]}>
              {CURRENCY_SYMBOL}{amountFormatted}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('common.date')}</Text>
            <Text style={styles.detailValue}>{formattedDate}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('common.time')}</Text>
            <Text style={styles.detailValue}>{formattedTime}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('common.reference')}</Text>
            <Text style={[styles.detailValue, styles.detailValueMono]}>
              {shortRef}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.acceptButton, lapsed && styles.acceptButtonDisabled]}
          onPress={handleAccept}
          disabled={lapsed}
          activeOpacity={0.8}
          accessibilityLabel={`Accept and pay ${amountFormatted} ${currency} to ${merchantName}`}
          accessibilityRole="button"
        >
          <Text style={styles.acceptButtonText}>{t('payments.approve.acceptPay')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.declineButton}
          onPress={handleReject}
          disabled={rejecting}
          activeOpacity={0.8}
          accessibilityLabel="Decline payment request"
          accessibilityRole="button"
        >
          {rejecting ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Text style={styles.declineButtonText}>{t('payments.approve.decline')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (step === 'pin') {
    return (
      <View style={styles.container}>
        <View style={styles.pinHeader}>
          <Text style={styles.pinTitle}>{t('payments.approve.confirmPayment')}</Text>
          <Text style={styles.pinSubtitle}>
            {t('payments.approve.payTo', {
              amount: `${CURRENCY_SYMBOL}${amountFormatted}`,
              merchant: merchantName,
            })}
          </Text>
          {countdown}
        </View>

        <Text style={styles.pinLabel}>{t('payments.approve.enterPin')}</Text>
        <PinInput
          value={pin}
          onChange={setPin}
          onComplete={handleApprove}
          secure
          style={styles.pinInput}
        />

        {loading && (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={styles.spinner}
          />
        )}

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => { setPin(''); setStep('review'); }}
          disabled={loading}
        >
          <Text style={styles.backButtonText}>{t('payments.approve.backToReview')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isSuccess = resultKind === 'approved';
  const isDeclined = resultKind === 'declined';
  const isClosed = resultKind === 'closed';
  const ringColor = isSuccess ? colors.dark.incoming : isDeclined ? colors.dark.error : colors.dark.warning;

  return (
    <View style={[styles.container, styles.resultContainer]}>
      <View style={styles.resultIconWrap}>
        <Animated.View style={[styles.resultRing, { borderColor: ringColor }, resultRingStyle]} />
        {isSuccess
          ? <SuccessCheckIcon size={64} />
          : isDeclined
            ? <AnimatedXMark size={48} />
            : <AnimatedWarning size={48} />
        }
      </View>

      <Animated.View style={resultTitleStyle}>
        <Text style={styles.resultTitle}>
          {isSuccess
            ? t('payments.approve.success')
            : isDeclined
              ? t('payments.approve.declined')
              : isClosed
                ? closedTitle
                : t('payments.approve.failed')}
        </Text>
      </Animated.View>

      {isSuccess && (
        <Animated.View style={resultAmountStyle}>
          <Text style={styles.resultAmount}>{transactionAmount}</Text>
        </Animated.View>
      )}

      <Animated.View style={resultAmountStyle}>
        <Text style={styles.resultMessage}>{resultMessage}</Text>
      </Animated.View>

      {isSuccess && (
        <Animated.View style={[styles.resultDetails, resultDetailsStyle]}>
          <View style={styles.resultDetailRow}>
            <Text style={styles.resultDetailLabel}>{t('common.to')}</Text>
            <Text style={styles.resultDetailValue}>{merchantName}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.resultDetailRow}>
            <Text style={styles.resultDetailLabel}>{t('common.reference')}</Text>
            <Text style={[styles.resultDetailValue, styles.detailValueMono]}>
              {shortRef}
            </Text>
          </View>
        </Animated.View>
      )}

      <Animated.View style={[{ width: '100%', marginTop: spacing.xl }, resultBtnStyle]}>
        <TouchableOpacity
          style={styles.acceptButton}
          onPress={handleDone}
          activeOpacity={0.8}
        >
          <Text style={styles.acceptButtonText}>{t('common.done')}</Text>
        </TouchableOpacity>

        {resultKind === 'error' && (
          <TouchableOpacity
            style={styles.retryLink}
            onPress={handleRetryPin}
          >
            <Text style={styles.retryLinkText}>{t('payments.approve.tryAgain')}</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },

  headerSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  merchantAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.dark.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  merchantAvatarText: {
    ...typography.h1,
    color: colors.dark.accentText,
  },
  merchantNameLarge: {
    ...typography.h1,
    color: colors.dark.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  requestLabel: {
    ...typography.body,
    color: colors.dark.textDim,
  },

  amountCard: {
    backgroundColor: colors.dark.accentSoft,
    borderWidth: 1,
    borderColor: colors.dark.accentBorder,
    borderRadius: borderRadius.xxl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  amountCardLabel: {
    ...typography.overline,
    color: colors.dark.accentText,
    marginBottom: spacing.xs,
  },
  amountCardValue: {
    ...typography.balanceNumber,
    color: colors.dark.text,
  },
  amountCardCurrency: {
    ...typography.caption,
    color: colors.dark.accentText,
    marginTop: spacing.xs,
  },
  countdown: {
    ...typography.caption,
    color: colors.dark.textDim,
    marginTop: spacing.sm,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  countdownLapsed: {
    color: colors.dark.error,
  },

  detailsCard: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.smPlus,
  },
  detailLabel: {
    ...typography.body,
    color: colors.dark.textFaint,
  },
  detailValue: {
    ...typography.bodySemibold,
    color: colors.dark.text,
    textAlign: 'right',
    maxWidth: '60%',
  },
  detailValueBold: {
    fontWeight: '700',
    fontSize: 16,
  },
  detailValueMono: {
    fontFamily: undefined,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: colors.dark.divider,
  },

  acceptButton: {
    backgroundColor: colors.dark.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  acceptButtonDisabled: {
    opacity: 0.4,
  },
  acceptButtonText: {
    ...typography.h3,
    color: '#FFFFFF',
  },
  declineButton: {
    borderWidth: 1,
    borderColor: colors.dark.error,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  declineButtonText: {
    ...typography.h3,
    color: colors.dark.error,
  },

  pinHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  pinTitle: {
    ...typography.h1,
    color: colors.dark.text,
    marginBottom: spacing.xs,
  },
  pinSubtitle: {
    ...typography.body,
    color: colors.dark.textDim,
    textAlign: 'center',
  },
  pinLabel: {
    ...typography.bodySemibold,
    color: colors.dark.textDim,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  pinInput: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  spinner: {
    marginBottom: spacing.lg,
  },
  backButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  backButtonText: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },

  resultContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultIconWrap: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  resultRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
  },
  resultTitle: {
    ...typography.h1,
    color: colors.dark.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  resultAmount: {
    ...typography.balanceNumber,
    color: colors.dark.text,
    marginBottom: spacing.sm,
  },
  resultMessage: {
    ...typography.body,
    color: colors.dark.textDim,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  resultDetails: {
    width: '100%',
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  resultDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.smPlus,
  },
  resultDetailLabel: {
    ...typography.body,
    color: colors.dark.textFaint,
  },
  resultDetailValue: {
    ...typography.bodySemibold,
    color: colors.dark.text,
  },
  retryLink: {
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  retryLinkText: {
    ...typography.bodySemibold,
    color: colors.dark.accentText,
  },
});
