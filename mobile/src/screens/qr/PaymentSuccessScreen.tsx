import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, Share, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { makeStyles, useColors, wallpaper } from '../../theme';
import { Wallpaper } from '../../components/Wallpaper';
import { CheckIcon, ShareIcon } from '../../components/icons/LineIcons';
import { formatMajor } from '../../utils/money';
import { triggerHaptic } from '../../services/haptics.service';
import { Springs } from '../../constants/springs';

interface Props {
  navigation: any;
  route: {
    params: {
      transactionId: string;
      receiptNumber?: string;
      amount: number;
      currency: string;
      merchantId?: string;
      merchantName?: string;
    };
  };
}

// ─── Main screen ──────────────────────────────────────────────

export default function PaymentSuccessScreen({ navigation, route }: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const { transactionId, receiptNumber, amount, currency, merchantName } = route.params;
  // Paid celebrates on the coral wallpaper.
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const [paidAt] = useState(() => new Date());

  // Content stagger shared values
  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(14);
  const cardOpacity = useSharedValue(0);
  const cardY = useSharedValue(14);
  const buttonOpacity = useSharedValue(0);

  // Ring bloom behind checkmark
  const ringScale = useSharedValue(0.8);
  const ringOpacity = useSharedValue(0.35);

  useEffect(() => {
    // Immediate: haptic + ring bloom
    triggerHaptic('success');

    ringScale.value = withSpring(2.2, Springs.celebration);
    ringOpacity.value = withTiming(0, { duration: 700 });

    // Stagger content in
    titleOpacity.value = withDelay(300, withTiming(1, { duration: 280 }));
    titleY.value = withDelay(300, withSpring(0, Springs.transition));

    cardOpacity.value = withDelay(480, withTiming(1, { duration: 280 }));
    cardY.value = withDelay(480, withSpring(0, Springs.transition));

    buttonOpacity.value = withDelay(650, withTiming(1, { duration: 240 }));

    // Confirmation echo haptic
    const echo = setTimeout(() => triggerHaptic('light'), 600);

    return () => {
      clearTimeout(echo);
    };
  }, [ringOpacity, ringScale, titleOpacity, titleY, cardOpacity, cardY, buttonOpacity]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardY.value }],
  }));

  const buttonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
  }));

  const handleDone = () => {
    triggerHaptic('light');
    navigation.navigate('MainTabs', { screen: 'Home' });
  };

  // Whole units of the payment's currency: "$12.50" or "30,000 SLSH".
  const amountText = formatMajor(amount, currency);
  // The Zapp receipt number when the backend issued one; the start of the
  // transaction id for a payment from before they existed.
  const reference = receiptNumber ?? transactionId.slice(0, 12);

  const handleShare = () => {
    triggerHaptic('light');
    Share.share({
      title: t('payments.receiptShareTitle'),
      message: t('qr.success.shareMessage', {
        amount: amountText,
        merchant: merchantName || t('common.merchant'),
        reference,
      }),
    }).catch(() => undefined);
  };

  const time = paidAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = paidAt.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={wallpaper.top} />
      <Wallpaper />
      <View style={[styles.body, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.hero}>
          <View style={styles.ringOuter} />
          <View style={styles.ringInner} />
          <Animated.View style={[styles.bloom, ringStyle]} pointerEvents="none" />
          <View style={styles.checkCircle}>
            <CheckIcon size={46} color={colors.ui.accent} strokeWidth={2.6} />
          </View>
        </View>

        <Animated.View style={[styles.titleBlock, titleStyle]}>
          <Text style={styles.title}>{t('qr.success.paid')}</Text>
          <Text style={styles.subtitle}>
            {merchantName ? t('qr.success.paidTo', { amount: amountText, merchant: merchantName }) : amountText}
          </Text>
        </Animated.View>

        <Animated.View style={[styles.card, cardStyle]}>
          <View style={[styles.row, styles.rowDivider]}>
            <Text style={styles.rowKey}>
              {receiptNumber ? t('qr.success.receipt') : t('qr.success.reference')}
            </Text>
            <Text style={styles.rowValue}>{reference}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowKey}>{t('qr.success.date')}</Text>
            <Text style={styles.rowValue}>{`${day}, ${time}`}</Text>
          </View>
        </Animated.View>

        <View style={styles.spacer} />

        <Animated.View style={[styles.buttons, buttonStyle]}>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={handleShare}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <ShareIcon size={20} color="#FFFFFF" strokeWidth={2.1} />
            <Text style={styles.shareText}>{t('common.share')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={handleDone}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.doneText}>{t('qr.success.done')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

// ─── Light: the coral wallpaper, a white check, a white receipt ─
const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: wallpaper.top,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
  hero: {
    alignSelf: 'center',
    width: 196,
    height: 196,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringOuter: {
    position: 'absolute',
    width: 196,
    height: 196,
    borderRadius: 98,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ringInner: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bloom: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  checkCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#500A1E',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  titleBlock: {
    marginTop: 18,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '700',
    letterSpacing: -1,
  },
  subtitle: {
    marginTop: 6,
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  card: {
    marginTop: 28,
    paddingHorizontal: 18,
    paddingVertical: 4,
    borderRadius: 24,
    backgroundColor: colors.ui.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 50,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.ui.divider,
  },
  rowKey: {
    fontSize: 14,
    color: colors.ui.textFaint,
  },
  rowValue: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.ui.text,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  spacer: {
    flex: 1,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  shareButton: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(20,17,15,0.22)',
    borderWidth: 1,
    borderColor: wallpaper.glassBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  doneButton: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    color: colors.ui.text,
    fontSize: 17,
    fontWeight: '600',
  },
}));
