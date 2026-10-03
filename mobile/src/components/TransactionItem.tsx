import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Transaction } from '../types';
import { colors, typography, spacing, borderRadius } from '../theme';
import { CURRENCY_SYMBOL } from '../config/constants';

interface TransactionItemProps {
  transaction: Transaction;
  onPress?: () => void;
}

export function TransactionItem({ transaction, onPress }: TransactionItemProps) {
  const { t } = useTranslation();
  // A cancelled or expired cash-out returned its money: never show it as spent.
  const voided = transaction.status === 'cancelled' || transaction.status === 'failed';
  const pending = transaction.status === 'pending';

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <View
        style={[
          styles.icon,
          {
            backgroundColor: transaction.isIncoming
              ? colors.dark.incomingSoft
              : colors.dark.warningSoft,
          },
        ]}
      >
        <Text style={styles.iconText}>
          {transaction.isIncoming
            ? t('transaction.direction.incoming')
            : t('transaction.direction.outgoing')}
        </Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {transaction.description}
        </Text>
        <Text style={styles.date}>{transaction.createdAt.toLocaleDateString()}</Text>
      </View>

      <View style={styles.right}>
        <Text
          style={[
            styles.amount,
            transaction.isIncoming ? styles.amountIncoming : styles.amountOutgoing,
            voided && styles.amountVoided,
          ]}
        >
          {transaction.isIncoming ? '+' : '-'}
          {CURRENCY_SYMBOL}
          {transaction.amount.toFixed(2)}
        </Text>
        {voided || pending ? (
          <Text style={styles.statusText}>
            {t(`transaction.status.${transaction.status}`)}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  iconText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text.primary,
  },
  info: {
    flex: 1,
  },
  name: {
    ...typography.body,
    fontWeight: '500',
    color: colors.text.primary,
    marginBottom: 2,
  },
  date: {
    ...typography.caption,
    color: colors.text.muted,
  },
  right: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: typography.tabularAmount.fontSize,
    fontWeight: typography.tabularAmount.fontWeight,
    lineHeight: typography.tabularAmount.lineHeight,
    fontVariant: ['tabular-nums'],
  },
  amountIncoming: {
    color: colors.success,
  },
  amountOutgoing: {
    color: colors.text.primary,
  },
  amountVoided: {
    color: colors.text.muted,
    textDecorationLine: 'line-through',
  },
  statusText: {
    ...typography.caption,
    color: colors.text.muted,
    marginTop: 2,
  },
});
