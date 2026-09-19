import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  DarkScreen,
  ScreenHeader,
  GlassCard,
  PillButton,
  PinInput,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import {
  requestPayout,
  watchMyPayouts,
  PayoutRecord,
  PayoutRoute,
} from '../../services/payout.service';
import { toCents, formatCents, sanitizeAmountInput } from '../../utils/money';
import { callableErrorKey } from '../../utils/errors';

type Step = 'form' | 'pin' | 'sent';

const ROUTES: PayoutRoute[] = ['bank', 'zaad', 'edahab', 'cash'];

export default function PayoutScreen() {
  const { t } = useTranslation();

  const [step, setStep] = useState<Step>('form');
  const [amount, setAmount] = useState('');
  const [route, setRoute] = useState<PayoutRoute>('bank');
  const [destinationName, setDestinationName] = useState('');
  const [destinationRef, setDestinationRef] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);

  useEffect(() => watchMyPayouts(setPayouts), []);

  const amountCents = toCents(amount);
  const canSubmit =
    amountCents > 0 && destinationName.trim().length >= 2 && destinationRef.trim().length >= 3;

  const pending = useMemo(
    () => payouts.filter((p) => p.status === 'requested'),
    [payouts],
  );

  const submit = async (enteredPin: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await requestPayout({
        amountCents,
        route,
        destinationName: destinationName.trim(),
        destinationRef: destinationRef.trim(),
        pin: enteredPin,
      });
      setStep('sent');
      setAmount('');
    } catch (e: any) {
      setError(t(callableErrorKey(e), { defaultValue: e.message }));
      setStep('form');
    } finally {
      setPin('');
      setSubmitting(false);
    }
  };

  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('payout.pinTitle')}</Text>
        <Text style={styles.sub}>
          {t('payout.pinSubtitle', { amount: formatCents(amountCents) })}
        </Text>
        <PinInput
          value={pin}
          onChange={setPin}
          onComplete={submit}
          style={styles.pinInput}
        />
        <View style={styles.block}>
          <PillButton
            label={t('common.cancel')}
            variant="glass"
            onPress={() => {
              setPin('');
              setStep('form');
            }}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'sent') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.bigTitle}>{t('payout.sentTitle')}</Text>
        <Text style={styles.sub}>{t('payout.sentSubtitle')}</Text>
        <View style={styles.block}>
          <PillButton label={t('common.done')} onPress={() => setStep('form')} />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard>
      <ScreenHeader title={t('payout.title')} subtitle={t('payout.subtitle')} />

      <View style={styles.body}>
        <Text style={styles.label}>{t('payout.amountLabel')}</Text>
        <GlassCard style={styles.card}>
          <View style={styles.amountRow}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={(v) => setAmount(sanitizeAmountInput(v))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="rgba(255,255,255,0.2)"
            />
          </View>
        </GlassCard>

        <Text style={styles.label}>{t('payout.routeLabel')}</Text>
        <View style={styles.routeRow}>
          {ROUTES.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.routeChip, route === r && styles.routeChipActive]}
              onPress={() => setRoute(r)}
            >
              <Text style={[styles.routeText, route === r && styles.routeTextActive]}>
                {t(`payout.route.${r}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('payout.destinationLabel')}</Text>
        <GlassCard style={styles.card}>
          <TextInput
            style={styles.input}
            value={destinationName}
            onChangeText={setDestinationName}
            placeholder={t('payout.destinationNamePlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.25)"
            autoCapitalize="words"
          />
        </GlassCard>
        <GlassCard style={styles.card}>
          <TextInput
            style={styles.input}
            value={destinationRef}
            onChangeText={setDestinationRef}
            placeholder={t(
              route === 'zaad' || route === 'edahab'
                ? 'payout.destinationPhonePlaceholder'
                : 'payout.destinationAccountPlaceholder',
            )}
            placeholderTextColor="rgba(255,255,255,0.25)"
            autoCapitalize="none"
          />
        </GlassCard>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.hint}>{t('payout.hint')}</Text>

        <PillButton
          label={t('payout.submit')}
          onPress={() => {
            setError(null);
            setPin('');
            setStep('pin');
          }}
          disabled={!canSubmit || submitting}
        />

        <Text style={[styles.label, styles.historyLabel]}>
          {t('payout.historyLabel')}
        </Text>
        {payouts.length === 0 ? (
          <Text style={styles.hint}>{t('payout.historyEmpty')}</Text>
        ) : (
          payouts.map((p) => (
            <GlassCard key={p.id} style={styles.historyCard}>
              <View style={styles.historyRow}>
                <Text style={styles.historyAmount}>{formatCents(p.amountCents)}</Text>
                <Text
                  style={[
                    styles.status,
                    p.status === 'paid' && styles.statusPaid,
                    p.status === 'rejected' && styles.statusRejected,
                  ]}
                >
                  {t(`payout.status.${p.status}`)}
                </Text>
              </View>
              <Text style={styles.historyMeta}>
                {t(`payout.route.${p.route}`)} · {p.destinationRef}
              </Text>
              {p.status === 'paid' && p.externalReference ? (
                <Text style={styles.historyMeta}>
                  {t('payout.reference', { reference: p.externalReference })}
                </Text>
              ) : null}
              {p.status === 'rejected' && p.decisionReason ? (
                <Text style={styles.historyMeta}>{p.decisionReason}</Text>
              ) : null}
            </GlassCard>
          ))
        )}

        {pending.length > 0 ? (
          <Text style={styles.hint}>{t('payout.pendingHint')}</Text>
        ) : null}
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48, gap: 6 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 20,
  },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  pinInput: { marginTop: 28 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: TEXT_FAINT,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  historyLabel: { marginTop: 32 },
  card: { padding: 0, marginBottom: 4 },
  amountRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  currency: { fontSize: 28, fontWeight: '700', color: TEXT_DIM },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  input: { fontSize: 15, color: '#FFFFFF', padding: 16 },
  routeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  routeChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  routeChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  routeText: { fontSize: 13, fontWeight: '600', color: TEXT_DIM },
  routeTextActive: { color: '#FFFFFF' },
  hint: { fontSize: 12, color: TEXT_FAINT, marginVertical: 12, lineHeight: 17 },
  error: { fontSize: 13, color: '#FF6961', marginTop: 12 },
  historyCard: { padding: 14, marginBottom: 8, gap: 4 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyAmount: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  historyMeta: { fontSize: 12, color: TEXT_FAINT },
  status: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: TEXT_DIM, textTransform: 'uppercase' },
  statusPaid: { color: '#34C77B' },
  statusRejected: { color: '#FF6961' },
});
