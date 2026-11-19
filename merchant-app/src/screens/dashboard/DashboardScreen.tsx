import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Animated,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useWallet } from '../../hooks/useWallet';
import { useTransactions } from '../../hooks/useTransactions';
import { useMerchantProfile } from '../../hooks/useMerchantProfile';
import { useFloat } from '../../hooks/useFloat';
import { formatAmount, formatMajor } from '../../utils/money';
import { useZaadFloatOn } from '../../hooks/useZaadFloatOn';
import { useAuth } from '../../hooks/useAuth';
import { needsReply, useMyDisputes } from '../../services/dispute.service';
import { LanguageSelector } from '../../components/LanguageSelector';
import {
  QrIcon,
  ScanIcon,
  TopUpIcon,
  HistoryIcon,
  WalletIcon,
  HandshakeIcon,
  SendIcon,
  ReceiptIcon,
} from '../../components/icons/AuthIcons';
import { type FloatCurrency } from '../../components/CurrencyToggle';
import { ZaadHomeCard } from '../../components/ZaadHomeCard';
import { Transaction } from '../../types';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { makeStyles, useColors, useTheme, wallpaper } from '../../theme';
import { Wallpaper } from '../../components/Wallpaper';

function timeGreeting(t: (k: string) => string) {
  const h = new Date().getHours();
  if (h < 12) return t('dashboard.greeting.morning');
  if (h < 18) return t('dashboard.greeting.afternoon');
  return t('dashboard.greeting.evening');
}

function roleLabel(type: string, t: (k: string) => string) {
  if (type === 'agent_merchant') return t('dashboard.role.both');
  if (type === 'topup_agent') return t('dashboard.role.agent');
  return t('dashboard.role.merchant');
}

