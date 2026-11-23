import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useNavigation } from '@react-navigation/native';
import firestore from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import { functions } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';
import { makeStyles, useColors } from '../../theme';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import { AnimatedXMark } from '../../components/icons/StatusIcons';
import { useWallet } from '../../hooks/useWallet';
import { useHomeCurrency } from '../../hooks/useHomeCurrency';
import { amountInputUnits, formatMoney, type Currency } from '../../utils/money';
import { useAuth } from '../../hooks/useAuth';
import { useZaadAgentTopups } from '../../hooks/useZaadTopups';
import { requestZaadAgentTopup } from '../../services/zaadAgent.service';
import ZaadRequestView, { AgentHeader } from './ZaadRequestView';

/**
 * "Top up with an agent" (ZAPP_AGENT_TOPUP_ONE_FLOW_PLAN.md, D18): one method,
 * in person or remote, cash or Zaad.
 *
 *   amount → choose: "I'm with an agent" → code (the agent scans it)
 *                       → cash: "Hand $10 to Ahmed" (T6) → done
 *                       → Zaad: the agent chose it at the scan → zaad
 *            "Find me an agent" (Zaad, dollars; only when the switch is on) → zaad
 *   zaad: the shared Zaad request view (ZaadRequestView)
 */
type Step = 'amount' | 'choose' | 'processing' | 'code' | 'zaad' | 'done' | 'error';
const ACTIVE_ZAAD = ['offered', 'accepted', 'customer_sent', 'declined', 'disputed'];

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
const TOPUP_REQUESTS = 'agentTopupRequests';

// Encoded in the QR the agent scans. The id names this one request, so the
// code can't be confirmed against another customer's; typing the code by hand,
// the agent gives the customer's phone number instead.
function qrPayload(id: string, code: string): string {
  return JSON.stringify({ type: 'zapp_topup', id, code });
}

function shortConfirmation(id: string): string {
  return `ZP-${id.slice(-6).toUpperCase()}`;
}

