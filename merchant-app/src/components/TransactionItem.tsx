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
              ? colors.successLight
              : colors.warningLight,
          },
        ]}
      >
        <Text style={styles.iconText}>
          {transaction.isIncoming
            ? t('components.transactionItem.incoming')
            : t('components.transactionItem.outgoing')}
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
          ]}
        >
          {transaction.isIncoming ? '+' : '-'}
          {CURRENCY_SYMBOL}
          {transaction.amount.toFixed(2)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.smPlus,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.smPlus,
  },
  iconText: {
    fontSize: 10,
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
});
