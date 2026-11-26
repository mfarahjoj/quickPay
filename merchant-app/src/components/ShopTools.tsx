import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChartIcon, DisplayIcon, PeopleIcon } from './icons/AuthIcons';
import { useCounterDisplayOn } from '../hooks/useCounterDisplayOn';
import { makeStyles, useColors } from '../theme';
import type { Tint } from '../theme/colors';

/** One of the shop's features, as Home lists it. */
export interface ShopTool {
  key: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  tint: Tint;
  title: string;
  hint: string;
  route: string;
}

/**
 * The shop's features: the counter display, Zapp Business and staff. Only
 * accounts that take payments have them. API keys are not here on purpose:
 * most shops never need one, and a prominent row invites "Zapp support"
 * scams (they stay in Settings → Developers).
 */
export function useShopTools(takesPayments: boolean): ShopTool[] {
  const { t } = useTranslation();
  const colors = useColors();
  const counterDisplay = useCounterDisplayOn();
  if (!takesPayments) return [];
  return [
    // A tablet on the counter that shows the shop's QR and each sale
    // (only once config/app_client switches it on).
    ...(counterDisplay.on
      ? [{
          key: 'counterDisplay',
          Icon: DisplayIcon,
          tint: colors.tints.blue,
          title: t('counterDisplay.title'),
          hint: t('shopTools.counterDisplayHint'),
          route: 'CounterDisplays',
        }]
      : []),
    // The shop's live figures and insights on a computer (read-only).
    {
      key: 'zappBusiness',
      Icon: ChartIcon,
      tint: colors.tints.green,
      title: t('portal.title'),
      hint: t('shopTools.zappBusinessHint'),
      route: 'ZappBusiness',
    },
    // People who work for the shop on their own accounts (STAFF_ACCESS.md).
    {
      key: 'staff',
      Icon: PeopleIcon,
      tint: colors.tints.amber,
      title: t('staff.title'),
      hint: t('shopTools.staffHint'),
      route: 'Staff',
    },
  ];
}

/** A tool: tinted icon, name, and one line on what it does. */
export function ShopToolRow({ tool, onPress }: { tool: ShopTool; onPress: () => void }) {
  const styles = useStyles();
  const { Icon, tint } = tool;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${tool.title}. ${tool.hint}`}
    >
      <View style={[styles.icon, { backgroundColor: tint.fill }]}>
        <Icon size={20} color={tint.mark} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{tool.title}</Text>
        <Text style={styles.hint} numberOfLines={2}>
          {tool.hint}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ui.text,
    marginBottom: 2,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.ui.textFaint,
  },
  chevron: {
    fontSize: 20,
    color: colors.ui.ink(0.25),
    fontWeight: '300',
  },
}));
