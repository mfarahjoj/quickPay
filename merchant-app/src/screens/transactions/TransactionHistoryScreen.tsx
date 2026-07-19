import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTransactions } from '../../hooks/useTransactions';
import { useTransactionSummary } from '../../hooks/useTransactionSummary';
import { SummaryPeriod, Transaction } from '../../types';
import { DarkScreen, ScreenHeader, ACCENT, GLASS, GLASS_BORDER, TEXT_DIM, TEXT_FAINT } from '../../components';
import { HistoryIcon } from '../../components/icons/AuthIcons';
import { CURRENCY_SYMBOL } from '../../config/constants';

const GREEN = '#34C77B';
const GOLD = '#F5B544';
const RED = '#FF6961';
const AMBER = '#FFB02E';

type FilterKey = 'all' | 'payments' | 'topups' | 'pending';
const FILTERS: Array<{ key: FilterKey; labelKey: string }> = [
  { key: 'all', labelKey: 'transactions.filters.all' },
  { key: 'payments', labelKey: 'transactions.filters.payments' },
  { key: 'topups', labelKey: 'transactions.filters.topups' },
  { key: 'pending', labelKey: 'transactions.filters.pending' },
];

const PERIODS: SummaryPeriod[] = ['today', 'week', 'month'];

function money(n: number) {
  return `${CURRENCY_SYMBOL}${(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isAgentCommission(tx: Transaction) {
  return tx.type === 'topup' && !tx.isIncoming && tx.commission > 0;
}

/** Signed effect of a transaction on the merchant's balance, in dollars. */
function signedNet(tx: Transaction): number {
  if (isAgentCommission(tx)) return tx.commission;
  const base = tx.type === 'payment' || tx.type === 'refund' ? tx.net : tx.amount;
  return tx.isIncoming ? base : -base;
}

function initials(name?: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  const out = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return out ? out.toUpperCase() : null;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayLabel(d: Date, t: (k: string) => string) {
  const now = new Date();
  if (sameDay(d, now)) return t('transactions.group.today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t('transactions.group.yesterday');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Section {
  key: string;
  title: string;
  subtotal: number;
  data: Transaction[];
}

function buildSections(list: Transaction[], t: (k: string) => string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const tx of list) {
    const key = tx.createdAt.toDateString();
    if (!current || current.key !== key) {
      current = { key, title: dayLabel(tx.createdAt, t), subtotal: 0, data: [] };
      sections.push(current);
    }
    current.data.push(tx);
    current.subtotal += signedNet(tx);
  }
  return sections;
}

function TxRow({ tx, onPress }: { tx: Transaction; onPress: () => void }) {
  const { t } = useTranslation();
  const pending = tx.status === 'pending';
  const failed = tx.status === 'failed' || tx.status === 'cancelled';
  const commission = isAgentCommission(tx);
  const net = signedNet(tx);
  const incoming = net >= 0;

  const title = commission
    ? tx.counterpartyName || t('transactions.row.customer')
    : tx.counterpartyName || tx.description;

  const time = tx.createdAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const kind = t(`transactions.kind.${tx.type}`);
  const subtitle = commission
    ? t('transactions.row.topupCommission', { amount: money(tx.amount) })
    : pending
    ? `${kind} · ${t('transaction.status.pending')}`
    : tx.refundedAt
    ? `${kind} · ${t('transactions.row.refunded')}`
    : `${kind} · ${time}`;

  const amountColor = failed || pending
    ? TEXT_FAINT
    : commission
    ? GOLD
    : tx.type === 'refund' && !tx.isIncoming
    ? RED
    : incoming
    ? GREEN
    : '#FFFFFF';

  const avatarStyle = commission
    ? styles.avGold
    : tx.type === 'refund' && !tx.isIncoming
    ? styles.avRed
    : incoming
    ? styles.avIn
    : styles.avOut;

  const glyph = initials(title) ?? (incoming ? '↓' : '↑');
  const displayAmount = `${net >= 0 ? '+' : '−'}${money(Math.abs(commission ? tx.commission : net))}`;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.avatar, avatarStyle]}>
        <Text style={styles.avatarGlyph}>{glyph}</Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: amountColor }, (pending || failed) && styles.strike]}>
          {displayAmount}
        </Text>
        {pending && (
          <View style={styles.pendDot}>
            <View style={styles.pendDotInner} />
            <Text style={styles.pendText}>{t('transaction.status.pending')}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function SummaryHeader({
  period,
  setPeriod,
  query,
  setQuery,
  filter,
  setFilter,
}: {
  period: SummaryPeriod;
  setPeriod: (p: SummaryPeriod) => void;
  query: string;
  setQuery: (q: string) => void;
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
}) {
  const { t } = useTranslation();
  const { summary, loading } = useTransactionSummary(period);

  const delta = summary?.deltaPct ?? null;
  const deltaUp = (delta ?? 0) >= 0;

  return (
    <View>
      {/* Period segmented control */}
      <View style={styles.seg}>
        {PERIODS.map((p) => {
          const active = period === p;
          return (
            <TouchableOpacity
              key={p}
              style={[styles.segItem, active && styles.segItemActive]}
              onPress={() => setPeriod(p)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segText, active && styles.segTextActive]}>
                {t(`transactions.summary.seg.${p}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Net takings hero */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>
          {t('transactions.summary.netTakings')} · {t(`transactions.summary.periodWord.${period}`)}
        </Text>
        {loading && !summary ? (
          <ActivityIndicator color="#FFFFFF" style={{ marginVertical: 10 }} />
        ) : (
          <Text style={styles.heroAmount}>{money(summary?.netTakings ?? 0)}</Text>
        )}
        {!!summary && (
          <Text style={styles.heroMeta}>
            {delta !== null && (
              <Text style={{ color: deltaUp ? GREEN : RED }}>
                {deltaUp ? '▲' : '▼'} {Math.abs(delta)}% {t('transactions.summary.vsPrevious')}
                {'  ·  '}
              </Text>
            )}
            <Text style={styles.heroMetaDim}>
              {t('transactions.summary.txCount', { count: summary.count })}
            </Text>
          </Text>
        )}
      </View>

      {/* Stream chips */}
      <View style={styles.streams}>
        <View style={styles.stream}>
          <View style={[styles.streamDot, { backgroundColor: GREEN }]} />
          <View>
            <Text style={styles.streamLabel}>{t('transactions.summary.payments')}</Text>
            <Text style={styles.streamValue}>{money(summary?.paymentsNet ?? 0)}</Text>
          </View>
        </View>
        <View style={styles.stream}>
          <View style={[styles.streamDot, { backgroundColor: GOLD }]} />
          <View>
            <Text style={styles.streamLabel}>{t('transactions.summary.commission')}</Text>
            <Text style={styles.streamValue}>{money(summary?.commission ?? 0)}</Text>
          </View>
        </View>
      </View>

      {/* Search */}
      <View style={styles.search}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={t('transactions.search')}
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f.key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(f.labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function TransactionHistoryScreen({ navigation }: { navigation: any }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<SummaryPeriod>('week');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [refreshing, setRefreshing] = useState(false);

  const { transactions, loading, loadingMore, hasMore, refresh, loadMore } = useTransactions(undefined, 25);

  const filtered = useMemo(() => {
    let list = transactions;
    if (filter === 'payments') list = list.filter((tx) => tx.type === 'payment' || tx.type === 'refund');
    else if (filter === 'topups') list = list.filter((tx) => tx.type === 'topup');
    else if (filter === 'pending') list = list.filter((tx) => tx.status === 'pending');

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (tx) =>
          (tx.counterpartyName || '').toLowerCase().includes(q) ||
          (tx.description || '').toLowerCase().includes(q) ||
          (tx.reference || '').toLowerCase().includes(q) ||
          String(tx.amount).includes(q) ||
          String(tx.net).includes(q)
      );
    }
    return list;
  }, [transactions, filter, query]);

  const sections = useMemo(() => buildSections(filtered, t), [filtered, t]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <DarkScreen>
      <ScreenHeader title={t('navigation.tabs.history')} />
      {loading && transactions.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <SummaryHeader
              period={period}
              setPeriod={setPeriod}
              query={query}
              setQuery={setQuery}
              filter={filter}
              setFilter={setFilter}
            />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{section.title}</Text>
              <Text style={[styles.groupSubtotal, { color: section.subtotal >= 0 ? GREEN : RED }]}>
                {section.subtotal >= 0 ? '+' : '−'}{money(Math.abs(section.subtotal))}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TxRow tx={item} onPress={() => navigation.navigate('TransactionDetail', { transaction: item })} />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasMore) loadMore(); }}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={TEXT_DIM} style={{ paddingVertical: 20 }} /> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <HistoryIcon size={30} color="rgba(255,255,255,0.5)" />
              </View>
              <Text style={styles.emptyTitle}>{t('transactions.empty.title')}</Text>
              <Text style={styles.emptyMsg}>{t('transactions.empty.message')}</Text>
            </View>
          }
        />
      )}
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },

  // segmented
  seg: {
    flexDirection: 'row',
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    marginBottom: 18,
  },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segItemActive: { backgroundColor: ACCENT },
  segText: { fontSize: 13, fontWeight: '600', color: TEXT_DIM },
  segTextActive: { color: '#FFFFFF' },

  // hero
  hero: { alignItems: 'center', marginBottom: 18 },
  heroLabel: { fontSize: 12, color: TEXT_FAINT, marginBottom: 6, letterSpacing: 0.2 },
  heroAmount: { fontSize: 40, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1.6 },
  heroMeta: { fontSize: 12, marginTop: 6 },
  heroMetaDim: { color: TEXT_FAINT },

  // streams
  streams: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stream: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  streamDot: { width: 8, height: 8, borderRadius: 4 },
  streamLabel: { fontSize: 11, color: TEXT_FAINT },
  streamValue: { fontSize: 14, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },

  // search
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  searchIcon: { fontSize: 18, color: TEXT_FAINT },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14, padding: 0 },
  searchClear: { fontSize: 13, color: TEXT_FAINT },

  // chips
  chips: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 12, fontWeight: '600', color: TEXT_DIM },
  chipTextActive: { color: '#FFFFFF' },

  // group header
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 18,
    paddingBottom: 6,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_FAINT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  groupSubtotal: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // row
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 13 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avIn: { backgroundColor: 'rgba(52,199,123,0.16)' },
  avGold: { backgroundColor: 'rgba(245,181,68,0.16)' },
  avRed: { backgroundColor: 'rgba(255,105,97,0.14)' },
  avOut: { backgroundColor: 'rgba(255,255,255,0.08)' },
  avatarGlyph: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginBottom: 2 },
  rowSub: { fontSize: 12, color: TEXT_FAINT },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  strike: { textDecorationLine: 'none' },
  pendDot: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  pendDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER },
  pendText: { fontSize: 10, color: AMBER, fontWeight: '600' },

  // empty
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingTop: 80 },
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
