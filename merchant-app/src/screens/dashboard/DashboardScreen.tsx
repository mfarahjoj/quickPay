import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useWallet } from '../../hooks/useWallet';
import { useTransactions } from '../../hooks/useTransactions';
import { useMerchantProfile } from '../../hooks/useMerchantProfile';
import { LanguageSelector } from '../../components/LanguageSelector';
import {
  QrIcon,
  ScanIcon,
  TopUpIcon,
  HistoryIcon,
} from '../../components/icons/AuthIcons';
import { Transaction } from '../../types';
import { CURRENCY_SYMBOL } from '../../config/constants';

const ACCENT = '#FF5043';

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

/** Revolut-style circular action button */
function ActionButton({ action, onPress }: { action: ActionDef; onPress: () => void }) {
  const { Icon } = action;
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.actionCircle}>
        <Icon size={24} color="#FFFFFF" />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>{action.label}</Text>
    </TouchableOpacity>
  );
}

function TxRow({ tx, onPress }: { tx: Transaction; onPress: () => void }) {
  const { t } = useTranslation();
  const incoming = tx.isIncoming;
  return (
    <TouchableOpacity style={styles.txRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.txAvatar, incoming ? styles.txAvatarIn : styles.txAvatarOut]}>
        <Text style={styles.txAvatarGlyph}>{incoming ? '↓' : '↑'}</Text>
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txName} numberOfLines={1}>{tx.description}</Text>
        <Text style={styles.txDate}>
          {tx.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {tx.status !== 'completed' ? ` · ${t(`transaction.status.${tx.status}`)}` : ''}
        </Text>
      </View>
      <Text style={[styles.txAmount, incoming && styles.txAmountIn]}>
        {incoming ? '+' : '−'}{money(tx.amount)}
      </Text>
    </TouchableOpacity>
  );
}

