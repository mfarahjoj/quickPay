import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { PinInput } from '../../components/PinInput';
import { triggerHaptic } from '../../services/haptics.service';
import { AgreementDetails, approveApiAgreement, getApiAgreement } from '../../services/apiAgreement.service';
import { typography, spacing, borderRadius, makeStyles, useColors } from '../../theme';
import { formatMoney } from '../../utils/money';
import { cooldownMessage } from '../../utils/cooldownMessage';

/**
 * A partner (Ridy) asks to take payments from the wallet, each one approved in
 * the partner's app on this phone with Face ID or the phone's passcode. The
 * customer reads what they are agreeing to — who, which phone, the limits,
 * how to switch it off — and approves with their PIN. Reached from
 * zapppay://agreement/{id}, which the partner's app opens.
 */
type Params = { ApproveAgreement: { agreementId: string } };
type Step = 'review' | 'pin' | 'done' | 'closed';

export default function ApproveAgreementScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { agreementId } = useRoute<RouteProp<Params, 'ApproveAgreement'>>().params;

  const [agreement, setAgreement] = useState<AgreementDetails | null>(null);
  const [step, setStep] = useState<Step>('review');
  const [message, setMessage] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = (text: string) => {
    setMessage(text);
    setStep('closed');
  };

  useEffect(() => {
    getApiAgreement(agreementId)
      .then((a) => {
        setAgreement(a);
        if (a.status === 'active') close(t('agreements.approve.alreadyLinked', { merchant: a.merchantName }));
        else if (a.status === 'expired') close(t('agreements.approve.expired'));
        else if (a.status === 'revoked') close(t('agreements.approve.revoked'));
      })
      .catch((e: any) => {
        const m: string = typeof e?.message === 'string' ? e.message : '';
        if (/different customer/i.test(m)) close(t('agreements.approve.someoneElse'));
        else if (/test request/i.test(m)) close(t('agreements.approve.testRequest'));
        else if (/own business/i.test(m)) close(t('agreements.approve.ownBusiness'));
        else close(t('agreements.approve.notFound'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId]);

  const approve = async (entered: string) => {
    if (!agreement || busy) return;
    setBusy(true);
    setError('');
    try {
      await approveApiAgreement(agreement, entered);
      triggerHaptic('success');
      setStep('done');
    } catch (e: any) {
      triggerHaptic('medium');
      setPin('');
      const m: string = typeof e?.message === 'string' ? e.message : '';
      if (e?.code === 'functions/permission-denied' && /invalid pin/i.test(m)) setError(t('auth.pinLogin.invalidPin'));
      else if (/expired/i.test(m)) close(t('agreements.approve.expired'));
      else if (/limits changed/i.test(m)) close(t('agreements.approve.limitsChanged'));
      else if (cooldownMessage(e, t)) setError(cooldownMessage(e, t)!);
      else if (e?.code === 'functions/resource-exhausted' && e?.details?.hardLocked) setError(t('pin.hardLocked'));
      else if (e?.code === 'functions/resource-exhausted' && e?.details?.secondsLeft) {
        setError(t('pin.lockedOut', { seconds: e.details.secondsLeft }));
      } else setError(t('agreements.approve.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'closed' || step === 'done') {
    const done = step === 'done';
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.title}>{done ? t('agreements.approve.doneTitle') : t('agreements.approve.unavailableTitle')}</Text>
        <Text style={styles.body}>
          {done ? t('agreements.approve.doneBody', { merchant: agreement?.merchantName ?? '' }) : message}
        </Text>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('common.done')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!agreement) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.ui.accent} />
      </View>
    );
  }

  const perPayment = formatMoney(agreement.maxChargeUsdCents, 'USD');
  const perDay = formatMoney(agreement.dailyUsdCents, 'USD');
  const device = agreement.deviceLabel || t('agreements.approve.thisPhone');

  if (step === 'pin') {
    return (
      <View style={styles.container}>
        <Text style={[styles.title, styles.center]}>{t('agreements.approve.pinTitle')}</Text>
        <Text style={[styles.body, styles.center]}>{t('agreements.approve.pinBody', { merchant: agreement.merchantName })}</Text>
        <PinInput value={pin} onChange={setPin} onComplete={approve} secure style={styles.pin} />
        {busy ? <ActivityIndicator color={colors.ui.accent} style={styles.spinner} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.back} onPress={() => { setPin(''); setError(''); setStep('review'); }} disabled={busy}>
          <Text style={styles.backText}>{t('payments.approve.backToReview')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{agreement.merchantName.charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={[styles.title, styles.center]}>
        {t('agreements.approve.title', { merchant: agreement.merchantName })}
      </Text>

      <View style={styles.card}>
        <Point text={t('agreements.approve.eachPayment', { merchant: agreement.merchantName, device })} />
        <Point text={t('agreements.approve.limits', { perPayment, perDay })} />
        <Point text={t('agreements.approve.notify')} />
        <Point text={t('agreements.approve.switchOff')} />
      </View>
      <Text style={styles.warning}>{t('agreements.approve.notYourPhone')}</Text>

      <TouchableOpacity
        style={styles.primary}
        onPress={() => { triggerHaptic('medium'); setStep('pin'); }}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{t('agreements.approve.link')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={() => navigation.goBack()} accessibilityRole="button">
        <Text style={styles.secondaryText}>{t('agreements.approve.decline')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Point({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.point}>
      <Text style={styles.bullet}>•</Text>
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ui.canvas, paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  scroll: { paddingBottom: spacing.xxl },
  centered: { justifyContent: 'center', alignItems: 'center' },
  center: { textAlign: 'center' },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.ui.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { ...typography.h1, color: colors.ui.accentText },
  title: { ...typography.h2, color: colors.ui.text, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.ui.textDim, textAlign: 'center', marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  point: { flexDirection: 'row', gap: spacing.sm },
  bullet: { ...typography.body, color: colors.ui.accentText },
  pointText: { ...typography.body, color: colors.ui.text, flex: 1 },
  warning: { ...typography.caption, color: colors.ui.textDim, marginBottom: spacing.lg },
  primary: {
    backgroundColor: colors.ui.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: spacing.sm,
  },
  primaryText: { ...typography.h3, color: '#FFFFFF' },
  secondary: { paddingVertical: spacing.md, alignItems: 'center' },
  secondaryText: { ...typography.bodySemibold, color: colors.ui.textDim },
  pin: { marginHorizontal: spacing.md, marginVertical: spacing.lg },
  spinner: { marginBottom: spacing.md },
  error: { ...typography.body, color: colors.ui.error, textAlign: 'center', marginBottom: spacing.md },
  back: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  backText: { ...typography.bodySemibold, color: colors.ui.accentText },
}));
