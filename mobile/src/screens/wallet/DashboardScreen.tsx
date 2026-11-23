import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Alert, StatusBar, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Polygon } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '../../hooks/useWallet';
import { useHomeCurrency } from '../../hooks/useHomeCurrency';
import { useTransactions } from '../../hooks/useTransactions';
import { typography, spacing, borderRadius, makeStyles, useColors, useTheme, wallpaper } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { Card } from '../../components/Card';
import { TransactionItem } from '../../components/TransactionItem';
import { Transaction } from '../../types';
import { triggerHaptic } from '../../services/haptics.service';
import { usePaymentRequests } from '../../hooks/usePaymentRequests';
import { useZaadTopups } from '../../hooks/useZaadTopups';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUserProfile } from '../../hooks/useUserProfile';
import {
  resolveReceiveToken,
  isTokenStillValid,
  receiveQrErrorKey,
  secondsLeftFromToken,
  type TokenResponse,
} from '../../services/customerToken.service';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  Easing as REasing,
} from 'react-native-reanimated';
import { Springs } from '../../constants/springs';
import { LightHomeHeader } from '../../components/home/LightHomeHeader';
import { HomeWidgets } from '../../components/home/HomeWidgets';
import { BillIcon, ChevronIcon, PinIcon, SendIcon } from '../../components/icons/LineIcons';
import { initialsOf } from '../../utils/initials';

interface Props {
  navigation: any;
}

const TAB_BAR_HEIGHT = 49;

// Brand coral: the same in light and dark.
const CORAL = '#FF5043';

// ─── Tile icons ───────────────────────────────────────────────

function BoltGlyph({ size = 20, color = CORAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Polygon
        points="57,8 26,54 45,54 43,92 74,44 55,44"
        fill={color}
        stroke={color}
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── Compact empty activity state ─────────────────────────────

function EmptyActivity({ message }: { message: string }) {
  const colors = useColors();
  const styles = useStyles();
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(withTiming(360, { duration: 14000, easing: REasing.linear }), -1);
  }, [spin]);

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  return (
    <View style={styles.emptyActivity}>
      <View style={styles.emptyOrbitWrap}>
        <Animated.View style={[styles.emptyOrbit, orbitStyle]} />
        <BoltGlyph size={22} color={colors.ui.ink(0.35)} />
      </View>
      <Text style={styles.emptyActivityText}>{message}</Text>
    </View>
  );
}

