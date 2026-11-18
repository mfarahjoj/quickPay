import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Transaction } from '../types';
import { makeStyles, useColors, type Colors, type Tint } from '../theme';
import { formatMajor } from '../utils/money';
import { initialsOf } from '../utils/initials';
import {
  ArrowInIcon,
  ArrowOutIcon,
  CashIcon,
  GiftIcon,
  PersonIcon,
  RefundIcon,
  StoreIcon,
} from './icons/LineIcons';

interface TransactionItemProps {
  transaction: Transaction;
  onPress?: () => void;
}

/** A transaction row: a tinted avatar for what it is, the time, the amount. */
export function TransactionItem(props: TransactionItemProps) {
  return <TransactionRow {...props} />;
}

// ─── The row: a tinted avatar for what it is, the time, the amount ───

interface RowLook {
  tint: Tint;
  Icon?: React.ComponentType<{ size?: number; color: string }>;
  initials?: string;
}

/** The avatar for a row, from what it really is (its kind). */
function rowLook(tx: Transaction, tints: Colors['tints']): RowLook {
  switch (tx.kind) {
    case 'merchant_payment':
    case 'online_payment':
      return { tint: tints.amber, Icon: StoreIcon };
    case 'p2p':
    case 'remittance': {
      const initials = initialsOf(tx.counterpartyName);
      return initials ? { tint: tints.blue, initials } : { tint: tints.blue, Icon: PersonIcon };
    }
    case 'cash_in':
    case 'card_topup':
    case 'mobile_money_topup':
    case 'bank_topup':
    case 'payroll':
      return { tint: tints.green, Icon: ArrowInIcon };
    case 'cash_out':
    case 'mobile_money_cashout':
      return { tint: tints.coral, Icon: CashIcon };
    case 'refund':
      return { tint: tints.green, Icon: RefundIcon };
    case 'referral':
      return { tint: tints.coral, Icon: GiftIcon };
    default:
      return tx.isIncoming
        ? { tint: tints.green, Icon: ArrowInIcon }
        : { tint: tints.grey, Icon: ArrowOutIcon };
  }
}

/** "Today, 09:41", "Yesterday, 18:20" or "5 Nov, 14:02". */
function whenLabel(at: Date, t: TFunction): string {
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const daysAgo = Math.round((today - day) / 86_400_000);
  if (daysAgo === 0) return `${t('common.today')}, ${time}`;
  if (daysAgo === 1) return `${t('common.yesterday')}, ${time}`;
  return `${at.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

function TransactionRow({ transaction, onPress }: TransactionItemProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  // A cancelled or expired cash-out returned its money: never show it as spent.
  const voided = transaction.status === 'cancelled' || transaction.status === 'failed';
  const pending = transaction.status === 'pending';
  const look = rowLook(transaction, colors.tints);
  const status = voided || pending ? t(`transaction.status.${transaction.status}`) : null;
  const Icon = look.Icon;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7} disabled={!onPress}>
      <View style={[styles.avatar, { backgroundColor: look.tint.fill }]}>
        {look.initials ? (
          <Text style={[styles.initials, { color: look.tint.mark }]}>{look.initials}</Text>
        ) : Icon ? (
          <Icon size={19} color={look.tint.mark} />
        ) : null}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {transaction.description}
        </Text>
        <Text style={styles.when} numberOfLines={1}>
          {whenLabel(new Date(transaction.createdAt), t)}
          {status ? ` · ${status}` : ''}
        </Text>
      </View>
      <Text
        style={[
          styles.amount,
          transaction.isIncoming && styles.amountIn,
          voided && styles.amountVoided,
        ]}
      >
        {transaction.isIncoming ? '+' : '\u2212'}
        {formatMajor(transaction.amount, transaction.currency)}
      </Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    paddingVertical: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: 14,
    fontWeight: '700',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.ui.text,
  },
  when: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.ui.textFaint,
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ui.text,
    fontVariant: ['tabular-nums'],
  },
  amountIn: {
    color: colors.ui.incoming,
  },
  amountVoided: {
    color: colors.ui.textFaint,
    textDecorationLine: 'line-through',
  },
}));
