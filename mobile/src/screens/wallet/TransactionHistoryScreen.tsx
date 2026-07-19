import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTransactions } from '../../hooks/useTransactions';
import { Transaction } from '../../types';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { TransactionItem } from '../../components/TransactionItem';
import { EmptyState, Card } from '../../components';
import { Springs } from '../../constants/springs';

function AnimatedTransactionRow({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const y = useSharedValue(14);

  useEffect(() => {
    const delay = Math.min(index * 45, 360);
    opacity.value = withDelay(delay, withTiming(1, { duration: 220 }));
    y.value = withDelay(delay, withSpring(0, Springs.transition));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  return <Animated.View style={animStyle}>{children}</Animated.View>;
}

interface Props {
  navigation: any;
}

type Row = { type: 'header'; id: string; title: string } | { type: 'item'; id: string; transaction: Transaction };

export default function TransactionHistoryScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { transactions, loading, refresh } = useTransactions(undefined, 100);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const groupedRows = useMemo<Row[]>(() => {
    const filtered = transactions.filter((item) => {
      if (filter === 'sent') {
        return !item.isIncoming;
      }
      if (filter === 'received') {
        return item.isIncoming;
      }
      return true;
    });

    const groups = filtered.reduce<Record<string, Transaction[]>>((acc, tx) => {
      const txDate = new Date(tx.createdAt);
      const now = new Date();
      const today = now.toDateString();
      const yesterdayDate = new Date(now);
      yesterdayDate.setDate(now.getDate() - 1);
      const yesterday = yesterdayDate.toDateString();

      const txKey = txDate.toDateString();
      const groupTitle =
        txKey === today
          ? t('wallet.history.today')
          : txKey === yesterday
            ? t('wallet.history.yesterday')
            : txDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

      if (!acc[groupTitle]) {
        acc[groupTitle] = [];
      }
      acc[groupTitle].push(tx);
      return acc;
    }, {});

    return Object.entries(groups).flatMap(([title, list]) => [
      { type: 'header' as const, id: `header-${title}`, title },
      ...list.map((transaction) => ({ type: 'item' as const, id: transaction.id, transaction })),
    ]);
  }, [transactions, filter, t]);

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.action.primary} />
      </View>
    );
  }

  const filterLabels = {
    all: t('wallet.history.filterAll'),
    sent: t('wallet.history.filterSent'),
    received: t('wallet.history.filterReceived'),
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('wallet.history.title')}</Text>
        <TouchableOpacity style={styles.searchButton}>
          <Text style={styles.searchIcon}>S</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'sent', 'received'] as const).map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.filterPill, filter === item && styles.filterPillActive]}
            onPress={() => setFilter(item)}
          >
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
              {filterLabels[item]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={groupedRows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.action.primary} />}
        renderItem={({ item, index }) =>
          item.type === 'header' ? (
            <Text style={styles.groupTitle}>{item.title}</Text>
          ) : (
            <AnimatedTransactionRow index={index}>
              <TransactionItem
                transaction={item.transaction}
                onPress={() => navigation.navigate('TransactionDetail', { transaction: item.transaction })}
              />
            </AnimatedTransactionRow>
          )
        }
        ListEmptyComponent={
          <Card>
            <EmptyState
              variant="transactions"
              title={t('wallet.history.noTransactionsTitle')}
              message={t('wallet.history.noTransactionsMessage')}
            />
          </Card>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dark.canvas,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...typography.h1,
    color: colors.text.primary,
  },
  searchButton: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border.default,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchIcon: {
    ...typography.body,
    color: colors.text.secondary,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  filterPill: {
    flex: 1,
    height: 34,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
  },
  filterPillActive: {
    backgroundColor: colors.action.primary,
    borderColor: colors.action.primary,
  },
  filterText: {
    ...typography.captionBold,
    color: colors.text.secondary,
  },
  filterTextActive: {
    color: colors.text.inverse,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  groupTitle: {
    ...typography.captionBold,
    color: colors.text.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
});
