import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeStyles, tints } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { GiftIcon } from '../icons/LineIcons';
import { lastSevenDaysSpend } from '../../utils/spending';
import type { Transaction } from '../../types';

const BAR_HEIGHT = 40;

interface Props {
  transactions: Transaction[];
  onSpending: () => void;
  onInvite: () => void;
}

/**
 * Two small cards under the activity on the light Home: the last seven days'
 * spending as bars (today in coral), opening Insights, and Invite & Earn.
 */
export function HomeWidgets({ transactions, onSpending, onInvite }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const days = useMemo(() => lastSevenDaysSpend(transactions), [transactions]);
  const total = days.reduce((sum, day) => sum + day.value, 0);
  const most = Math.max(...days.map((day) => day.value));
  const totalText = `${CURRENCY_SYMBOL}${total.toFixed(2)}`;

  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        onPress={onSpending}
        accessibilityRole="button"
        accessibilityLabel={`${t('dashboard.spent7Days')}: ${totalText}`}
      >
        <Text style={styles.label}>{t('dashboard.spent7Days')}</Text>
        <Text style={styles.total}>{totalText}</Text>
        <View style={styles.bars}>
          {days.map((day, i) => (
            <View
              key={day.start.getTime()}
              style={[
                styles.bar,
                { height: most > 0 ? Math.max(4, Math.round((day.value / most) * BAR_HEIGHT)) : 4 },
                i === days.length - 1 && styles.barToday,
              ]}
            />
          ))}
        </View>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.card, styles.invite, pressed && styles.pressed]}
        onPress={onInvite}
        accessibilityRole="button"
      >
        <View style={styles.giftCircle}>
          <GiftIcon size={19} color={tints.coral.mark} strokeWidth={1.9} />
        </View>
        <View>
          <Text style={styles.inviteTitle}>{t('profile.invite')}</Text>
          <Text style={styles.inviteText} numberOfLines={2}>
            {t('profile.inviteSubtitle')}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  card: {
    flex: 1,
    minHeight: 126,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: colors.ui.surface,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.ui.textFaint,
  },
  total: {
    marginTop: 2,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: colors.ui.text,
    fontVariant: ['tabular-nums'],
  },
  bars: {
    marginTop: 'auto',
    paddingTop: 10,
    height: BAR_HEIGHT + 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  bar: {
    width: 12,
    borderRadius: 4,
    backgroundColor: colors.ui.glassBorder,
  },
  barToday: {
    backgroundColor: colors.ui.accent,
  },
  invite: {
    justifyContent: 'space-between',
  },
  giftCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tints.coral.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.ui.text,
  },
  inviteText: {
    fontSize: 13,
    lineHeight: 17,
    color: colors.ui.textFaint,
  },
}));