function money(cents: number) {
  return `${CURRENCY_SYMBOL}${(cents ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface ActionDef {
  key: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  route: string;
}

/** A round smoked-glass action on the coral header. */
function ActionButton({ action, width, onPress }: { action: ActionDef; width: `${number}%`; onPress: () => void }) {
  const styles = useStyles();
  const { Icon } = action;
  return (
    <TouchableOpacity style={[styles.actionBtn, { width }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.actionCircle}>
        <Icon size={24} color="#FFFFFF" />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>{action.label}</Text>
    </TouchableOpacity>
  );
}

function TxRow({ tx, onPress }: { tx: Transaction; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const incoming = tx.isIncoming;
  const tint = incoming ? colors.tints.green : colors.tints.grey;
  return (
    <TouchableOpacity style={styles.txRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.txAvatar, { backgroundColor: tint.fill }]}>
        <Text style={[styles.txAvatarGlyph, { color: tint.mark }]}>{incoming ? '↓' : '↑'}</Text>
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txName} numberOfLines={1}>{tx.description}</Text>
        <Text style={styles.txDate}>
          {tx.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {tx.status !== 'completed' ? ` · ${t(`transaction.status.${tx.status}`)}` : ''}
        </Text>
      </View>
      <Text style={[styles.txAmount, incoming && styles.txAmountIn]}>
        {incoming ? '+' : '−'}{formatMajor(tx.amount, tx.currency)}
      </Text>
    </TouchableOpacity>
  );
}

export default function DashboardScreen({ navigation }: { navigation: any }) {
  const colors = useColors();
  const { scheme } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  // The status bar follows the canvas once the coral header has scrolled away.
  const [headerHeight, setHeaderHeight] = React.useState(0);
  const [pastHeader, setPastHeader] = React.useState(false);
  const { t } = useTranslation();
  const { wallet, loading: walletLoading, refreshBalance } = useWallet();
  const { transactions, loading: txLoading, refresh: refreshTx } = useTransactions(undefined, 6);
  const { profile } = useMerchantProfile();
  const { user } = useAuth();
  const { disputes } = useMyDisputes();
  const repliesDue = disputes.filter((d) => needsReply(d, user?.uid)).length;
  const [refreshing, setRefreshing] = React.useState(false);
  // Shillings and dollars are separate balances, never converted
  // (SHILLINGS.md). Starts on whichever this shop holds, dollars when both.
  const [picked, setPicked] = React.useState<FloatCurrency | null>(null);
  const shown: FloatCurrency =
    picked ?? ((wallet?.slsBalance ?? 0) > 0 && (wallet?.balanceCents ?? 0) === 0 ? 'SLS' : 'USD');
  const balanceText =
    shown === 'SLS' ? formatAmount(wallet?.slsBalance ?? 0, 'SLS') : money(wallet?.balance ?? 0);

  const accountType = profile?.accountType ?? '';
  const isMerchantRole = accountType === 'merchant' || accountType === 'agent_merchant';
  const isAgentRole = accountType === 'topup_agent' || accountType === 'agent_merchant';
  // Agents hold float apart from their sales and earnings.
  const { floatCents, floatSls } = useFloat(isAgentRole, wallet?.lastTransactionAt?.getTime());
  // Buying float with Zaad, once the collection number is live.
  const zaadFloat = useZaadFloatOn();

  // One button per job. Receive also scans a customer's code; Cash in also
  // finds a customer by phone; Cash out also takes a cash-out code, for
  // customer apps that can't yet approve at the counter.
  const actions: ActionDef[] = [
    ...(isMerchantRole ? [
      { key: 'receive', label: t('dashboard.quickActions.receive'), Icon: QrIcon, route: 'GenerateQR' },
    ] : []),
    ...(isAgentRole ? [
      { key: 'cashIn', label: t('dashboard.quickActions.cashIn'), Icon: TopUpIcon, route: 'ConfirmTopup' },
      { key: 'cashOut', label: t('dashboard.quickActions.cashOut'), Icon: ScanIcon, route: 'ScanCashOut' },
    ] : []),
    ...(isMerchantRole ? [
      { key: 'withdraw', label: t('dashboard.quickActions.withdraw'), Icon: WalletIcon, route: 'Payout' },
      { key: 'send', label: t('dashboard.quickActions.send'), Icon: SendIcon, route: 'Send' },
      { key: 'payroll', label: t('dashboard.quickActions.payroll'), Icon: HandshakeIcon, route: 'Payroll' },
      { key: 'bills', label: t('dashboard.quickActions.bills'), Icon: ReceiptIcon, route: 'Bills' },
    ] : []),
  ];
  // Four to a row, except five or six, which sit 3 + 2 / 3 + 3 rather than
  // leaving one or two alone under a full row.
  const actionWidth = actions.length === 5 || actions.length === 6 ? '33.33%' : '25%';

  // entrance animation
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
    ]).start();
  }, [fade, slide]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshBalance(), refreshTx()]);
    setRefreshing(false);
  };

  const businessName = profile?.businessName ?? '';
  const firstName = businessName.split(' ')[0] || businessName;
  const initial = (firstName || 'Q').charAt(0).toUpperCase();

  return (
    <View style={styles.safe}>
      {isFocused && (
        <StatusBar
          animated
          barStyle={pastHeader && scheme === 'light' ? 'dark-content' : 'light-content'}
          backgroundColor={pastHeader ? colors.ui.canvas : wallpaper.top}
        />
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const past = headerHeight > 0 && e.nativeEvent.contentOffset.y > headerHeight - insets.top;
          if (past !== pastHeader) setPastHeader(past);
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFFFFF"
            colors={[colors.ui.accent]}
            progressViewOffset={insets.top}
          />
        }
      >
        {/* The coral header, as on Zapp Pay's Home: who's signed in, the
            balance, and the jobs as round smoked-glass buttons. */}
        <View
          style={[styles.header, { paddingTop: insets.top + 10 }]}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          {/* Pulling down to refresh shows more coral, not the grey page. */}
          <View style={styles.overscroll} />
          <Wallpaper style={styles.wallpaper} />

          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.who}
              onPress={() => navigation.navigate('Settings')}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={t('navigation.tabs.settings')}
            >
              <View style={styles.glassCircle}>
                <Text style={styles.initial}>{initial}</Text>
              </View>
              <View style={styles.whoText}>
                <Text style={styles.greeting} numberOfLines={1}>{timeGreeting(t)}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {firstName || 'Merchant'}
                  {accountType ? <Text style={styles.role}>{`  ·  ${roleLabel(accountType, t)}`}</Text> : null}
                </Text>
              </View>
            </TouchableOpacity>
            <LanguageSelector currentLanguage={profile?.preferredLanguage} compact tone="onColor" />
          </View>

          <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
            <View style={styles.balanceBlock}>
              <View style={styles.labelRow}>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>
                    {isAgentRole ? t('dashboard.balance.salesLabel') : t('dashboard.balance.label')}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setPicked(shown === 'SLS' ? 'USD' : 'SLS')}
                  hitSlop={10}
                  style={[styles.pill, styles.currencyPill]}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={shown === 'SLS' ? t('currency.dollars') : t('currency.shillings')}
                >
                  <Text style={styles.pillText}>{shown === 'SLS' ? 'SLSH ⇄' : 'USD ⇄'}</Text>
                </TouchableOpacity>
              </View>
              {walletLoading && !wallet ? (
                <ActivityIndicator color="#FFFFFF" size="large" style={styles.balanceLoader} />
              ) : (
                <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
                  {balanceText}
                </Text>
              )}
              <View style={styles.statPills}>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>
                    {'↓ '}{t('dashboard.balance.totalReceived')}{'  '}
                    <Text style={styles.pillStrong}>
                      {shown === 'SLS' ? formatAmount(wallet?.slsTotalReceived ?? 0, 'SLS') : money(wallet?.totalReceived ?? 0)}
                    </Text>
                  </Text>
                </View>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>
                    {'↑ '}{t('dashboard.balance.totalSent')}{'  '}
                    <Text style={styles.pillStrong}>
                      {shown === 'SLS' ? formatAmount(wallet?.slsTotalSent ?? 0, 'SLS') : money(wallet?.totalSent ?? 0)}
                    </Text>
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.actions}>
              {actions.map((a) => (
                <ActionButton key={a.key} action={a} width={actionWidth} onPress={() => navigation.navigate(a.route)} />
              ))}
            </View>
          </Animated.View>
        </View>

        <View style={styles.body}>
          {/* Agent float, apart from the balance above */}
          {isAgentRole && (
            <View style={styles.floatCard}>
              <View style={styles.floatText}>
                <Text style={styles.floatLabel}>{t('dashboard.float.label')}</Text>
                <Text style={styles.floatAmount}>{floatCents === null ? '…' : money(floatCents / 100)}</Text>
                {/* Shilling float is held apart and never converted; shown once there is any. */}
                {floatSls ? <Text style={styles.floatSls}>{formatAmount(floatSls, 'SLS')}</Text> : null}
                <Text style={styles.floatHint}>{t('dashboard.float.hint')}</Text>
              </View>
              <View style={styles.floatButtons}>
                {zaadFloat ? (
                  <TouchableOpacity style={styles.floatButton} onPress={() => navigation.navigate('BuyFloatZaad')} activeOpacity={0.8}>
                    <Text style={styles.floatButtonText}>{t('dashboard.float.buyZaad')}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.floatButton} onPress={() => navigation.navigate('ZaadTopups')} activeOpacity={0.8}>
                  <Text style={styles.floatButtonText}>{t('dashboard.float.zaadTopups')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.floatButton} onPress={() => navigation.navigate('MoveToFloat')} activeOpacity={0.8}>
                  <Text style={styles.floatButtonText}>{t('dashboard.float.move')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Zaad top-ups through agents (D32): shown only while they're on for this agent. */}
          {isAgentRole && user?.uid ? (
            <ZaadHomeCard uid={user.uid} onOpen={() => navigation.navigate('ZaadTopups')} />
          ) : null}

          {/* Disputes waiting on this shop */}
          {repliesDue > 0 && (
            <TouchableOpacity
              style={styles.disputeBanner}
              onPress={() => navigation.navigate('DisputesInbox')}
              activeOpacity={0.8}
            >
              <Text style={styles.disputeBannerText}>
                {t('dashboard.disputesNeedReply', { count: repliesDue })}
              </Text>
              <Text style={styles.disputeBannerArrow}>›</Text>
            </TouchableOpacity>
          )}

          {/* Recent transactions */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('dashboard.recentTransactions.title')}</Text>
            {txLoading && transactions.length === 0 ? (
              <ActivityIndicator color={colors.ui.accent} style={styles.loader} />
            ) : transactions.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIconWrap}>
                  <HistoryIcon size={26} color={colors.ui.textFaint} />
                </View>
                <Text style={styles.emptyTitle}>{t('dashboard.recentTransactions.emptyTitle')}</Text>
                <Text style={styles.emptyMsg}>{t('dashboard.recentTransactions.emptyMessage')}</Text>
              </View>
            ) : (
              transactions.map((tx) => (
                <TxRow key={tx.id} tx={tx} onPress={() => navigation.navigate('TransactionDetail', { transaction: tx })} />
              ))
            )}
            {transactions.length > 0 && (
              <TouchableOpacity
                style={styles.seeAll}
                onPress={() => navigation.navigate('History')}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.seeAllText}>{t('dashboard.recentTransactions.viewAll')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** How far the wallpaper runs on under the first card below the header. */
const WALLPAPER_OVERLAP = 30;

const glass = {
  backgroundColor: wallpaper.glass,
  borderWidth: 1,
  borderColor: wallpaper.glassBorder,
};

const useStyles = makeStyles((colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 48,
  },

  // ─── Coral header ───
  header: {
    paddingHorizontal: 16,
    paddingBottom: 34,
  },
  overscroll: {
    position: 'absolute',
    top: -1000,
    left: 0,
    right: 0,
    height: 1000,
    backgroundColor: wallpaper.top,
  },
  wallpaper: {
    bottom: -WALLPAPER_OVERLAP,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    gap: 12,
  },
  who: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  whoText: {
    flex: 1,
  },
  glassCircle: {
    ...glass,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  greeting: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  role: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  balanceBlock: {
    alignItems: 'center',
    marginTop: 22,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    ...glass,
    minHeight: 28,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    justifyContent: 'center',
  },
  currencyPill: {
    paddingHorizontal: 10,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  pillStrong: {
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  amount: {
    marginTop: 8,
    color: '#FFFFFF',
    fontSize: 56,
    lineHeight: 66,
    fontWeight: '700',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  balanceLoader: {
    marginVertical: 18,
  },
  statPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 22,
    rowGap: 14,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 8,
  },
  actionCircle: {
    ...glass,
    borderColor: 'rgba(255,255,255,0.18)',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 2,
  },

  // ─── Body: flat cards on the page ───
  body: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    backgroundColor: colors.ui.surface,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ui.glassBorder,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ui.text,
    marginBottom: 4,
  },
  loader: {
    paddingVertical: 28,
  },
  seeAll: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ui.divider,
    paddingVertical: 14,
    alignItems: 'center',
  },
  seeAllText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ui.accentText,
  },
  floatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 20,
    backgroundColor: colors.ui.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ui.glassBorder,
  },
  floatText: { flex: 1, marginRight: 12 },
  floatLabel: { fontSize: 12, fontWeight: '700', color: colors.ui.textDim, letterSpacing: 1, textTransform: 'uppercase' },
  floatAmount: { fontSize: 24, fontWeight: '800', color: colors.ui.text, marginTop: 4, letterSpacing: -0.5 },
  floatSls: { fontSize: 18, fontWeight: '800', color: colors.ui.text, marginTop: 2, letterSpacing: -0.3 },
  floatHint: { fontSize: 12, color: colors.ui.textFaint, marginTop: 4, lineHeight: 16 },
  floatButtons: { gap: 8, alignItems: 'flex-end' },
  floatButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.ui.accent },
  floatButtonText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  disputeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.ui.warningSoft,
  },
  disputeBannerText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ui.warning },
  disputeBannerArrow: { fontSize: 20, color: colors.ui.warning, marginLeft: 8 },

  // ─── Transaction rows, as in Zapp Pay ───
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    paddingVertical: 10,
  },
  txAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txAvatarGlyph: {
    fontSize: 17,
    fontWeight: '700',
  },
  txInfo: {
    flex: 1,
  },
  txName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ui.text,
  },
  txDate: {
    fontSize: 13,
    color: colors.ui.textFaint,
    marginTop: 2,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ui.text,
    fontVariant: ['tabular-nums'],
  },
  txAmountIn: {
    color: colors.ui.incoming,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ui.glassRaised,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ui.text,
  },
  emptyMsg: {
    fontSize: 13,
    color: colors.ui.textDim,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 18,
  },
}));