export default function DashboardScreen({ navigation }: { navigation: any }) {
  const { t } = useTranslation();
  const { wallet, loading: walletLoading, refreshBalance } = useWallet();
  const { transactions, loading: txLoading, refresh: refreshTx } = useTransactions(undefined, 6);
  const { profile } = useMerchantProfile();
  const [refreshing, setRefreshing] = React.useState(false);

  const accountType = profile?.accountType ?? '';
  const isMerchantRole = accountType === 'merchant' || accountType === 'agent_merchant';
  const isAgentRole = accountType === 'topup_agent' || accountType === 'agent_merchant';

  const actions: ActionDef[] = [
    ...(isMerchantRole ? [
      { key: 'qr', label: t('dashboard.quickActions.generateQR'), Icon: QrIcon, route: 'GenerateQR' },
      { key: 'scan', label: t('dashboard.quickActions.scanAndCharge'), Icon: ScanIcon, route: 'ScanCharge' },
      { key: 'payroll', label: 'Payroll', Icon: HistoryIcon, route: 'Payroll' },
    ] : []),
    ...(isAgentRole ? [
      { key: 'topup', label: t('dashboard.quickActions.topUpCustomer'), Icon: TopUpIcon, route: 'TopupCustomer' },
      { key: 'confirmTopup', label: t('dashboard.quickActions.confirmTopUp'), Icon: TopUpIcon, route: 'ConfirmTopup' },
      { key: 'cashout', label: 'Confirm Cash Out', Icon: TopUpIcon, route: 'ConfirmCashOut' },
      { key: 'history', label: t('dashboard.quickActions.topUpHistory'), Icon: HistoryIcon, route: 'TopupHistory' },
    ] : []),
    ...(!isMerchantRole && !isAgentRole ? [
      { key: 'scan', label: t('dashboard.quickActions.scanAndCharge'), Icon: ScanIcon, route: 'ScanCharge' },
      { key: 'topup', label: t('dashboard.quickActions.topUpCustomer'), Icon: TopUpIcon, route: 'TopupCustomer' },
    ] : []),
  ];

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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* ambient glow */}
      <View style={styles.glow} pointerEvents="none" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />
        }
      >
        <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <View style={styles.avatarRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
              <View>
                <Text style={styles.greeting}>{timeGreeting(t)}</Text>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{firstName || 'Merchant'}</Text>
                  {!!accountType && (
                    <View style={styles.roleTag}>
                      <Text style={styles.roleTagText}>{roleLabel(accountType, t)}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
            <LanguageSelector currentLanguage={profile?.preferredLanguage} compact dark />
          </View>

          {/* Balance */}
          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>{t('dashboard.balance.label')}</Text>
            {walletLoading && !wallet ? (
              <ActivityIndicator color="#FFFFFF" size="large" style={{ marginVertical: 14 }} />
            ) : (
              <Text style={styles.balanceAmount}>{money(wallet?.balance ?? 0)}</Text>
            )}

            <View style={styles.statPills}>
              <View style={styles.statPill}>
                <Text style={styles.statPillArrow}>↓</Text>
                <View>
                  <Text style={styles.statPillLabel}>{t('dashboard.balance.totalReceived')}</Text>
                  <Text style={styles.statPillValue}>{money(wallet?.totalReceived ?? 0)}</Text>
                </View>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statPillArrow}>↑</Text>
                <View>
                  <Text style={styles.statPillLabel}>{t('dashboard.balance.totalSent')}</Text>
                  <Text style={styles.statPillValue}>{money(wallet?.totalSent ?? 0)}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Circular actions */}
          <View style={styles.actionsRow}>
            {actions.map((a) => (
              <ActionButton key={a.key} action={a} onPress={() => navigation.navigate(a.route)} />
            ))}
          </View>

          {/* Recent transactions */}
          <View style={styles.txHeader}>
            <Text style={styles.sectionTitle}>{t('dashboard.recentTransactions.title')}</Text>
            {transactions.length > 0 && (
              <TouchableOpacity onPress={() => navigation.navigate('History')}>
                <Text style={styles.seeAll}>{t('dashboard.recentTransactions.viewAll')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {txLoading && transactions.length === 0 ? (
            <View style={styles.txCard}>
              <ActivityIndicator color={ACCENT} style={{ paddingVertical: 28 }} />
            </View>
          ) : transactions.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}>
                <HistoryIcon size={28} color="rgba(255,255,255,0.5)" />
              </View>
              <Text style={styles.emptyTitle}>{t('dashboard.recentTransactions.emptyTitle')}</Text>
              <Text style={styles.emptyMsg}>{t('dashboard.recentTransactions.emptyMessage')}</Text>
            </View>
          ) : (
            <View style={styles.txCard}>
              {transactions.map((tx, i) => (
                <View key={tx.id}>
                  <TxRow tx={tx} onPress={() => navigation.navigate('TransactionDetail', { transaction: tx })} />
                  {i < transactions.length - 1 && <View style={styles.txDivider} />}
                </View>
              ))}
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const GLASS = 'rgba(255,255,255,0.06)';
const GLASS_BORDER = 'rgba(255,255,255,0.1)';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 48,
  },

  // glow
  glow: {
    position: 'absolute',
    top: -120,
    alignSelf: 'center',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: ACCENT,
    opacity: 0.1,
  },

  // top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 12,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  greeting: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    maxWidth: 150,
  },
  roleTag: {
    backgroundColor: 'rgba(26,86,255,0.18)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(26,86,255,0.3)',
  },
  roleTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FF8A7A',
    letterSpacing: 0.1,
  },

  // balance
  balanceBlock: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  balanceAmount: {
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -2.5,
    color: '#FFFFFF',
    marginBottom: 24,
  },
  statPills: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'stretch',
  },
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  statPillArrow: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '700',
  },
  statPillLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 1,
  },
  statPillValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },

  // circular actions
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 20,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 9,
    width: 68,
  },
  actionCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },

  // section
  txHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  seeAll: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF8A7A',
  },

  // tx card
  txCard: {
    marginHorizontal: 20,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 20,
    overflow: 'hidden',
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  txAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  txAvatarIn: {
    backgroundColor: 'rgba(31,157,85,0.18)',
  },
  txAvatarOut: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  txAvatarGlyph: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  txInfo: {
    flex: 1,
  },
  txName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  txDate: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  txAmountIn: {
    color: '#34C77B',
  },
  txDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginLeft: 72,
  },

  // empty
  emptyCard: {
    marginHorizontal: 20,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 20,
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  emptyMsg: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
