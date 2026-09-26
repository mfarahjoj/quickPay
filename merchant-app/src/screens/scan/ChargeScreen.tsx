import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { firestore } from '../../services/firebase.config';
import {
  createPaymentRequest,
  cancelPaymentRequest,
  ChargeStatus,
} from '../../services/scan.service';
import {
  DarkScreen,
  GlassCard,
  PillButton,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import { SuccessCheckIcon, CloseIcon } from '../../components/icons/AuthIcons';
import { useExitGuard } from '../../hooks/useExitGuard';
import { toCents, formatCents, sanitizeAmountInput } from '../../utils/money';
import { callableErrorKey } from '../../utils/errors';

interface Props {
  route: { params: { tokenId: string; customerName: string; customerId: string } };
  navigation: any;
}

/**
 * idle → sending → waiting ⇄ cancelling → an outcome.
 *
 * `unknown` is the honest outcome when the timer ran out and the server could
 * not be reached to say how the charge ended: the merchant is told to check
 * History rather than shown a guess.
 */
type Phase =
  | 'idle'
  | 'sending'
  | 'waiting'
  | 'cancelling'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'unknown';

const OUTCOMES: Phase[] = ['approved', 'rejected', 'expired', 'cancelled', 'unknown'];
const isOutcome = (phase: Phase) => OUTCOMES.includes(phase);

/** Failures that do not say whether the server raised the charge. */
const AMBIGUOUS = ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal'];

/** The merchant's message for a failed charge; the server's own text is English. */
function chargeErrorKey(error: any): string {
  const message: string = typeof error?.message === 'string' ? error.message : '';
  if (error?.code === 'functions/failed-precondition' && /scan/i.test(message)) {
    return 'scan.charge.errors.scanExpired';
  }
  if (error?.code === 'functions/permission-denied' && /limit/i.test(message)) {
    return 'scan.charge.errors.overLimit';
  }
  return callableErrorKey(error);
}

const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

export default function ChargeScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { tokenId, customerName } = route.params;
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [chargedCents, setChargedCents] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [connectionLost, setConnectionLost] = useState(false);
  // The last attempt failed without saying whether the charge was raised.
  const [maybeRaised, setMaybeRaised] = useState(false);
  const [focused, setFocused] = useState(false);
  const [refFocused, setRefFocused] = useState(false);
  const deadline = useRef(0);
  const withdrawing = useRef(false);

  // A late reply must never overwrite a known outcome: paid stays paid.
  const settle = useCallback((next: Phase) => {
    setPhase((prev) => (isOutcome(prev) ? prev : next));
  }, []);

  // The customer approving or declining lands here.
  useEffect(() => {
    if (!requestId) return;
    return firestore()
      .collection('paymentRequests')
      .doc(requestId)
      .onSnapshot(
        (doc) => {
          setConnectionLost(false);
          const status = doc.data()?.status as ChargeStatus | undefined;
          if (status && status !== 'pending') settle(status);
        },
        () => setConnectionLost(true),
      );
  }, [requestId, settle]);

  /**
   * Ask the server to end the charge, then show how it really ended. Its
   * answer is the final status, and 'approved' — the customer got there
   * first — has to read as paid, not cancelled.
   */
  const withdraw = useCallback(
    async (id: string, onFailure: Phase): Promise<Phase | null> => {
      if (withdrawing.current) return null;
      withdrawing.current = true;
      setPhase((prev) => (isOutcome(prev) ? prev : 'cancelling'));
      try {
        const final = await cancelPaymentRequest(id);
        const next: Phase = final === 'pending' ? 'cancelled' : final;
        settle(next);
        return next;
      } catch {
        settle(onFailure);
        if (onFailure === 'waiting') {
          Alert.alert(t('scan.charge.cancelFailedTitle'), t('scan.charge.cancelFailedMessage'));
        }
        return null;
      } finally {
        withdrawing.current = false;
      }
    },
    [settle, t],
  );

  // Counts down from the server's own measure of time left, so a phone with
  // the wrong clock still gives the customer the right window. At zero the
  // server is asked how the charge ended rather than assuming it expired.
  useEffect(() => {
    if (phase !== 'waiting' || !requestId) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) withdraw(requestId, 'unknown');
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, requestId, withdraw]);

  const confirmCancel = (leave: () => void) => {
    if (!requestId) return;
    Alert.alert(
      t('scan.charge.cancelConfirmTitle'),
      t('scan.charge.cancelConfirmMessage', {
        name: customerName,
        amount: formatCents(chargedCents),
      }),
      [
        { text: t('scan.charge.keepWaiting'), style: 'cancel' },
        {
          text: t('scan.charge.cancel'),
          style: 'destructive',
          onPress: async () => {
            const final = await withdraw(requestId, 'waiting');
            if (final && final !== 'approved') leave();
          },
        },
      ],
    );
  };

  // After a failure that left it unclear whether the charge exists, leaving
  // withdraws it first. The charge would be keyed by this scan, so it can be
  // named without the reply that never arrived.
  const withdrawUnseen = (leave: () => void) => {
    cancelPaymentRequest(tokenId)
      .then((final) => {
        if (final === 'approved') {
          setChargedCents(toCents(amount));
          settle('approved');
        } else {
          leave();
        }
      })
      .catch(() => leave());
  };

  useExitGuard(navigation, {
    blocked: phase === 'sending' || phase === 'cancelling',
    onExit:
      phase === 'waiting'
        ? confirmCancel
        : phase === 'idle' && maybeRaised
          ? withdrawUnseen
          : undefined,
  });

  const handleCharge = async () => {
    const cents = toCents(amount);
    if (cents <= 0) {
      Alert.alert(t('common.invalidAmount'), t('common.invalidAmountMessage'));
      return;
    }
    setPhase('sending');
    try {
      const result = await createPaymentRequest(
        tokenId,
        cents,
        'USD',
        reference.trim() || undefined,
      );
      // Fallbacks cover a server older than this screen, which replies with
      // the request ID alone.
      deadline.current = Date.now() + (result.expiresInSeconds ?? 90) * 1000;
      setChargedCents(result.amount ?? cents);
      setMaybeRaised(false);
      setRequestId(result.requestId);
      const status = result.status ?? 'pending';
      setPhase(status === 'pending' ? 'waiting' : status);
    } catch (e: any) {
      if (AMBIGUOUS.includes(e?.code)) setMaybeRaised(true);
      Alert.alert(t('common.error'), t(chargeErrorKey(e)));
      setPhase('idle');
    }
  };

  const close = () => navigation.goBack();
  const scanAgain = () => navigation.navigate('MainTabs', { screen: 'ScanCharge' });

  // ── Outcomes ──
  if (phase === 'approved') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.resultTitle}>{t('scan.charge.paymentReceived')}</Text>
        <Text style={styles.resultAmount}>{formatCents(chargedCents)}</Text>
        <Text style={styles.resultSubtitle}>{t('scan.charge.fromCustomer', { name: customerName })}</Text>
        <View style={styles.resultBtn}>
          <PillButton label={t('common.done')} onPress={close} />
        </View>
      </DarkScreen>
    );
  }

  if (isOutcome(phase)) {
    const copy: Record<string, { title: string; message: string }> = {
      rejected: {
        title: t('scan.charge.paymentDeclined'),
        message: t('scan.charge.declinedMessage', { name: customerName }),
      },
      expired: {
        title: t('scan.charge.expiredTitle'),
        message: t('scan.charge.expiredMessage', { name: customerName }),
      },
      cancelled: {
        title: t('scan.charge.cancelledTitle'),
        message: t('scan.charge.nothingPaid'),
      },
      unknown: {
        title: t('scan.charge.unknownTitle'),
        message: t('scan.charge.unknownMessage'),
      },
    };
    const { title, message } = copy[phase];
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <View style={styles.failIcon}>
          <CloseIcon size={32} color="#FF6961" />
        </View>
        <Text style={styles.resultTitle}>{title}</Text>
        <Text style={styles.resultSubtitle}>{message}</Text>
        <View style={styles.resultBtn}>
          {phase !== 'unknown' ? (
            <PillButton label={t('scan.charge.scanAgain')} onPress={scanAgain} />
          ) : null}
          <PillButton
            label={t('common.close')}
            variant="glass"
            onPress={close}
            style={phase !== 'unknown' ? styles.secondBtn : undefined}
          />
        </View>
      </DarkScreen>
    );
  }

  // ── Waiting for the customer ──
  if (phase === 'waiting' || phase === 'cancelling') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <ActivityIndicator size="large" color={ACCENT} style={styles.spinner} />
        <Text style={styles.resultTitle}>{t('scan.charge.waitingApproval')}</Text>
        <Text style={styles.resultSubtitle}>{t('scan.charge.confirmMessage', { name: customerName })}</Text>
        <Text style={styles.waitingAmount}>{formatCents(chargedCents)}</Text>
        {reference.trim() ? (
          <Text style={styles.waitingRef}>{reference.trim()}</Text>
        ) : null}
        <Text style={styles.countdown}>
          {t('scan.charge.expiresIn', { time: formatClock(secondsLeft) })}
        </Text>
        {connectionLost ? (
          <Text style={styles.warning}>{t('scan.charge.connectionLost')}</Text>
        ) : null}
        <View style={styles.resultBtn}>
          <PillButton
            label={t('scan.charge.cancel')}
            variant="glass"
            loading={phase === 'cancelling'}
            disabled={phase === 'cancelling'}
            onPress={() => requestId && withdraw(requestId, 'waiting')}
          />
        </View>
      </DarkScreen>
    );
  }

  // ── Amount entry ──
  return (
    <DarkScreen edges={[]} keyboard contentStyle={styles.content}>
      <View style={styles.body}>
        <GlassCard style={styles.customerCard}>
          <Text style={styles.customerLabel}>{t('scan.charge.customerLabel')}</Text>
          <Text style={styles.customerName}>{customerName}</Text>
        </GlassCard>

        <Text style={styles.label}>{t('scan.charge.referenceLabel')}</Text>
        <GlassCard style={[styles.refCard, refFocused && styles.refCardFocused]}>
          <TextInput
            style={styles.refInput}
            placeholder={t('scan.charge.referencePlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={reference}
            onChangeText={setReference}
            returnKeyType="next"
            onFocus={() => setRefFocused(true)}
            onBlur={() => setRefFocused(false)}
          />
        </GlassCard>

        <Text style={[styles.label, styles.amountLabel]}>{t('scan.charge.amountLabel')}</Text>
        <GlassCard style={[styles.amountCard, focused && styles.amountCardFocused]}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={amount}
            onChangeText={(v) => setAmount(sanitizeAmountInput(v))}
            keyboardType="decimal-pad"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </GlassCard>
      </View>

      <View style={styles.footer}>
        <PillButton
          label={t('scan.charge.chargeCustomer')}
          onPress={handleCharge}
          loading={phase === 'sending'}
          disabled={toCents(amount) <= 0 || phase === 'sending'}
        />
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingTop: 20 },
  body: { flex: 1, paddingHorizontal: 24 },
  footer: { paddingHorizontal: 24, paddingBottom: 24 },

  customerCard: {
    padding: 20,
    alignItems: 'center',
    marginBottom: 28,
  },
  customerLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#FF8A7A',
    marginBottom: 6,
  },
  customerName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 12,
  },
  amountLabel: { marginTop: 20 },
  amountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 76,
  },
  amountCardFocused: {
    borderColor: ACCENT,
  },
  currency: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 40,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
    padding: 0,
  },

  // results
  resultWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  spinner: { marginBottom: 24 },
  failIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,59,48,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  resultAmount: {
    fontSize: 40,
    fontWeight: '800',
    color: '#34C77B',
    letterSpacing: -1.5,
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 15,
    color: TEXT_DIM,
    textAlign: 'center',
    lineHeight: 22,
  },
  waitingAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
    marginTop: 20,
  },
  waitingRef: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
    letterSpacing: 0.2,
  },
  countdown: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT_FAINT,
    marginTop: 16,
    fontVariant: ['tabular-nums'],
  },
  warning: {
    fontSize: 13,
    color: '#FF6961',
    textAlign: 'center',
    marginTop: 12,
  },
  refCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 52,
  },
  refCardFocused: {
    borderColor: ACCENT,
  },
  refInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    padding: 0,
  },
  resultBtn: {
    alignSelf: 'stretch',
    marginTop: 32,
  },
  secondBtn: { marginTop: 12 },
});
