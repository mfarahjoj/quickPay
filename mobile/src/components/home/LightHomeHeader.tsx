import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Wallpaper } from '../Wallpaper';
import { LanguageSelector } from '../LanguageSelector';
import { BellIcon, CashIcon, EyeIcon, PersonIcon, PlusIcon, QrIcon, ScanIcon } from '../icons/LineIcons';
import { wallpaper } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import type { PreferredLanguage } from '../../types';

/** How far the wallpaper runs on under the first card below the header. */
const WALLPAPER_OVERLAP = 30;

interface Props {
  topInset: number;
  /** The customer's initials; a person icon when there are none. */
  initials: string;
  balance: number;
  currency: string;
  balanceVisible: boolean;
  onToggleBalance: () => void;
  language?: PreferredLanguage;
  qrLoading: boolean;
  /** Entrance animation for the balance and the buttons. */
  contentStyle?: React.ComponentProps<typeof Animated.View>['style'];
  onLayout?: (event: LayoutChangeEvent) => void;
  onProfile: () => void;
  onNotifications: () => void;
  onShowQr: () => void;
  onTopUp: () => void;
  onPay: () => void;
  onGetCash: () => void;
}

/**
 * The top of Home in light mode: the coral wallpaper with the profile,
 * language and notifications buttons, the balance, and the four actions as
 * round smoked-glass buttons.
 */
export function LightHomeHeader(props: Props) {
  const { t } = useTranslation();
  const [whole, cents] = props.balance.toFixed(2).split('.');

  const actions = [
    {
      key: 'qr',
      label: t('dashboard.tileShowQr'),
      a11y: t('dashboard.showMyQrCode'),
      Icon: QrIcon,
      onPress: props.onShowQr,
      loading: props.qrLoading,
    },
    { key: 'topup', label: t('dashboard.tileTopUp'), Icon: PlusIcon, onPress: props.onTopUp },
    { key: 'pay', label: t('dashboard.tilePay'), Icon: ScanIcon, onPress: props.onPay },
    { key: 'cash', label: t('dashboard.tileCashOut'), Icon: CashIcon, onPress: props.onGetCash },
  ];

  return (
    <View style={[styles.header, { paddingTop: props.topInset + 10 }]} onLayout={props.onLayout}>
      {/* Pulling down to refresh shows more coral, not the grey page. */}
      <View style={styles.overscroll} />
      <Wallpaper style={styles.wallpaper} />

      <View style={styles.topBar}>
        <Pressable
          onPress={props.onProfile}
          style={({ pressed }) => [styles.glassCircle, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('nav.tab.profile')}
        >
          {props.initials ? (
            <Text style={styles.initials}>{props.initials}</Text>
          ) : (
            <PersonIcon size={20} color="#FFFFFF" strokeWidth={1.9} />
          )}
        </Pressable>
        <View style={styles.topBarEnd}>
          <LanguageSelector currentLanguage={props.language} compact tone="onColor" />
          <Pressable
            onPress={props.onNotifications}
            style={({ pressed }) => [styles.glassCircle, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('nav.screen.notifications')}
          >
            <BellIcon size={20} color="#FFFFFF" strokeWidth={1.9} />
          </Pressable>
        </View>
      </View>

      <Animated.View style={props.contentStyle}>
        <View style={styles.balanceBlock}>
          <View style={styles.labelRow}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>
                {t('dashboard.availableBalance')} · {props.currency}
              </Text>
            </View>
            <Pressable
              onPress={props.onToggleBalance}
              hitSlop={10}
              style={({ pressed }) => [styles.eyeButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={props.balanceVisible ? t('common.hide') : t('common.show')}
            >
              <EyeIcon size={15} color="#FFFFFF" strokeWidth={2.2} off={!props.balanceVisible} />
            </Pressable>
          </View>
          {props.balanceVisible ? (
            <Text
              style={styles.amount}
              numberOfLines={1}
              adjustsFontSizeToFit
              accessibilityLabel={`${CURRENCY_SYMBOL}${props.balance.toFixed(2)}`}
            >
              {CURRENCY_SYMBOL}
              {whole}
              <Text style={styles.cents}>.{cents}</Text>
            </Text>
          ) : (
            <Text style={styles.amount}>••••••</Text>
          )}
        </View>

        <View style={styles.actions}>
          {actions.map(({ key, label, a11y, Icon, onPress, loading }) => (
            <Pressable
              key={key}
              style={styles.action}
              onPress={onPress}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={a11y ?? label}
            >
              {({ pressed }) => (
                <>
                  <View style={[styles.actionCircle, pressed && styles.actionPressed]}>
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Icon size={24} color="#FFFFFF" />
                    )}
                  </View>
                  <Text style={styles.actionLabel} numberOfLines={1}>
                    {label}
                  </Text>
                </>
              )}
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const glass = {
  backgroundColor: wallpaper.glass,
  borderWidth: 1,
  borderColor: wallpaper.glassBorder,
};

const styles = StyleSheet.create({
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
    height: 40,
  },
  topBarEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  glassCircle: {
    ...glass,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  initials: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  balanceBlock: {
    alignItems: 'center',
    marginTop: 26,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    ...glass,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    justifyContent: 'center',
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  eyeButton: {
    ...glass,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: {
    marginTop: 8,
    color: '#FFFFFF',
    fontSize: 64,
    lineHeight: 72,
    fontWeight: '700',
    letterSpacing: -2.5,
    fontVariant: ['tabular-nums'],
  },
  cents: {
    fontSize: 34,
    letterSpacing: -1,
  },
  actions: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 8,
  },
  action: {
    flex: 1,
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
  actionPressed: {
    backgroundColor: 'rgba(20,17,15,0.32)',
    transform: [{ scale: 0.94 }],
  },
  actionLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
  },
});
