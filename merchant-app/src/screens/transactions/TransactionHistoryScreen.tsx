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
import { DarkScreen, ScreenHeader } from '../../components';
import { HistoryIcon } from '../../components/icons/AuthIcons';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { makeStyles, useColors } from '../../theme';
import { formatMajor, isShillings } from '../../utils/money';

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

/** Signed effect of a transaction on the merchant's balance, in its own currency's whole units. */
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
  /** Dollars and shillings kept apart: adding 400,000 shillings to $9 gives nonsense. */
  subtotals: { USD: number; SLS: number };
  data: Transaction[];
}

/** "+$9.20 · +8,000 SLSH": one signed figure per currency the day moved. */
function subtotalText(s: Section['subtotals']): string {
  const parts: string[] = [];
  const signed = (n: number, cur: string) => `${n >= 0 ? '+' : '−'}${formatMajor(Math.abs(n), cur)}`;
  if (s.USD !== 0 || s.SLS === 0) parts.push(signed(s.USD, 'USD'));
  if (s.SLS !== 0) parts.push(signed(s.SLS, 'SLS'));
  return parts.join(' · ');
}

function buildSections(list: Transaction[], t: (k: string) => string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const tx of list) {
    const key = tx.createdAt.toDateString();
    if (!current || current.key !== key) {
      current = { key, title: dayLabel(tx.createdAt, t), subtotals: { USD: 0, SLS: 0 }, data: [] };
      sections.push(current);
    }
    current.data.push(tx);
    current.subtotals[isShillings(tx.currency) ? 'SLS' : 'USD'] += signedNet(tx);
  }
  return sections;
}

function TxRow({ tx, onPress }: { tx: Transaction; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
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
    ? t('transactions.row.topupCommission', { amount: formatMajor(tx.amount, tx.currency) })
    : pending
    ? `${kind} · ${t('transaction.status.pending')}`
    : tx.refundedAt
    ? `${kind} · ${t('transactions.row.refunded')}`
    : `${kind} · ${time}`;

  const amountColor = failed || pending
    ? colors.ui.textFaint
    : commission
    ? colors.ui.warning
    : tx.type === 'refund' && !tx.isIncoming
    ? colors.ui.error
    : incoming
    ? colors.ui.incoming
    : colors.ui.text;

  const avatarStyle = commission
    ? styles.avGold
    : tx.type === 'refund' && !tx.isIncoming
    ? styles.avRed
    : incoming
    ? styles.avIn
    : styles.avOut;

  const glyph = initials(title) ?? (incoming ? '↓' : '↑');
  const displayAmount = `${net >= 0 ? '+' : '−'}${formatMajor(Math.abs(commission ? tx.commission : net), tx.currency)}`;

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
  const colors = useColors();
  const styles = useStyles();
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
          <ActivityIndicator color={colors.ui.text} style={{ marginVertical: 10 }} />
        ) : (
          <Text style={styles.heroAmount}>{money(summary?.netTakings ?? 0)}</Text>
        )}
        {!!summary && (
          <Text style={styles.heroMeta}>
            {delta !== null && (
              <Text style={{ color: deltaUp ? colors.ui.incoming : colors.ui.error }}>
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
          <View style={[styles.streamDot, { backgroundColor: colors.ui.incoming }]} />
          <View>
            <Text style={styles.streamLabel}>{t('transactions.summary.payments')}</Text>
            <Text style={styles.streamValue}>{money(summary?.paymentsNet ?? 0)}</Text>
          </View>
        </View>
        <View style={styles.stream}>
          <View style={[styles.streamDot, { backgroundColor: colors.ui.warning }]} />
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
          placeholderTextColor={colors.ui.ink(0.3)}
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
  const colors = useColors();
  const styles = useStyles();
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
          <ActivityIndicator size="large" color={colors.ui.accent} />
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
              <Text style={[styles.groupSubtotal, { color: section.subtotals.USD + section.subtotals.SLS >= 0 ? colors.ui.incoming : colors.ui.error }]}>
                {subtotalText(section.subtotals)}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TxRow tx={item} onPress={() => navigation.navigate('TransactionDetail', { transaction: item })} />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ui.text} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasMore) loadMore(); }}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.ui.textDim} style={{ paddingVertical: 20 }} /> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <HistoryIcon size={30} color={colors.ui.ink(0.5)} />
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

const useStyles = makeStyles((colors) => StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },

  // segmented
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    marginBottom: 18,
  },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segItemActive: { backgroundColor: colors.ui.accent },
  segText: { fontSize: 13, fontWeight: '600', color: colors.ui.textDim },
  segTextActive: { color: '#FFFFFF' },

  // hero
  hero: { alignItems: 'center', marginBottom: 18 },
  heroLabel: { fontSize: 12, color: colors.ui.textFaint, marginBottom: 6, letterSpacing: 0.2 },
  heroAmount: { fontSize: 40, fontWeight: '800', color: colors.ui.text, letterSpacing: -1.6 },
  heroMeta: { fontSize: 12, marginTop: 6 },
  heroMetaDim: { color: colors.ui.textFaint },

  // streams
  streams: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stream: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  streamDot: { width: 8, height: 8, borderRadius: 4 },
  streamLabel: { fontSize: 11, color: colors.ui.textFaint },
  streamValue: { fontSize: 14, fontWeight: '700', color: colors.ui.text, letterSpacing: -0.3 },

  // search
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  searchIcon: { fontSize: 18, color: colors.ui.textFaint },
  // Fill the 44pt row: a content-sized input clipped its placeholder's descenders.
  searchInput: { flex: 1, alignSelf: 'stretch', color: colors.ui.text, fontSize: 14, padding: 0 },
  searchClear: { fontSize: 13, color: colors.ui.textFaint },

  // chips
  // Wrap: in Somali the fourth chip ran off the screen, out of reach.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
  chipActive: { backgroundColor: colors.ui.accent, borderColor: colors.ui.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.ui.textDim },
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
    color: colors.ui.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  groupSubtotal: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // row
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 13 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avIn: { backgroundColor: colors.ui.incomingSoft },
  avGold: { backgroundColor: 'rgba(245,181,68,0.16)' },
  avRed: { backgroundColor: colors.ui.errorSoft },
  avOut: { backgroundColor: colors.ui.divider },
  avatarGlyph: { fontSize: 15, fontWeight: '700', color: colors.ui.text },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.ui.text, marginBottom: 2 },
  rowSub: { fontSize: 12, color: colors.ui.textFaint },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  strike: { textDecorationLine: 'none' },
  pendDot: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  pendDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ui.warning },
  pendText: { fontSize: 10, color: colors.ui.warning, fontWeight: '600' },

  // empty
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingTop: 80 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.ui.glass,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ui.text, marginBottom: 6 },
  emptyMsg: { fontSize: 14, color: colors.ui.textFaint, textAlign: 'center', lineHeight: 20 },
}));
