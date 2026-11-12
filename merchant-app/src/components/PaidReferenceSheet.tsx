import React from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PillButton, TEXT_DIM, TEXT_FAINT } from './DarkScreen';
import { PriorPayment } from '../utils/paidReference';
import { formatCents } from '../utils/money';

interface PaidReferenceSheetProps {
  /** The earlier payment, or null to hide the sheet. */
  prior: PriorPayment | null;
  /** What the merchant is about to charge, in cents. */
  amountCents: number;
  onCancel: () => void;
  onChargeAgain: () => void;
  loading?: boolean;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/**
 * Shown when the merchant is about to charge an invoice that has already been
 * paid. Not charging is the primary action: the common case is a waiter who
 * didn't know the table had paid at the counter.
 */
export function PaidReferenceSheet({
  prior,
  amountCents,
  onCancel,
  onChargeAgain,
  loading,
}: PaidReferenceSheetProps) {
  const { t } = useTranslation();
  const when = prior ? formatWhen(prior.paidAt) : '';

  return (
    <Modal visible={!!prior} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissArea} onPress={onCancel} activeOpacity={1} />
        {prior ? (
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.badge}>
              <Text style={styles.badgeText}>{t('paidRef.badge')}</Text>
            </View>
            <Text style={styles.title}>{t('paidRef.title', { reference: prior.reference })}</Text>
            <Text style={styles.subtitle}>
              {t('paidRef.subtitle', { amount: formatCents(amountCents) })}
            </Text>

            <View style={styles.card}>
              <Row label={t('paidRef.amount')} value={formatCents(prior.amount)} strong />
              {prior.paidByName ? <Row label={t('paidRef.by')} value={prior.paidByName} /> : null}
              {when ? <Row label={t('paidRef.when')} value={when} /> : null}
              <Row label={t('paidRef.receipt')} value={prior.receiptNumber} mono last={prior.count < 2} />
              {prior.count > 1 ? (
                <Row label={t('paidRef.timesLabel')} value={t('paidRef.times', { count: prior.count })} last />
              ) : null}
            </View>

            <View style={styles.actions}>
              <PillButton label={t('paidRef.cancel')} onPress={onCancel} disabled={loading} />
              <PillButton
                label={t('paidRef.chargeAgain')}
                variant="glass"
                onPress={onChargeAgain}
                loading={loading}
              />
            </View>
          </SafeAreaView>
        ) : null}
      </View>
    </Modal>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
  last,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, strong && styles.rowValueStrong, mono && styles.rowValueMono]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const AMBER = '#FFB020';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: '#111113',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,176,32,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,176,32,0.35)',
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: AMBER,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: TEXT_DIM,
    marginTop: 6,
    marginBottom: 20,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    gap: 16,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  rowLabel: {
    fontSize: 14,
    color: TEXT_FAINT,
  },
  rowValue: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'right',
  },
  rowValueStrong: {
    fontSize: 17,
    fontWeight: '800',
  },
  rowValueMono: {
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  actions: {
    gap: 12,
  },
});