export default function AgentTopupScreen({ initialWay }: { initialWay?: 'remote' } = {}) {
  const colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('amount');
  const [amountText, setAmountText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  /** The code ran out unconfirmed: offer the "I gave the agent cash" claim. */
  const [lapsed, setLapsed] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [requestId, setRequestId] = useState('');
  const [confirmationId, setConfirmationId] = useState('');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const unsubRef = useRef<(() => void) | null>(null);
  /** The customer is cancelling: the request closing is theirs, not a lapse. */
  const cancellingRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  /** Set once an agent has scanned the code: who to hand the cash to (D23). */
  const [scannedByName, setScannedByName] = useState<string | null>(null);
  const [zaadRequestId, setZaadRequestId] = useState<string | null>(null);
  const [cashAgent, setCashAgent] = useState<string | null>(null);
  const { user } = useAuth();
  const zaadOpen = useZaadAgentTopups();

  // Dollars or shillings: the agent's cash in that currency goes to that
  // balance. Starts on the currency Home shows.
  const { wallet } = useWallet();
  const { currency: homeCurrency } = useHomeCurrency(wallet?.balanceCents ?? 0, wallet?.slsBalance ?? 0);
  const [pickedCurrency, setPickedCurrency] = useState<Currency | null>(null);
  const currency = pickedCurrency ?? homeCurrency;

  /** Cents or whole shillings: what the server takes. */
  const amountUnits = amountInputUnits(amountText, currency);
  const amountLabel = formatMoney(amountUnits, currency);
  const amount = amountUnits;

  const pickCurrency = (next: Currency) => {
    if (next === currency) return;
    triggerHaptic('light');
    setPickedCurrency(next);
    // 4.70 dollars is not 4.70 shillings: start the amount again.
    setAmountText('');
  };

  // Countdown timer for code expiry
  useEffect(() => {
    if (!expiresAt || step !== 'code') return;
    const tick = () => {
      const diff = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      setTimeLeft(Math.max(0, diff));
      if (diff <= 0) {
        setErrorMsg(t('topup.agent.expiredMessage'));
        setLapsed(true);
        setStep('error');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, step, t]);

  // Live listener — the agent's confirmation updates the request doc, and we
  // reflect it instantly (backed up by a push notification).
  useEffect(() => {
    if (!requestId) return;
    const unsub = firestore()
      .collection(TOPUP_REQUESTS)
      .doc(requestId)
      .onSnapshot((snap) => {
        const data = snap.data();
        if (!data) return;
        if (data.status === 'completed') {
          setConfirmationId(data.confirmationId || data.transactionId || '');
          setCashAgent(data.scannedByName ?? null);
          triggerHaptic('success');
          setStep('done');
        } else if (data.status === 'moved_to_zaad' && data.zaadRequestId) {
          // The agent chose Zaad at the scan: carry on as a Zaad top-up.
          setZaadRequestId(data.zaadRequestId);
          setStep('zaad');
        } else if (data.status === 'pending' && data.scannedByName) {
          setScannedByName(data.scannedByName);
        } else if (data.status === 'cancelled' && cancellingRef.current) {
          // Closed by this phone's own cancel: cancelRequest takes it from here.
        } else if (data.status === 'expired' || data.status === 'cancelled') {
          setErrorMsg(t('topup.agent.expiredMessage'));
          setLapsed(true);
          setStep('error');
        }
      });
    unsubRef.current = unsub;
    return () => {
      unsub();
      unsubRef.current = null;
    };
  }, [requestId, t]);

  useEffect(() => () => unsubRef.current?.(), []);

  // Opened again with a top-up under way: go straight to where it is.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const since = firestore.Timestamp.fromMillis(Date.now() - 2 * 3600 * 1000);
        const zaad = await firestore()
          .collection('zaadAgentTopups')
          .where('customerId', '==', user.uid)
          .where('createdAt', '>=', since)
          .get();
        const open = zaad.docs.find((d) => ACTIVE_ZAAD.includes(d.get('status')));
        if (cancelled) return;
        if (open) {
          setZaadRequestId(open.id);
          setStep('zaad');
          return;
        }
        const cash = await firestore()
          .collection(TOPUP_REQUESTS)
          .where('customerId', '==', user.uid)
          .where('status', '==', 'pending')
          .limit(1)
          .get();
        const pending = cash.docs[0];
        const doc = pending?.data() as
          | { otpCode: string; amount: number; currency?: string; expiresAt?: { toDate(): Date } }
          | undefined;
        const exp = doc?.expiresAt?.toDate();
        if (cancelled || !pending || !doc || !exp || exp.getTime() < Date.now()) return;
        setOtpCode(doc.otpCode);
        setRequestId(pending.id);
        setPickedCurrency(doc.currency === 'SLS' ? 'SLS' : 'USD');
        setAmountText(doc.currency === 'SLS' ? String(doc.amount) : (doc.amount / 100).toFixed(2));
        setExpiresAt(exp);
        setStep('code');
      } catch {
        // Nothing to resume, or offline: start from the amount.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const findAgent = useCallback(async () => {
    if (amountUnits <= 0 || currency !== 'USD') return;
    triggerHaptic('medium');
    setStep('processing');
    try {
      const res = await requestZaadAgentTopup(amountUnits);
      setZaadRequestId(res.requestId);
      setStep('zaad');
    } catch (e: any) {
      if (e?.details?.reason === 'in_progress' && e.details.requestId) {
        setZaadRequestId(e.details.requestId);
        setStep('zaad');
        return;
      }
      setErrorMsg(e?.message || t('common.error'));
      setStep('error');
    }
  }, [amountUnits, currency, t]);

  const appendDigit = (key: string) => {
    triggerHaptic('light');
    if (key === '⌫') {
      setAmountText((p) => p.slice(0, -1));
      return;
    }
    // Shillings are whole; dollars take two decimals.
    if (key === '.' && (currency === 'SLS' || amountText.includes('.'))) return;
    const decimals = amountText.split('.')[1];
    if (decimals !== undefined && decimals.length >= 2) return;
    if (amountText.replace('.', '').length >= 9) return;
    setAmountText((p) => (p === '0' && key !== '.' ? key : p + key));
  };

  const handleGenerate = useCallback(async () => {
    if (amountUnits <= 0) return;
    triggerHaptic('medium');
    setStep('processing');
    try {
      const fn = functions().httpsCallable('customerRequestAgentTopup');
      const result = await fn({ amount: amountUnits, currency });
      const data = (result.data as any).data;
      setOtpCode(data.otpCode);
      setRequestId(data.requestId);
      setExpiresAt(new Date(data.expiresAt));
      setTimeLeft(
        Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
      );
      setStep('code');
    } catch (e: any) {
      setErrorMsg(e.message || t('common.error'));
      setStep('error');
    }
  }, [amountUnits, currency, t]);

  // A choice of one is no choice: with Zaad through agents off there is only
  // "with an agent", so Continue makes the code. Opened as "find me an agent"
  // with dollars, Continue finds one.
  const onContinue = () => {
    if (amountUnits <= 0) return;
    if (!zaadOpen) {
      handleGenerate();
    } else if (initialWay === 'remote' && currency === 'USD') {
      findAgent();
    } else {
      setStep('choose');
    }
  };

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const reset = () => {
    unsubRef.current?.();
    unsubRef.current = null;
    cancellingRef.current = false;
    setCancelling(false);
    setCancelError('');
    setStep('amount');
    setAmountText('');
    setErrorMsg('');
    setLapsed(false);
    setOtpCode('');
    setRequestId('');
    setConfirmationId('');
    setExpiresAt(null);
    setScannedByName(null);
    setZaadRequestId(null);
    setCashAgent(null);
  };

  /** Close the code so no agent can confirm it (customerCancelAgentTopup). */
  const cancelRequest = useCallback(async () => {
    if (!requestId || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    setCancelError('');
    try {
      const fn = functions().httpsCallable('customerCancelAgentTopup');
      const res = (await fn({ requestId })).data as {
        data: { status: string; zaadRequestId?: string };
      };
      if (res.data.status === 'moved_to_zaad' && res.data.zaadRequestId) {
        // The agent switched it to Zaad first: that request has its own cancel.
        cancellingRef.current = false;
        setCancelling(false);
        setZaadRequestId(res.data.zaadRequestId);
        setStep('zaad');
        return;
      }
      triggerHaptic('light');
      reset();
    } catch (e: any) {
      cancellingRef.current = false;
      setCancelling(false);
      // Already completed: the listener shows the receipt.
      if (e?.details?.reason !== 'completed') setCancelError(e?.message || t('common.error'));
    }
  }, [requestId, t]);

  const askCancel = () => {
    triggerHaptic('light');
    Alert.alert(
      t('topup.agentFlow.cancelTitle'),
      scannedByName
        ? t('topup.agentFlow.cancelBodyScanned', { agent: scannedByName })
        : t('topup.agentFlow.cancelBody'),
      [
        { text: t('topup.agentFlow.keep'), style: 'cancel' },
        { text: t('topup.agentFlow.cancelConfirm'), style: 'destructive', onPress: cancelRequest },
      ],
    );
  };

  const cancelLink = (
    <View style={styles.cancelArea}>
      {cancelError ? <Text style={styles.cancelError}>{cancelError}</Text> : null}
      {cancelling ? (
        <ActivityIndicator size="small" color={colors.ui.ink(0.5)} />
      ) : (
        <TouchableOpacity onPress={askCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>{t('topup.agentFlow.cancel')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const backHeader = (title: string) => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backArrow}>‹</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );

  // ── Zaad: in person after the agent chose it, or remote ──
  if (step === 'zaad' && zaadRequestId) {
    return (
      <View style={styles.container}>
        {backHeader(t('topup.agentFlow.title'))}
        <ZaadRequestView requestId={zaadRequestId} onStartOver={reset} />
      </View>
    );
  }

  // ── With an agent, or find one ─────────────────────────
  if (step === 'choose') {
    const zaadDollars = currency === 'USD';
    return (
      <View style={styles.container}>
        {backHeader(t('topup.agentFlow.title'))}
        <View style={styles.chooseBody}>
          <Text style={styles.chooseAmount}>{amountLabel}</Text>
          <TouchableOpacity style={styles.chooseCard} onPress={handleGenerate} activeOpacity={0.85}>
            <Text style={styles.chooseTitle}>{t('topup.agentFlow.withAgent')}</Text>
            <Text style={styles.chooseSub}>
              {t(zaadOpen && zaadDollars ? 'topup.agentFlow.withAgentSubZaad' : 'topup.agentFlow.withAgentSubCash')}
            </Text>
          </TouchableOpacity>
          {zaadOpen ? (
            <TouchableOpacity
              style={[styles.chooseCard, !zaadDollars && styles.continueBtnDisabled]}
              onPress={findAgent}
              disabled={!zaadDollars}
              activeOpacity={0.85}
            >
              <Text style={styles.chooseTitle}>{t('topup.agentFlow.findAgent')}</Text>
              <Text style={styles.chooseSub}>
                {/* D30 */}
                {t(zaadDollars ? 'topup.agentFlow.findAgentSub' : 'topup.agentFlow.zaadDollarsOnly')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => setStep('amount')}>
            <Text style={styles.changeAmount}>{t('topup.agentFlow.changeAmount')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Done: topped up ────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('topup.agent.successTitle')}</Text>
        </View>
        <View style={styles.resultCenter}>
          <SuccessCheckIcon size={64} />
          <Text style={styles.doneTitle}>{t('topup.agent.toppedUp')}</Text>
          <Text style={styles.doneAmount} numberOfLines={1}>
            {amountLabel}
          </Text>
          {confirmationId ? (
            <View style={styles.confBox}>
              <Text style={styles.confLabel}>{t('topup.agent.confirmationId')}</Text>
              <Text style={styles.confValue}>{shortConfirmation(confirmationId)}</Text>
              {cashAgent ? (
                <Text style={styles.receiptLine}>{t('topup.agentFlow.receipt.agent', { agent: cashAgent })}</Text>
              ) : null}
              <Text style={styles.receiptLine}>{t('topup.agentFlow.receipt.paidByCash')}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
          >
            <Text style={styles.continueBtnText}>{t('common.done')}</Text>
          </TouchableOpacity>
          {confirmationId ? (
            <TouchableOpacity
              style={styles.cashClaim}
              onPress={() => navigation.navigate('RaiseDispute', { transactionId: confirmationId })}
            >
              <Text style={styles.cashClaimText}>{t('topup.agentFlow.somethingWrong')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Error ──────────────────────────────────────────────
  if (step === 'error') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('topup.agent.title')}</Text>
        </View>
        <View style={styles.resultCenter}>
          <AnimatedXMark size={56} />
          <Text style={styles.errorTitle}>{t('topup.agent.failedTitle')}</Text>
          <Text style={styles.errorSub}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reset}>
            <Text style={styles.retryText}>{t('common.tryAgain')}</Text>
          </TouchableOpacity>
          {lapsed && requestId ? (
            <TouchableOpacity
              style={styles.cashClaim}
              onPress={() => navigation.navigate('RaiseDispute', { agentTopupRequestId: requestId })}
            >
              <Text style={styles.cashClaimText}>{t('topup.agent.gaveCashNotCredited')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Processing ─────────────────────────────────────────
  if (step === 'processing') {
    return (
      <View style={[styles.container, styles.resultCenter]}>
        <ActivityIndicator size="large" color={colors.ui.accentText} />
        <Text style={styles.processingText}>{t('topup.agent.generating')}</Text>
      </View>
    );
  }

  // ── Show code + QR, waiting for agent ──────────────────
  if (step === 'code' && scannedByName) {
    // T6: shown only once an agent has scanned and their float covered it.
    return (
      <View style={styles.container}>
        {backHeader(t('topup.agentFlow.title'))}
        <View style={styles.chooseBody}>
          <AgentHeader name={scannedByName} amount={amountLabel} />
          <Text style={styles.handCash}>
            {t('topup.agentFlow.handCash', { amount: amountLabel, agent: scannedByName })}
          </Text>
          <Text style={styles.chooseSub}>{t('topup.agentFlow.handCashHint', { agent: scannedByName })}</Text>
          <View style={styles.waitingRow}>
            <ActivityIndicator size="small" color={colors.ui.ink(0.5)} />
            <Text style={styles.waitingText}>{t('topup.agentFlow.waitingConfirm', { agent: scannedByName })}</Text>
          </View>
          {cancelLink}
        </View>
      </View>
    );
  }

  if (step === 'code') {
    const warn = timeLeft < 120;
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('topup.agent.showAgentTitle')}</Text>
        </View>

        <View style={styles.codeContainer}>
          <View style={styles.qrCard}>
            <QRCode
              value={qrPayload(requestId, otpCode)}
              size={188}
              color="#000000"
              backgroundColor="#FFFFFF"
            />
          </View>

          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>{t('topup.agent.orEnterCode')}</Text>
            <View style={styles.codeDigits}>
              {otpCode.split('').map((digit, i) => (
                <View key={i} style={styles.codeDigitBox}>
                  <Text style={styles.codeDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.codeAmount}>
              {t('topup.agent.payAgent', { amount: amountLabel })}
            </Text>
          </View>

          <View style={[styles.timerRow, warn && styles.timerWarn]}>
            <Text style={[styles.timerText, warn && styles.timerTextWarn]}>
              {t('topup.agent.expiresIn', { time: formatTime(timeLeft) })}
            </Text>
          </View>

          <View style={styles.waitingRow}>
            <ActivityIndicator size="small" color={colors.ui.ink(0.5)} />
            <Text style={styles.waitingText}>{t('topup.agent.waiting')}</Text>
          </View>
          {cancelLink}
        </View>
      </View>
    );
  }

  // ── Amount entry ───────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>{t('topup.agentFlow.title')}</Text>
          <Text style={styles.headerSub}>
            {t(initialWay === 'remote' ? 'topup.agentFlow.findAgentSub' : 'topup.agentFlow.subtitle')}
          </Text>
        </View>
      </View>

      <View style={styles.amountSection}>
        <View style={styles.segment} accessibilityRole="tablist">
          {(['SLS', 'USD'] as Currency[]).map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.segmentItem, currency === c && styles.segmentItemOn]}
              onPress={() => pickCurrency(c)}
              accessibilityRole="tab"
              accessibilityState={{ selected: currency === c }}
            >
              <Text style={[styles.segmentText, currency === c && styles.segmentTextOn]}>
                {c === 'SLS' ? t('topup.zaad.shillings') : t('topup.zaad.dollars')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.amountLabel}>{t('topup.agent.amountLabel')}</Text>
        <View style={styles.amountRow}>
          {currency === 'USD' && <Text style={styles.amountCurrency}>$</Text>}
          <Text
            style={[styles.amountDisplay, !amountText && styles.amountPlaceholder]}
            numberOfLines={1}
          >
            {currency === 'SLS'
              ? formatMoney(amountUnits, 'SLS').replace(' SLSH', '')
              : amountText || '0.00'}
          </Text>
          {currency === 'SLS' && <Text style={styles.amountSuffix}>SLSH</Text>}
        </View>
        <Text style={styles.amountHint}>{t('topup.agent.amountHint')}</Text>
      </View>

      <View style={styles.keypad}>
        {KEYPAD.map((key) => {
          // Shillings have no smaller unit, so no decimal point.
          const hidden = key === '.' && currency === 'SLS';
          return (
            <TouchableOpacity
              key={key}
              style={[styles.key, key === '⌫' && styles.keyDelete, hidden && styles.keyHidden]}
              onPress={() => appendDigit(key)}
              disabled={hidden}
              activeOpacity={0.6}
            >
              <Text style={[styles.keyText, key === '⌫' && styles.keyDeleteText]}>{key}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, amount <= 0 && styles.continueBtnDisabled]}
          onPress={onContinue}
          disabled={amount <= 0}
          activeOpacity={0.8}
        >
          <Text style={styles.continueBtnText}>{t('common.continue')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ui.ink(0.06),
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 24, color: colors.ui.text, lineHeight: 28 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.ui.text, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: colors.ui.ink(0.4), marginTop: 2 },

  // Amount entry
  amountSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  amountLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ui.ink(0.4), marginBottom: 16 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 },
  amountCurrency: { fontSize: 36, fontWeight: '700', color: colors.ui.text, marginBottom: 6, marginRight: 4 },
  amountSuffix: { fontSize: 24, fontWeight: '700', color: colors.ui.text, marginBottom: 10, marginLeft: 8 },
  amountDisplay: { fontSize: 56, fontWeight: '800', color: colors.ui.text, letterSpacing: -2, flexShrink: 1 },
  segment: {
    flexDirection: 'row', alignSelf: 'center', padding: 4, borderRadius: 14,
    backgroundColor: colors.ui.ink(0.06), marginBottom: 24,
  },
  segmentItem: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10 },
  segmentItemOn: { backgroundColor: colors.ui.accentText },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.ui.ink(0.6) },
  segmentTextOn: { color: colors.ui.onSolid },
  keyHidden: { opacity: 0 },
  amountPlaceholder: { color: colors.ui.ink(0.2) },
  amountHint: { fontSize: 13, color: colors.ui.ink(0.35) },

  // Keypad
  keypad: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24, gap: 12, justifyContent: 'center', paddingBottom: 24 },
  key: { width: 88, height: 56, borderRadius: 14, backgroundColor: colors.ui.ink(0.07), alignItems: 'center', justifyContent: 'center' },
  keyDelete: { backgroundColor: 'transparent' },
  keyText: { fontSize: 22, fontWeight: '600', color: colors.ui.text },
  keyDeleteText: { fontSize: 20, color: colors.ui.ink(0.6) },

  footer: { paddingHorizontal: 24, paddingBottom: 36 },
  continueBtn: { height: 56, borderRadius: 28, backgroundColor: colors.ui.accentText, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', marginTop: 28 },
  continueBtnDisabled: { opacity: 0.35 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },

  // Code + QR
  codeContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  qrCard: { padding: 16, borderRadius: 20, backgroundColor: '#FFFFFF' },
  codeBox: { width: '100%', backgroundColor: colors.ui.ink(0.05), borderWidth: 1, borderColor: colors.ui.ink(0.1), borderRadius: 20, padding: 20, alignItems: 'center', gap: 12 },
  codeLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, color: colors.ui.ink(0.45) },
  codeDigits: { flexDirection: 'row', gap: 8 },
  codeDigitBox: { width: 40, height: 50, borderRadius: 10, backgroundColor: 'rgba(255,138,122,0.12)', borderWidth: 1, borderColor: 'rgba(255,138,122,0.35)', alignItems: 'center', justifyContent: 'center' },
  codeDigitText: { fontSize: 26, fontWeight: '800', color: colors.ui.accentText, letterSpacing: -0.5 },
  codeAmount: { fontSize: 14, color: colors.ui.ink(0.5) },
  timerRow: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(52,199,123,0.1)', borderWidth: 1, borderColor: 'rgba(52,199,123,0.3)' },
  timerWarn: { backgroundColor: 'rgba(255,92,92,0.1)', borderColor: 'rgba(255,92,92,0.3)' },
  timerText: { fontSize: 14, fontWeight: '600', color: colors.ui.incoming },
  timerTextWarn: { color: colors.ui.error },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitingText: { fontSize: 13, color: colors.ui.ink(0.45) },

  // Done
  doneTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, marginTop: 20 },
  doneAmount: { fontSize: 44, fontWeight: '800', color: colors.ui.incoming, letterSpacing: -2, marginTop: 8 },
  confBox: { marginTop: 24, alignItems: 'center', backgroundColor: colors.ui.ink(0.05), borderRadius: 16, paddingVertical: 16, paddingHorizontal: 28 },
  confLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ui.ink(0.4) },
  confValue: { fontSize: 22, fontWeight: '800', color: colors.ui.text, marginTop: 4, letterSpacing: 1 },

  // Result shared
  resultCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 22, fontWeight: '800', color: colors.ui.text, marginTop: 20, marginBottom: 10 },
  errorSub: { fontSize: 14, color: colors.ui.ink(0.45), textAlign: 'center', lineHeight: 21 },
  retryBtn: { marginTop: 28, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24, backgroundColor: colors.ui.ink(0.08) },
  retryText: { fontSize: 16, fontWeight: '600', color: colors.ui.text },
  cashClaim: { marginTop: 18, padding: 8 },
  cashClaimText: { fontSize: 14, fontWeight: '600', color: colors.ui.accentText, textAlign: 'center' },
  processingText: { fontSize: 16, color: colors.ui.ink(0.5), marginTop: 20 },

  // Choose: with an agent, or find one
  chooseBody: { flex: 1, paddingHorizontal: 24, paddingTop: 12, gap: 14 },
  chooseAmount: { fontSize: 40, fontWeight: '800', color: colors.ui.text, textAlign: 'center', letterSpacing: -1, marginBottom: 8 },
  chooseCard: {
    backgroundColor: colors.ui.ink(0.05), borderWidth: 1, borderColor: colors.ui.ink(0.1),
    borderRadius: 18, padding: 18, gap: 4,
  },
  chooseTitle: { fontSize: 17, fontWeight: '700', color: colors.ui.text },
  chooseSub: { fontSize: 14, color: colors.ui.ink(0.5), lineHeight: 20 },
  changeAmount: { fontSize: 14, color: colors.ui.accentText, textAlign: 'center', paddingVertical: 8 },
  handCash: { fontSize: 24, fontWeight: '800', color: colors.ui.text, lineHeight: 30, marginTop: 8 },
  receiptLine: { fontSize: 13, color: colors.ui.ink(0.5), marginTop: 6 },

  // Cancel the code
  cancelArea: { alignItems: 'center', gap: 8, minHeight: 36, justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: colors.ui.error, paddingVertical: 8, paddingHorizontal: 16 },
  cancelError: { fontSize: 13, color: colors.ui.error, textAlign: 'center' },
}));