export default function DashboardScreen({ navigation }: Props) {
  const colors = useColors();
  const { scheme } = useTheme();
  const styles = useStyles();
  const lightStyles = useLightStyles();
  const isFocused = useIsFocused();
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { wallet, loading: walletLoading, error: walletError, refreshBalance } = useWallet();
  // 30 rows: Home's spending card counts the last seven days.
  const { transactions, loading: txLoading, error: txError, refresh: refreshTx } = useTransactions(undefined, 30);
  // The balance is live but the list is fetched once, so after a payment Home
  // showed the new balance over an old list and spending total. Every posting
  // moves the wallet's lastTransactionAt (money in too): fetch again then.
  const lastTxAt = wallet?.lastTransactionAt?.getTime() ?? null;
  const seenLastTxAt = useRef<number | null>(null);
  useEffect(() => {
    if (lastTxAt === null || lastTxAt === seenLastTxAt.current) return;
    const firstSeen = seenLastTxAt.current === null;
    seenLastTxAt.current = lastTxAt;
    if (!firstSeen) refreshTx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTxAt]);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);
  // Home shows one balance; the currency button switches to the other.
  const { currency: homeCurrency, switchCurrency } = useHomeCurrency(
    wallet?.balanceCents ?? 0,
    wallet?.slsBalance ?? 0
  );
  // The status bar follows the canvas once the coral header has scrolled away.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [pastHeader, setPastHeader] = useState(false);

  const { requests: pendingRequests } = usePaymentRequests();
  // With only the agent way open, Top up goes straight there: no one-card menu.
  const zaadTopupsOpen = useZaadTopups();
  const openTopUp = useCallback(() => {
    triggerHaptic('light');
    navigation.navigate(zaadTopupsOpen ? 'TopUpMethod' : 'AgentTopup');
  }, [navigation, zaadTopupsOpen]);
  const { isConnected } = useNetworkStatus();
  const { profile } = useUserProfile();

  const [qrVisible, setQrVisible] = useState(false);
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrSecondsLeft, setQrSecondsLeft] = useState(0);
  /** The code on screen, so pressing Show again keeps it while it's still valid. */
  const qrTokenRef = useRef<TokenResponse | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrPrewarmRef = useRef<Promise<void> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<View>(null);
  const qrCardRef = useRef<View>(null);

  const QR_DISPLAY_SECONDS = 30;

  // Balance card entrance animation
  const balanceCardY = useSharedValue(24);
  const balanceCardOpacity = useSharedValue(0);
  // Same single Cloud Function call that would happen on tap — just earlier.
  useEffect(() => {
    qrPrewarmRef.current = resolveReceiveToken({ forceRefresh: false })
      .then(() => {})
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!walletLoading) {
      balanceCardY.value = withSpring(0, Springs.transition);
      balanceCardOpacity.value = withTiming(1, { duration: 300 });
    }
  }, [walletLoading, balanceCardY, balanceCardOpacity]);

  const balanceCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: balanceCardY.value }],
    opacity: balanceCardOpacity.value,
  }));

  const clearQrTimers = useCallback(() => {
    if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null; }
    if (qrAutoHideRef.current) { clearTimeout(qrAutoHideRef.current); qrAutoHideRef.current = null; }
  }, []);

  const hideQr = useCallback(() => {
    clearQrTimers();
    setQrVisible(false);
    setQrValue(null);
    setQrSecondsLeft(0);
  }, [clearQrTimers]);

  // Shown for QR_DISPLAY_SECONDS, or until the code itself expires if sooner.
  const startQrTimers = useCallback((token: TokenResponse) => {
    const seconds = Math.max(1, Math.min(QR_DISPLAY_SECONDS, secondsLeftFromToken(token) - 5));
    setQrSecondsLeft(seconds);

    if (qrTimerRef.current) clearInterval(qrTimerRef.current);
    qrTimerRef.current = setInterval(() => {
      setQrSecondsLeft((prev) => {
        if (prev <= 1) {
          if (qrTimerRef.current) clearInterval(qrTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    if (qrAutoHideRef.current) clearTimeout(qrAutoHideRef.current);
    qrAutoHideRef.current = setTimeout(hideQr, seconds * 1000);
  }, [hideQr]);

  const showQr = useCallback(async () => {
    // A code is already on screen and still scannable: keep it, just show it
    // for longer. A new one would cancel the one the customer is showing.
    const current = qrTokenRef.current;
    if (qrVisible && isTokenStillValid(current)) {
      triggerHaptic('light');
      startQrTimers(current!);
      return;
    }
    try {
      setQrLoading(true);
      triggerHaptic('medium');

      // Wait for background prewarm if still in flight (avoids a duplicate network call).
      // If already done, this resolves instantly and the next resolveReceiveToken hits AsyncStorage.
      if (qrPrewarmRef.current) {
        await qrPrewarmRef.current;
        qrPrewarmRef.current = null;
      }

      const token = await resolveReceiveToken({ forceRefresh: false });
      qrTokenRef.current = token;
      setQrValue(token.tokenData);
      setQrVisible(true);
      startQrTimers(token);
    } catch (e: unknown) {
      // No stand-in QR: nothing can scan one, so it would only look like it works.
      triggerHaptic('light');
      Alert.alert(t('common.error'), t(receiveQrErrorKey(e)));
    } finally {
      setQrLoading(false);
    }
  }, [qrVisible, startQrTimers, t]);

  const scrollQrIntoFocus = useCallback(() => {
    const content = scrollContentRef.current;
    const qrCard = qrCardRef.current;
    if (!content || !qrCard) {
      return;
    }

    qrCard.measureLayout(
      content,
      (_x, y, _w, height) => {
        const visibleHeight = windowHeight - insets.top - insets.bottom - TAB_BAR_HEIGHT;
        const targetY = y - visibleHeight / 2 + height / 2;
        scrollRef.current?.scrollTo({ y: Math.max(0, targetY), animated: true });
      },
      () => {},
    );
  }, [windowHeight, insets.top, insets.bottom]);

  useEffect(() => {
    if (!qrVisible || !qrValue) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      setTimeout(scrollQrIntoFocus, 80);
    });
    return () => cancelAnimationFrame(frame);
  }, [qrVisible, qrValue, scrollQrIntoFocus]);

  useEffect(() => {
    return () => clearQrTimers();
  }, [clearQrTimers]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshBalance(), refreshTx()]);
    setRefreshing(false);
  };

  if (walletLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.action.primary} />
      </View>
    );
  }

  const errorMessage = walletError || txError;
  const onToggleBalance = () => {
    triggerHaptic('light');
    setBalanceVisible((prev) => !prev);
  };
  const onSwitchCurrency = () => {
    triggerHaptic('light');
    switchCurrency();
  };

  const offlineBanner = !isConnected && (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineBannerText}>{t('dashboard.offlineMessage')}</Text>
    </View>
  );
  const errorBanner = errorMessage != null && (
    <TouchableOpacity style={styles.errorBanner} onPress={onRefresh}>
      <Text style={styles.errorBannerText}>{t('dashboard.errorRetry')}</Text>
    </TouchableOpacity>
  );
  const businessBanner = profile && profile.accountType !== 'customer' && (
    <View style={styles.businessBanner}>
      <Text style={styles.businessBannerTitle}>{t('dashboard.businessAccount.title')}</Text>
      <Text style={styles.businessBannerText}>{t('dashboard.businessAccount.body')}</Text>
    </View>
  );
  const pendingSection = pendingRequests.length > 0 && (
    <View style={styles.pendingSection}>
      <Text style={styles.pendingSectionTitle}>{t('dashboard.pendingRequests')}</Text>
      {pendingRequests.map((req) => (
        <TouchableOpacity
          key={req.id}
          style={styles.pendingCard}
          onPress={() => {
            triggerHaptic('light');
            navigation.navigate('ApprovePayment', {
              requestId: req.id,
              merchantName: req.merchantName,
              amount: req.amount,
              currency: req.currency,
              createdAt: req.createdAt.toISOString(),
              ...(req.reference ? { reference: req.reference } : {}),
            });
          }}
        >
          <View style={styles.pendingCardContent}>
            <View>
              <Text style={styles.pendingTitle}>{req.merchantName}</Text>
              <Text style={styles.pendingAmount}>
                {CURRENCY_SYMBOL}{(req.amount / 100).toFixed(2)}
              </Text>
            </View>
            <Text style={styles.pendingReview}>{t('common.review')}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
  const walletEmpty = (wallet?.balance ?? 0) === 0 && (wallet?.slsBalance ?? 0) === 0;
  // The coral wallpaper runs under the top of the body, where a
  // see-through coral banner disappears. A solid card, like the others.
  const lightNudge = walletEmpty && (
    <TouchableOpacity
      style={lightStyles.nudge}
      activeOpacity={0.85}
      onPress={openTopUp}
      accessibilityRole="button"
    >
      <View style={lightStyles.nudgeIcon}>
        <BoltGlyph size={20} color="#FFFFFF" />
      </View>
      <View style={lightStyles.linkText}>
        <Text style={lightStyles.linkTitle}>{t('dashboard.firstTopUpTitle')}</Text>
        <Text style={lightStyles.linkSub}>{t('dashboard.firstTopUpSubtitle')}</Text>
      </View>
      <Text style={lightStyles.nudgeArrow}>→</Text>
    </TouchableOpacity>
  );
  const qrCard = qrVisible && qrValue ? (
    <View ref={qrCardRef} collapsable={false}>
      <Card style={styles.qrCard}>
      <View style={styles.qrHeader}>
        <Text style={styles.qrTitle}>{t('dashboard.myQrCode')}</Text>
        <TouchableOpacity
          onPress={hideQr}
          style={styles.qrHideButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.hide')}
        >
          <Text style={styles.qrHideText}>{t('common.hide')}</Text>
        </TouchableOpacity>
      </View>
      <View
        style={styles.qrCodeWrapper}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('dashboard.myQrCode')}
      >
        <QRCode
          value={qrValue}
          size={180}
          backgroundColor="#FFFFFF"
          color="#000000"
        />
      </View>
      <Text style={styles.qrHint}>{t('dashboard.qrHint')}</Text>
      <View style={[styles.qrTimerPill, qrSecondsLeft <= 10 && styles.qrTimerPillWarning]}>
        <Text style={[styles.qrTimerText, qrSecondsLeft <= 10 && styles.qrTimerTextWarning]}>
          {t('dashboard.qrTimer', { seconds: qrSecondsLeft })}
        </Text>
      </View>
    </Card>
    </View>
  ) : null;

  return (
    <>
      {isFocused && (
        <StatusBar
          animated
          barStyle={pastHeader && scheme === 'light' ? 'dark-content' : 'light-content'}
          backgroundColor={pastHeader ? colors.ui.canvas : wallpaper.top}
        />
      )}
      <ScrollView
        ref={scrollRef}
        style={lightStyles.container}
        contentContainerStyle={lightStyles.content}
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
        <View ref={scrollContentRef} collapsable={false}>
          <LightHomeHeader
            onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
            topInset={insets.top}
            initials={initialsOf(profile?.fullName)}
            usdCents={wallet?.balanceCents ?? 0}
            slsBalance={wallet?.slsBalance ?? 0}
            currency={homeCurrency}
            onSwitchCurrency={onSwitchCurrency}
            balanceVisible={balanceVisible}
            onToggleBalance={onToggleBalance}
            language={profile?.preferredLanguage}
            qrLoading={qrLoading}
            contentStyle={balanceCardStyle}
            onProfile={() => { triggerHaptic('light'); navigation.navigate('Profile'); }}
            onNotifications={() => { triggerHaptic('light'); navigation.navigate('Notifications'); }}
            onShowQr={showQr}
            onTopUp={openTopUp}
            onPay={() => { triggerHaptic('light'); navigation.navigate('ScanQR'); }}
            onGetCash={() => { triggerHaptic('light'); navigation.navigate('CashOut'); }}
          />

          <View style={lightStyles.body}>
            {offlineBanner}
            {errorBanner}
            {businessBanner}
            {pendingSection}
            {lightNudge}
            {qrCard}

            <View style={lightStyles.card}>
              {txLoading ? (
                <ActivityIndicator style={lightStyles.loader} color={colors.ui.accent} />
              ) : transactions.length === 0 ? (
                <EmptyActivity message={t('dashboard.noTransactionsMessage')} />
              ) : (
                transactions.slice(0, 3).map((tx: Transaction) => (
                  <TransactionItem
                    key={tx.id}
                    transaction={tx}
                    onPress={() => navigation.navigate('TransactionDetail', { transaction: tx })}
                  />
                ))
              )}
              <TouchableOpacity
                style={lightStyles.seeAll}
                onPress={() => navigation.navigate('History')}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={lightStyles.seeAllText}>{t('dashboard.seeAll')}</Text>
              </TouchableOpacity>
            </View>

            <HomeWidgets
              transactions={transactions}
              onSpending={() => { triggerHaptic('light'); navigation.navigate('Insights'); }}
              onInvite={() => { triggerHaptic('light'); navigation.navigate('Invite'); }}
            />

            <View style={lightStyles.card}>
              <TouchableOpacity
                style={lightStyles.linkRow}
                onPress={() => { triggerHaptic('light'); navigation.navigate('Payments'); }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <View style={[lightStyles.linkIcon, { backgroundColor: colors.tints.blue.fill }]}>
                  <SendIcon size={19} color={colors.tints.blue.mark} strokeWidth={1.9} />
                </View>
                <View style={lightStyles.linkText}>
                  <Text style={lightStyles.linkTitle}>{t('common.send')}</Text>
                  <Text style={lightStyles.linkSub}>{t('dashboard.sendText')}</Text>
                </View>
                <ChevronIcon size={18} color={colors.ui.textFaint} />
              </TouchableOpacity>
              <View style={lightStyles.linkDivider} />
              <TouchableOpacity
                style={lightStyles.linkRow}
                onPress={() => { triggerHaptic('light'); navigation.navigate('Bills'); }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <View style={[lightStyles.linkIcon, { backgroundColor: colors.tints.green.fill }]}>
                  <BillIcon size={19} color={colors.tints.green.mark} strokeWidth={1.9} />
                </View>
                <View style={lightStyles.linkText}>
                  <Text style={lightStyles.linkTitle}>{t('bills.title')}</Text>
                  <Text style={lightStyles.linkSub}>{t('dashboard.billsText')}</Text>
                </View>
                <ChevronIcon size={18} color={colors.ui.textFaint} />
              </TouchableOpacity>
              <View style={lightStyles.linkDivider} />
              <TouchableOpacity
                style={lightStyles.linkRow}
                onPress={() => { triggerHaptic('light'); navigation.navigate('AgentLocator'); }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <View style={[lightStyles.linkIcon, { backgroundColor: colors.tints.amber.fill }]}>
                  <PinIcon size={19} color={colors.tints.amber.mark} strokeWidth={1.9} />
                </View>
                <View style={lightStyles.linkText}>
                  <Text style={lightStyles.linkTitle}>{t('dashboard.findAgent')}</Text>
                  <Text style={lightStyles.linkSub}>{t('dashboard.findAgentText')}</Text>
                </View>
                <ChevronIcon size={18} color={colors.ui.textFaint} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  // ─── Screen ───
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.ui.canvas,
  },

  // ─── Banners ───
  offlineBanner: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  offlineBannerText: {
    ...typography.caption,
    color: colors.ui.textDim,
    textAlign: 'center' as const,
  },
  errorBanner: {
    backgroundColor: colors.ui.errorSoft,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.ui.error,
  },
  errorBannerText: {
    ...typography.bodySemibold,
    color: colors.ui.error,
  },
  businessBanner: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  businessBannerTitle: {
    ...typography.bodySemibold,
    color: colors.ui.text,
  },
  businessBannerText: {
    ...typography.body,
    color: colors.ui.textDim,
    marginTop: 4,
  },
  // ─── Pending requests ───
  pendingSection: {
    marginBottom: spacing.lg,
  },
  pendingSectionTitle: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: colors.ui.text,
    marginBottom: spacing.sm,
  },
  pendingCard: {
    backgroundColor: colors.ui.warningSoft,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.ui.warning,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pendingCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pendingTitle: {
    ...typography.bodySemibold,
    color: colors.ui.text,
  },
  pendingAmount: {
    ...typography.body,
    color: colors.ui.textDim,
    marginTop: spacing.xs,
  },
  pendingReview: {
    ...typography.captionBold,
    color: colors.ui.accentText,
  },
  // ─── Empty activity ───
  emptyActivity: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyOrbitWrap: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyOrbit: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.ui.ink(0.18),
  },
  emptyActivityText: {
    fontSize: 12,
    color: colors.ui.textFaint,
    marginTop: spacing.sm,
  },
  // ─── Expanded QR card ───
  qrCard: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: colors.ui.ink(0.09),
    borderColor: colors.ui.ink(0.16),
  },
  qrHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.md,
  },
  qrTitle: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: colors.ui.text,
  },
  qrHideButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.ui.glass,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
  qrHideText: {
    ...typography.captionBold,
    color: colors.ui.textDim,
  },
  qrCodeWrapper: {
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
    marginBottom: spacing.smPlus,
  },
  qrHint: {
    ...typography.body,
    color: colors.ui.textDim,
    marginBottom: spacing.smPlus,
  },
  qrTimerPill: {
    backgroundColor: colors.ui.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  qrTimerPillWarning: {
    backgroundColor: colors.ui.errorSoft,
  },
  qrTimerText: {
    ...typography.captionBold,
    color: colors.ui.accentText,
  },
  qrTimerTextWarning: {
    color: colors.ui.error,
  },
}));

// ─── Home: flat cards on the page, under the coral header ────
const useLightStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
  },
  content: {
    paddingBottom: spacing.xl,
  },
  body: {
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: colors.ui.surface,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 4,
    marginBottom: 12,
    overflow: 'hidden',
  },
  loader: {
    marginVertical: 28,
  },
  seeAll: {
    height: 48,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.ui.divider,
  },
  seeAllText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ui.accent,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
  },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.ui.surface,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  nudgeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CORAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeArrow: {
    fontSize: 18,
    fontWeight: '700',
    color: CORAL,
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    flex: 1,
    minWidth: 0,
  },
  linkTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.ui.text,
  },
  linkSub: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.ui.textFaint,
  },
  linkDivider: {
    height: 1,
    marginLeft: 52,
    backgroundColor: colors.ui.divider,
  },
}));
