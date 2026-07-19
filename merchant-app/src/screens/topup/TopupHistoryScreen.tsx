import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { getTopupHistory } from '../../services/topup.service';
import type { TopupRecord } from '../../services/topup.service';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { DarkScreen, GlassCard, ACCENT, TEXT_DIM, TEXT_FAINT } from '../../components';
import { HistoryIcon } from '../../components/icons/AuthIcons';

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const METHOD_KEYS: Record<string, string> = {
  zaad: 'topup.methods.zaad',
  edahab: 'topup.methods.edahab',
  cash: 'topup.methods.cash',
};

const STATUS_KEYS: Record<string, string> = {
  completed: 'components.badge.completed',
  pending: 'components.badge.pending',
  failed: 'components.badge.failed',
  cancelled: 'components.badge.cancelled',
};

function methodIcon(method: string): string {
  switch (method) {
    case 'zaad': return '\u{1F4F1}';
    case 'edahab': return '\u{1F4F2}';
    case 'cash': return '\u{1F4B5}';
    default: return '\u{1F4B3}';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return '#34C77B';
    case 'pending': return '#FFB02E';
    case 'failed': return '#FF6961';
    default: return TEXT_DIM;
  }
}

export default function TopupHistoryScreen() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<TopupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getTopupHistory(50);
      setRecords(data);
    } catch {
      // error already logged in service
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const renderItem = ({ item }: { item: TopupRecord }) => (
    <GlassCard style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>{methodIcon(item.paymentMethod)}</Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>
            {CURRENCY_SYMBOL}{(item.amountDollars ?? item.amount ?? 0).toFixed(2)}
          </Text>
          <Text style={styles.cardSubtitle}>
            {METHOD_KEYS[item.paymentMethod] ? t(METHOD_KEYS[item.paymentMethod]) : item.paymentMethod}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={[styles.statusBadge, { color: statusColor(item.status) }]}>
            {STATUS_KEYS[item.status] ? t(STATUS_KEYS[item.status]) : item.status}
          </Text>
          <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>
      {item.reference ? (
        <Text style={styles.cardRef}>{t('topup.history.refPrefix', { reference: item.reference })}</Text>
      ) : null}
    </GlassCard>
  );

  if (loading && records.length === 0) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <ActivityIndicator size="large" color={ACCENT} />
      </DarkScreen>
    );
  }

  return (
    <DarkScreen edges={[]}>
      <FlatList
        data={records}
        keyExtractor={(item) => item.id || item.transactionId}
        renderItem={renderItem}
        contentContainerStyle={records.length === 0 ? styles.emptyList : styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchHistory(true)} tintColor="#FFFFFF" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <HistoryIcon size={30} color="rgba(255,255,255,0.5)" />
            </View>
            <Text style={styles.emptyTitle}>{t('topup.history.emptyTitle')}</Text>
            <Text style={styles.emptyMsg}>{t('topup.history.emptyMessage')}</Text>
          </View>
        }
      />
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 10,
  },
  emptyList: {
    flexGrow: 1,
  },
  card: {
    padding: 14,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  icon: { fontSize: 22 },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },
  cardSubtitle: { fontSize: 13, color: TEXT_DIM, marginTop: 2 },
  cardRight: { alignItems: 'flex-end' },
  statusBadge: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  cardDate: { fontSize: 12, color: TEXT_FAINT, marginTop: 3 },
  cardRef: { fontSize: 12, color: TEXT_FAINT, marginTop: 8, paddingLeft: 58 },

  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginBottom: 6 },
  emptyMsg: { fontSize: 14, color: TEXT_FAINT, textAlign: 'center', lineHeight: 20 },
});
