import React from 'react';
import { View, Text, StyleSheet, ScrollView, Share, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header, Button, Card } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { Transaction } from '../../types';

interface Props {
  navigation: any;
  route: { params?: { transaction?: Transaction } };
}

export default function TransactionDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const transaction = route.params?.transaction;

  if (!transaction) {
    return (
      <View style={styles.container}>
        <Header title={t('wallet.detail.title')} onBack={() => navigation.goBack()} />
        <View style={styles.errorContent}>
          <Text style={styles.errorText}>{t('wallet.detail.notFound')}</Text>
        </View>
      </View>
    );
  }

  const handleShare = async () => {
    const receiptText = [
      t('wallet.detail.receiptTitle'),
      '----------------',
      `Amount: ${transaction.isIncoming ? '+' : '-'}${CURRENCY_SYMBOL}${transaction.amount.toFixed(2)}`,
      `Status: ${transaction.status}`,
      `Date: ${transaction.createdAt.toLocaleDateString()} ${transaction.createdAt.toLocaleTimeString()}`,
      `Reference: ${transaction.id}`,
      '----------------',
    ].join('\n');
    await Share.share({ message: receiptText, title: t('wallet.detail.receiptTitle') });
  };

  const statusLabel =
    transaction.status === 'completed'
      ? t('transaction.status.completed')
      : transaction.status === 'pending'
        ? t('transaction.status.pending')
        : transaction.status === 'failed'
          ? t('transaction.status.failed')
          : t('transaction.status.cancelled');

  return (
    <View style={styles.container}>
      <Header
        title={t('wallet.detail.title')}
        onBack={() => navigation.goBack()}
        rightAction={
          <TouchableOpacity onPress={handleShare}>
            <Text style={styles.shareHeaderText}>{t('wallet.detail.share')}</Text>
          </TouchableOpacity>
        }
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Card style={styles.amountCard}>
          <Text style={[styles.amount, transaction.isIncoming ? styles.amountIncoming : styles.amountOutgoing]}>
            {transaction.isIncoming ? '+' : '-'}
            {CURRENCY_SYMBOL}
            {transaction.amount.toFixed(2)}
          </Text>
          <Text style={styles.status}>{statusLabel}</Text>
          <Text style={styles.currency}>{transaction.currency}</Text>
        </Card>

        <Card style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>{t('wallet.detail.dateTime')}</Text>
            <Text style={styles.detailValue}>
              {transaction.createdAt.toLocaleDateString()} {transaction.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>
              {transaction.isIncoming ? t('wallet.detail.sender') : t('wallet.detail.recipient')}
            </Text>
            <Text style={styles.detailValue}>{transaction.description}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>{t('wallet.detail.paymentMethod')}</Text>
            <Text style={styles.detailValue}>{t('wallet.detail.walletBalance')}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>{t('wallet.detail.transactionId')}</Text>
            <Text style={styles.detailValue}>{transaction.id}</Text>
          </View>
        </Card>

        <Button
          title={t('wallet.detail.downloadReceipt')}
          onPress={handleShare}
          variant="secondary"
          fullWidth
          style={styles.shareButton}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  errorContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  errorText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  shareHeaderText: {
    ...typography.bodySemibold,
    color: colors.action.primary,
  },
  amountCard: {
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  amount: {
    ...typography.balanceNumber,
    fontWeight: '700',
    marginBottom: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  amountIncoming: {
    color: colors.success,
  },
  amountOutgoing: {
    color: colors.text.primary,
  },
  status: {
    ...typography.captionBold,
    color: colors.status.success,
    marginBottom: spacing.xs,
  },
  currency: {
    ...typography.caption,
    color: colors.text.muted,
  },
  detailsCard: {
    marginBottom: spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  detailKey: {
    ...typography.caption,
    color: colors.text.secondary,
    flex: 1,
  },
  detailValue: {
    ...typography.bodySemibold,
    color: colors.text.primary,
    flex: 1,
    textAlign: 'right',
  },
  shareButton: {
    marginTop: spacing.md,
  },
});
