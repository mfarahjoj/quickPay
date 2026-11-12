import React, { useState, useEffect, useRef } from 'react';
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
import { createPaymentRequest } from '../../services/scan.service';
import {
  DarkScreen,
  GlassCard,
  PillButton,
  PaidReferenceSheet,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import { SuccessCheckIcon, CloseIcon } from '../../components/icons/AuthIcons';
import {
  PriorPayment,
  priorPaymentFromError,
  shouldCheckPaidReference,
} from '../../utils/paidReference';
import { REFERENCE_MAX_LENGTH } from '../../utils/receiptParser';
import { triggerHaptic } from '../../services/haptics.service';

interface Props {
  route: { params: { tokenId: string; customerName: string; customerId: string } };
  navigation: any;
}

type RequestStatus = 'idle' | 'sending' | 'waiting' | 'approved' | 'rejected';

export default function ChargeScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { tokenId, customerName } = route.params;
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState<RequestStatus>('idle');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [refFocused, setRefFocused] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null);
  // The earlier payment of this reference, while the warning is up.
  const [prior, setPrior] = useState<PriorPayment | null>(null);

  useEffect(() => {
    if (!requestId) return;
    unsubRef.current = firestore()
      .collection('paymentRequests')
      .doc(requestId)
      .onSnapshot((doc) => {
        const data = doc.data();
        if (!data) return;
        if (data.status === 'approved') {
          if (typeof data.receiptNumber === 'string') setReceiptNumber(data.receiptNumber);
          setStatus('approved');
        }
        else if (data.status === 'rejected') setStatus('rejected');
      });
    return () => {
      if (unsubRef.current) unsubRef.current();
    };
  }, [requestId]);

  const handleCharge = async (chargeAgain = false) => {
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      Alert.alert(t('common.invalidAmount'), t('common.invalidAmountMessage'));
      return;
    }
    const ref = reference.trim() || undefined;
    try {
      setStatus('sending');
      const result = await createPaymentRequest(tokenId, Math.round(amountNum * 100), 'USD', ref, {
        checkPaidReference: !!ref && shouldCheckPaidReference(ref, null),
        confirmPaidReference: chargeAgain,
      });
      setPrior(null);
      setRequestId(result.requestId);
      setStatus('waiting');
    } catch (e: any) {
      setStatus('idle');
      const earlier = priorPaymentFromError(e);
      if (earlier) {
        triggerHaptic('medium');
        setPrior(earlier);
        return;
      }
      setPrior(null);
      Alert.alert(t('common.error'), e.message || t('scan.charge.createFailedMessage'));
    }
  };

  const handleDone = () => navigation.goBack();

  // ── Approved ──
  if (status === 'approved') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.resultTitle}>{t('scan.charge.paymentReceived')}</Text>
        <Text style={styles.resultAmount}>${parseFloat(amount).toFixed(2)}</Text>
        <Text style={styles.resultSubtitle}>{t('scan.charge.fromCustomer', { name: customerName })}</Text>
        {receiptNumber ? (
          <View style={styles.receiptPill}>
            <Text style={styles.receiptPillLabel}>{t('qr.paid.receipt')}</Text>
            <Text style={styles.receiptPillValue} selectable>
              {receiptNumber}
            </Text>
          </View>
        ) : null}
        <View style={styles.resultBtn}>
          <PillButton label={t('common.done')} onPress={handleDone} />
        </View>
      </DarkScreen>
    );
  }

  // ── Rejected ──
  if (status === 'rejected') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <View style={styles.failIcon}>
          <CloseIcon size={32} color="#FF6961" />
        </View>
        <Text style={styles.resultTitle}>{t('scan.charge.paymentDeclined')}</Text>
        <Text style={styles.resultSubtitle}>{t('scan.charge.declinedMessage', { name: customerName })}</Text>
        <View style={styles.resultBtn}>
          <PillButton label={t('common.tryAgain')} variant="glass" onPress={handleDone} />
        </View>
      </DarkScreen>
    );
  }

  // ── Waiting ──
  if (status === 'waiting') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <ActivityIndicator size="large" color={ACCENT} style={{ marginBottom: 24 }} />
        <Text style={styles.resultTitle}>{t('scan.charge.waitingApproval')}</Text>
        <Text style={styles.resultSubtitle}>{t('scan.charge.confirmMessage', { name: customerName })}</Text>
        <Text style={styles.waitingAmount}>${parseFloat(amount).toFixed(2)}</Text>
        {reference.trim() ? (
          <Text style={styles.waitingRef}>{reference.trim()}</Text>
        ) : null}
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

        <Text style={styles.label}>{t('scan.charge.referenceLabel', { defaultValue: 'ORDER / REFERENCE' })}</Text>
        <GlassCard style={[styles.refCard, refFocused && styles.refCardFocused]}>
          <TextInput
            style={styles.refInput}
            placeholder={t('scan.charge.referencePlaceholder', { defaultValue: 'e.g. Table 4, Order #12' })}
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={reference}
            onChangeText={setReference}
            returnKeyType="next"
            maxLength={REFERENCE_MAX_LENGTH}
            onFocus={() => setRefFocused(true)}
            onBlur={() => setRefFocused(false)}
          />
        </GlassCard>

        <Text style={[styles.label, { marginTop: 20 }]}>{t('scan.charge.amountLabel')}</Text>
        <GlassCard style={[styles.amountCard, focused && styles.amountCardFocused]}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </GlassCard>
      </View>

      <View style={styles.footer}>
        <PillButton
          label={t('scan.charge.chargeCustomer')}
          onPress={() => handleCharge()}
          loading={status === 'sending'}
          disabled={!amount}
        />
      </View>

      <PaidReferenceSheet
        prior={prior}
        amountCents={Math.round((parseFloat(amount) || 0) * 100)}
        loading={status === 'sending'}
        onCancel={() => setPrior(null)}
        onChargeAgain={() => handleCharge(true)}
      />
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
  receiptPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    marginTop: 12,
  },
  receiptPillLabel: {
    fontSize: 13,
    color: TEXT_FAINT,
  },
  receiptPillValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },
  resultWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
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
});
