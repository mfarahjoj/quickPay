import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, ScrollView, RefreshControl, ActivityIndicator, Alert, useWindowDimensions, StatusBar } from 'react-native';
import Svg, { Path, Polygon } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '../../hooks/useWallet';
import { useTransactions } from '../../hooks/useTransactions';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { Card } from '../../components/Card';
import { TransactionItem } from '../../components/TransactionItem';
import { Transaction } from '../../types';
import { triggerHaptic } from '../../services/haptics.service';
import { usePaymentRequests } from '../../hooks/usePaymentRequests';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUserProfile } from '../../hooks/useUserProfile';
import { resolveReceiveToken, buildLocalCustomerQrPayload } from '../../services/customerToken.service';
import { LanguageSelector } from '../../components/LanguageSelector';
import { QrCodeIcon } from '../../components/icons/AuthIcons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  withRepeat,
  Easing as REasing,
} from 'react-native-reanimated';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { Springs } from '../../constants/springs';

interface Props {
  navigation: any;
}

const TAB_BAR_HEIGHT = 49;

const CORAL = colors.dark.accent;

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

function PlusGlyph({ size = 20, color = CORAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5 V19 M5 12 H19" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </Svg>
  );
}

function BellGlyph({ size = 18, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 4 A6 6 0 0 0 6 10 V14 L4.5 17 H19.5 L18 14 V10 A6 6 0 0 0 12 4 Z M10 19.5 A2 2 0 0 0 14 19.5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CashGlyph({ size = 20, color = CORAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 8 H21 V18 H3 Z" stroke={color} strokeWidth="1.9" strokeLinejoin="round" />
      <Path d="M12 15.5 A2.5 2.5 0 1 0 12 10.5 A2.5 2.5 0 0 0 12 15.5 Z" stroke={color} strokeWidth="1.9" />
      <Path d="M7 5.5 H17" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </Svg>
  );
}

// ─── Compact empty activity state ─────────────────────────────

function EmptyActivity({ message }: { message: string }) {
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
        <BoltGlyph size={22} color="rgba(255,255,255,0.35)" />
      </View>
      <Text style={styles.emptyActivityText}>{message}</Text>
    </View>
  );
}

// ─── Action tile with motion system ───────────────────────────
// Entrance cascade, press squish + coral flash, icon personality,
// idle attractor wiggle. All transforms/opacity — native driver.

type TilePersonality = 'qr' | 'plus' | 'bolt' | 'cash';

interface ActionTileProps {
  label: string;
  personality: TilePersonality;
  index: number;
  idleTick: number;
  onPress: () => void;
  loading?: boolean;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

function ActionTile({
  label,
  personality,
  index,
  idleTick,
  onPress,
  loading,
  accessibilityLabel,
  children,
}: ActionTileProps) {
  const enter = useSharedValue(0);
  const scale = useSharedValue(1);
  const flash = useSharedValue(0);
  const iconRot = useSharedValue(0);
  const iconY = useSharedValue(0);
  const iconScale = useSharedValue(1);
  const scanY = useSharedValue(-14);
  const scanOp = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(index * 70, withSpring(1, { damping: 14, stiffness: 160 }));
  }, [enter, index]);

  // Idle attractor: one tile wiggles at a time, rotating through the row.
  useEffect(() => {
    if (idleTick === 0 || (idleTick - 1) % 4 !== index) return;
    iconRot.value = withSequence(
      withTiming(-8, { duration: 170 }),
      withTiming(6, { duration: 170 }),
      withTiming(-3, { duration: 140 }),
      withTiming(0, { duration: 140 }),
    );
  }, [idleTick, index, iconRot]);

  const playPersonality = () => {
    switch (personality) {
      case 'qr':
        scanY.value = -14;
        scanOp.value = withSequence(withTiming(1, { duration: 80 }), withDelay(340, withTiming(0, { duration: 120 })));
        scanY.value = withTiming(14, { duration: 480 });
        break;
      case 'plus':
        iconRot.value = withSequence(
          withTiming(112, { duration: 280 }),
          withSpring(90, { damping: 12, stiffness: 240 }),
          withTiming(0, { duration: 0 }),
        );
        break;
      case 'bolt':
        iconScale.value = withSequence(withTiming(1.15, { duration: 120 }), withSpring(1, { damping: 10, stiffness: 220 }));
        iconRot.value = withSequence(
          withTiming(-14, { duration: 120 }),
          withTiming(10, { duration: 130 }),
          withTiming(-4, { duration: 120 }),
          withTiming(0, { duration: 110 }),
        );
        break;
      case 'cash':
        iconY.value = withSequence(
          withTiming(-9, { duration: 170 }),
          withTiming(2, { duration: 140 }),
          withTiming(-4, { duration: 120 }),
          withTiming(0, { duration: 120 }),
        );
        break;
    }
  };

  const handlePress = () => {
    flash.value = 1;
    flash.value = withTiming(0, { duration: 620 });
    playPersonality();
    onPress();
  };

  const tileStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 24 },
      { scale: scale.value },
    ],
  }));

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${iconRot.value}deg` },
      { translateY: iconY.value },
      { scale: iconScale.value },
    ],
  }));

  const scanStyle = useAnimatedStyle(() => ({
    opacity: scanOp.value,
    transform: [{ translateY: scanY.value }],
  }));

  return (
    <Animated.View style={[styles.tile, tileStyle]}>
      <Pressable
        style={styles.tilePress}
        onPress={handlePress}
        disabled={loading}
        onPressIn={() => {
          scale.value = withSpring(0.92, { damping: 20, stiffness: 320 });
        }}
        onPressOut={() => {
          scale.value = withSequence(
            withSpring(1.04, { damping: 16, stiffness: 280 }),
            withSpring(1, { damping: 14, stiffness: 220 }),
          );
        }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <Animated.View pointerEvents="none" style={[styles.tileFlash, flashStyle]} />
        <View style={styles.tileIconBox}>
          {loading ? (
            <ActivityIndicator size="small" color={CORAL} />
          ) : (
            <Animated.View style={iconStyle}>{children}</Animated.View>
          )}
          {personality === 'qr' && <Animated.View pointerEvents="none" style={[styles.tileScanLine, scanStyle]} />}
        </View>
        <Text style={styles.tileLabel}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function DashboardScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { wallet, loading: walletLoading, error: walletError, refreshBalance } = useWallet();
  const { transactions, loading: txLoading, error: txError, refresh: refreshTx } = useTransactions(undefined, 5);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [idleTick, setIdleTick] = useState(0);

  // Idle attractor: nudge one action tile every few seconds
  useEffect(() => {
    const interval = setInterval(() => setIdleTick((v) => v + 1), 4200);
    return () => clearInterval(interval);
  }, []);
  const { requests: pendingRequests } = usePaymentRequests();
  const { isConnected } = useNetworkStatus();
  const { profile, firstName } = useUserProfile();

  const [qrVisible, setQrVisible] = useState(false);
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrSecondsLeft, setQrSecondsLeft] = useState(0);
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
  const balanceVeil = useSharedValue(1); // 1 = visible, 0.2 = hidden

  // Pre-warm QR token in background so first "Show" tap is instant.
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

  useEffect(() => {
    balanceVeil.value = withTiming(balanceVisible ? 1 : 0.2, { duration: 150 });
  }, [balanceVisible, balanceVeil]);

  const balanceCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: balanceCardY.value }],
    opacity: balanceCardOpacity.value,
  }));

  const balanceVeilStyle = useAnimatedStyle(() => ({
    opacity: balanceVeil.value,
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

  const startQrTimers = useCallback(() => {
    setQrSecondsLeft(QR_DISPLAY_SECONDS);

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
    qrAutoHideRef.current = setTimeout(hideQr, QR_DISPLAY_SECONDS * 1000);
  }, [hideQr]);

  const showQr = useCallback(async () => {
    try {
      setQrLoading(true);
      triggerHaptic('medium');

      // Wait for background prewarm if still in flight (avoids a duplicate network call).
      // If already done, this resolves instantly and the next resolveReceiveToken hits AsyncStorage.
      if (qrPrewarmRef.current) {
        await qrPrewarmRef.current;
        qrPrewarmRef.current = null;
      }

      try {
        const token = await resolveReceiveToken({ forceRefresh: false });
        setQrValue(token.tokenData);
      } catch {
        const fallback = buildLocalCustomerQrPayload();
        if (!fallback) {
          Alert.alert(t('common.error'), t('dashboard.qrSignInRequired'));
          return;
        }
        setQrValue(fallback);
      }

      setQrVisible(true);
      startQrTimers();
    } catch (e: any) {
      triggerHaptic('light');
      Alert.alert(t('common.error'), e?.message || t('dashboard.qrError'));
    } finally {
      setQrLoading(false);
    }
  }, [startQrTimers, t]);

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

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.glowInner} pointerEvents="none" />
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.dark.accent}
        />
      }
    >
      <View ref={scrollContentRef} collapsable={false}>
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>{t('dashboard.offlineMessage')}</Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.greetingSmall}>{t('dashboard.salaam')}</Text>
          <Text style={styles.greetingName} numberOfLines={1}>
            {firstName || t('dashboard.welcomeFallback')}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => { triggerHaptic('light'); navigation.navigate('Notifications'); }}
            accessibilityRole="button"
            accessibilityLabel={t('nav.screen.notifications')}
          >
            <BellGlyph size={18} color={colors.dark.text} />
          </TouchableOpacity>
          <LanguageSelector currentLanguage={profile?.preferredLanguage} compact />
        </View>
      </View>

      {errorMessage != null && (
        <TouchableOpacity style={styles.errorBanner} onPress={onRefresh}>
          <Text style={styles.errorBannerText}>{t('dashboard.errorRetry')}</Text>
        </TouchableOpacity>
      )}

      {/* Pending requests */}
      {pendingRequests.length > 0 && (
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
      )}

      {/* ─── PRIMARY ZONE: Balance (open, no card) ─── */}
      <Animated.View style={balanceCardStyle}>
        <TouchableOpacity activeOpacity={0.9} onPress={onToggleBalance} style={styles.balanceBlock}>
          <View style={styles.balanceHeader}>
            <Text style={styles.balanceLabel}>{t('dashboard.availableBalance')}</Text>
            <Text style={styles.eyeIcon}>
              {balanceVisible ? t('common.hide') : t('common.show')}
            </Text>
          </View>
          <Animated.View style={[balanceVeilStyle, styles.balanceAmountWrap]}>
            {balanceVisible ? (
              <AnimatedNumber
                value={wallet?.balance ?? 0}
                prefix={CURRENCY_SYMBOL}
                decimals={2}
                style={styles.balanceAmount}
              />
            ) : (
              <Text style={styles.balanceAmount}>••••••</Text>
            )}
          </Animated.View>
        </TouchableOpacity>

        {/* Action tiles: cascade in, squish on press, icons react in character */}
        <View style={styles.tilesRow}>
          <ActionTile
            label={t('dashboard.tileShowQr')}
            personality="qr"
            index={0}
            idleTick={idleTick}
            onPress={showQr}
            loading={qrLoading}
            accessibilityLabel={t('dashboard.showMyQrCode')}
          >
            <QrCodeIcon size={20} color={CORAL} />
          </ActionTile>
          <ActionTile
            label={t('dashboard.tileTopUp')}
            personality="plus"
            index={1}
            idleTick={idleTick}
            onPress={() => { triggerHaptic('light'); navigation.navigate('TopUpMethod'); }}
          >
            <PlusGlyph size={20} />
          </ActionTile>
          <ActionTile
            label={t('dashboard.tilePay')}
            personality="bolt"
            index={2}
            idleTick={idleTick}
            onPress={() => { triggerHaptic('light'); navigation.navigate('ScanQR'); }}
          >
            <BoltGlyph size={20} />
          </ActionTile>
          <ActionTile
            label={t('dashboard.tileCashOut')}
            personality="cash"
            index={3}
            idleTick={idleTick}
            onPress={() => { triggerHaptic('light'); navigation.navigate('CashOut'); }}
          >
            <CashGlyph size={20} />
          </ActionTile>
        </View>

        {/* Activation nudge for empty wallets */}
        {(wallet?.balance ?? 0) === 0 && (
          <TouchableOpacity
            style={styles.nudgeBanner}
            activeOpacity={0.85}
            onPress={() => { triggerHaptic('light'); navigation.navigate('TopUpMethod'); }}
          >
            <View style={styles.nudgeIcon}>
              <BoltGlyph size={20} color="#FFFFFF" />
            </View>
            <View style={styles.nudgeText}>
              <Text style={styles.nudgeTitle}>{t('dashboard.firstTopUpTitle')}</Text>
              <Text style={styles.nudgeSubtitle}>{t('dashboard.firstTopUpSubtitle')}</Text>
            </View>
            <Text style={styles.nudgeArrow}>→</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Inline QR — shown right below balance for quick access */}
      {qrVisible && qrValue ? (
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
      ) : null}

      {/* ─── ACTIVITY ZONE: Transactions ─── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('dashboard.recentTransactions')}</Text>
        <TouchableOpacity onPress={() => navigation.navigate('History')}>
          <Text style={styles.seeAll}>{t('dashboard.seeAll')}</Text>
        </TouchableOpacity>
      </View>

      <Card style={styles.transactionsCard}>
        {txLoading ? (
          <ActivityIndicator style={styles.loader} color={colors.action.primary} />
        ) : transactions.length === 0 ? (
          <EmptyActivity message={t('dashboard.noTransactionsMessage')} />
        ) : (
          <View>
            {transactions.map((tx: Transaction) => (
              <TransactionItem
                key={tx.id}
                transaction={tx}
                onPress={() => navigation.navigate('TransactionDetail', { transaction: tx })}
              />
            ))}
          </View>
        )}
      </Card>

      {/* ─── DISCOVER ZONE: Quick access ─── */}
      <Text style={styles.discoverSectionTitle}>{t('dashboard.quickAccess')}</Text>

      {/* QR code row — expands when active (duplicate entry in discover zone) */}
      {!qrVisible && (
        <TouchableOpacity
          style={styles.discoverRow}
          onPress={showQr}
          disabled={qrLoading}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('dashboard.showMyQrCode')}
          accessibilityHint={t('dashboard.qrHint')}
        >
          <View style={[styles.discoverIconWrapper, styles.discoverIconQr]}>
            {qrLoading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <QrCodeIcon size={20} color={colors.text.primary} />
            }
          </View>
          <View style={styles.discoverTextWrapper}>
            <Text style={styles.discoverRowTitle}>{t('dashboard.showMyQrCode')}</Text>
            <Text style={styles.discoverRowSubtitle}>{t('dashboard.qrHint')}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      )}

      {/* Send */}
      <TouchableOpacity
        style={styles.discoverRow}
        onPress={() => { triggerHaptic('light'); navigation.navigate('Payments'); }}
        activeOpacity={0.7}
      >
        <View style={[styles.discoverIconWrapper, styles.discoverIconSend]}>
          <Text style={styles.discoverIcon}>↗</Text>
        </View>
        <View style={styles.discoverTextWrapper}>
          <Text style={styles.discoverRowTitle}>{t('common.send')}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {/* Find Agent */}
      <TouchableOpacity
        style={styles.discoverRow}
        onPress={() => { triggerHaptic('light'); navigation.navigate('AgentLocator'); }}
        activeOpacity={0.7}
      >
        <View style={[styles.discoverIconWrapper, styles.discoverIconAgent]}>
          <Text style={styles.discoverIcon}>📍</Text>
        </View>
        <View style={styles.discoverTextWrapper}>
          <Text style={styles.discoverRowTitle}>Find Agent</Text>
          <Text style={styles.discoverRowSubtitle}>Cash in or cash out near you</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {/* Invite & Earn */}
      <TouchableOpacity
        style={styles.discoverRow}
        onPress={() => { triggerHaptic('light'); navigation.navigate('Invite'); }}
        activeOpacity={0.7}
      >
        <View style={[styles.discoverIconWrapper, { backgroundColor: 'rgba(52,199,123,0.15)' }]}>
          <Text style={styles.discoverIcon}>🎁</Text>
        </View>
        <View style={styles.discoverTextWrapper}>
          <Text style={styles.discoverRowTitle}>{t('profile.invite')}</Text>
          <Text style={styles.discoverRowSubtitle}>{t('profile.inviteSubtitle')}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {/* Insights */}
      <TouchableOpacity
        style={[styles.discoverRow, styles.discoverRowLast]}
        onPress={() => { triggerHaptic('light'); navigation.navigate('Insights'); }}
        activeOpacity={0.7}
      >
        <View style={[styles.discoverIconWrapper, styles.discoverIconInsights]}>
          <Text style={styles.discoverIcon}>📊</Text>
        </View>
        <View style={styles.discoverTextWrapper}>
          <Text style={styles.discoverRowTitle}>{t('dashboard.insights')}</Text>
          <Text style={styles.discoverRowSubtitle}>{t('dashboard.insightsText')}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
      </View>
    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  // ─── Screen ───
  glow: {
    position: 'absolute',
    top: -120,
    alignSelf: 'center',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: colors.dark.accent,
    opacity: 0.1,
    zIndex: -1,
  },
  glowInner: {
    position: 'absolute',
    top: -40,
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.dark.accent,
    opacity: 0.07,
    zIndex: -1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dark.canvas,
  },

  // ─── Banners ───
  offlineBanner: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  offlineBannerText: {
    ...typography.caption,
    color: colors.dark.textDim,
    textAlign: 'center' as const,
  },
  errorBanner: {
    backgroundColor: colors.dark.errorSoft,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.dark.error,
  },
  errorBannerText: {
    ...typography.bodySemibold,
    color: colors.dark.error,
  },

  // ─── Header ───
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  greetingSmall: {
    fontSize: 12,
    color: colors.dark.textDim,
  },
  greetingName: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.dark.text,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Pending requests ───
  pendingSection: {
    marginBottom: spacing.lg,
  },
  pendingSectionTitle: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: colors.dark.text,
    marginBottom: spacing.sm,
  },
  pendingCard: {
    backgroundColor: colors.dark.warningSoft,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.dark.warning,
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
    color: colors.dark.text,
  },
  pendingAmount: {
    ...typography.body,
    color: colors.dark.textDim,
    marginTop: spacing.xs,
  },
  pendingReview: {
    ...typography.captionBold,
    color: colors.dark.accentText,
  },

  // ─── Balance (open, centered) ───
  balanceBlock: {
    alignItems: 'center',
    paddingTop: spacing.md,
    marginBottom: spacing.lg,
  },
  balanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 2,
  },
  balanceLabel: {
    fontSize: 12,
    color: colors.dark.textDim,
  },
  eyeIcon: {
    ...typography.captionBold,
    color: colors.dark.textFaint,
  },
  balanceAmountWrap: {
    alignItems: 'center',
  },
  balanceAmount: {
    fontSize: 54,
    fontWeight: '800',
    letterSpacing: -2.5,
    lineHeight: 62,
    color: colors.dark.text,
    fontVariant: ['tabular-nums'],
  },
  // ─── Action tiles ───
  tilesRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: spacing.md,
  },
  tile: {
    flex: 1,
  },
  tilePress: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 18,
    paddingTop: 14,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  tileFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,80,67,0.14)',
    borderWidth: 1,
    borderColor: CORAL,
    borderRadius: 18,
  },
  tileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,80,67,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileScanLine: {
    position: 'absolute',
    left: 5,
    right: 5,
    top: 18,
    height: 2,
    borderRadius: 2,
    backgroundColor: CORAL,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.dark.text,
  },

  // ─── Activation nudge ───
  nudgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,80,67,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,80,67,0.42)',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: spacing.lg,
  },
  nudgeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: CORAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeText: {
    flex: 1,
  },
  nudgeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.dark.text,
  },
  nudgeSubtitle: {
    fontSize: 11,
    color: colors.dark.textDim,
    marginTop: 1,
  },
  nudgeArrow: {
    fontSize: 17,
    fontWeight: '700',
    color: CORAL,
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
    borderColor: 'rgba(255,255,255,0.18)',
  },
  emptyActivityText: {
    fontSize: 12,
    color: colors.dark.textFaint,
    marginTop: spacing.sm,
  },

  balanceActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  balanceActionBtn: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  balanceActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceActionIconShow: {
    backgroundColor: colors.dark.accentSoft,
  },
  balanceActionIconAdd: {
    backgroundColor: colors.dark.incomingSoft,
  },
  balanceActionIconPay: {
    backgroundColor: colors.dark.warningSoft,
  },
  balanceActionIconCashOut: {
    backgroundColor: 'rgba(111,155,255,0.15)',
  },
  balanceActionIconText: {
    fontSize: 18,
    color: colors.dark.text,
  },
  balanceActionLabel: {
    ...typography.captionBold,
    color: colors.dark.textDim,
  },

  // ─── Section headers ───
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.dark.text,
  },
  seeAll: {
    ...typography.captionBold,
    color: colors.dark.accentText,
  },

  // ─── Transactions card ───
  transactionsCard: {
    padding: 0,
    overflow: 'hidden',
    marginBottom: spacing.xl,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderColor: 'rgba(255,255,255,0.16)',
  },
  emptyWrapper: {
    padding: spacing.lg,
  },
  loader: {
    marginVertical: spacing.xl,
  },

  // ─── Discover zone ───
  discoverSectionTitle: {
    ...typography.h3,
    color: colors.dark.text,
    marginBottom: spacing.md,
  },
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
  discoverRowLast: {
    marginBottom: 0,
  },
  discoverIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  discoverIconQr: {
    backgroundColor: colors.dark.accentSoft,
  },
  discoverIconSend: {
    backgroundColor: colors.dark.accentSoft,
  },
  discoverIconReceive: {
    backgroundColor: colors.dark.incomingSoft,
  },
  discoverIconAdd: {
    backgroundColor: colors.dark.incomingSoft,
  },
  discoverIconScan: {
    backgroundColor: colors.dark.warningSoft,
  },
  discoverIconInsights: {
    backgroundColor: colors.dark.glass,
  },
  discoverIconAgent: {
    backgroundColor: 'rgba(111,155,255,0.12)',
  },
  discoverIcon: {
    fontSize: 18,
    color: colors.dark.text,
  },
  discoverTextWrapper: {
    flex: 1,
  },
  discoverRowTitle: {
    ...typography.bodySemibold,
    color: colors.dark.text,
  },
  discoverRowSubtitle: {
    ...typography.caption,
    color: colors.dark.textFaint,
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    color: colors.dark.accentText,
    fontWeight: '300',
    lineHeight: 26,
  },

  // ─── Expanded QR card ───
  qrCard: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderColor: 'rgba(255,255,255,0.16)',
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
    color: colors.dark.text,
  },
  qrHideButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
  qrHideText: {
    ...typography.captionBold,
    color: colors.dark.textDim,
  },
  qrCodeWrapper: {
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
    marginBottom: spacing.smPlus,
  },
  qrHint: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.smPlus,
  },
  qrTimerPill: {
    backgroundColor: colors.dark.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  qrTimerPillWarning: {
    backgroundColor: colors.dark.errorSoft,
  },
  qrTimerText: {
    ...typography.captionBold,
    color: colors.dark.accentText,
  },
  qrTimerTextWarning: {
    color: colors.dark.error,
  },
});
