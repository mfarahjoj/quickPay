/**
 * Shillings or dollars, for a screen where the customer types an amount.
 * The two balances never convert (SHILLINGS.md), so a payment is in one.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeStyles } from '../theme';
import { triggerHaptic } from '../services/haptics.service';
import type { Currency } from '../utils/money';

interface Props {
  value: Currency;
  onChange: (currency: Currency) => void;
}

export function CurrencySegment({ value, onChange }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {(['SLS', 'USD'] as Currency[]).map((c) => (
        <TouchableOpacity
          key={c}
          style={[styles.item, value === c && styles.itemOn]}
          onPress={() => {
            if (c === value) return;
            triggerHaptic('light');
            onChange(c);
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === c }}
        >
          <Text style={[styles.text, value === c && styles.textOn]}>
            {c === 'SLS' ? t('topup.zaad.shillings') : t('topup.zaad.dollars')}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  segment: {
    flexDirection: 'row', alignSelf: 'center', padding: 4, borderRadius: 14,
    backgroundColor: colors.ui.ink(0.06), marginBottom: 16,
  },
  item: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10 },
  itemOn: { backgroundColor: colors.ui.accentText },
  text: { fontSize: 14, fontWeight: '700', color: colors.ui.ink(0.6) },
  textOn: { color: colors.ui.onSolid },
}));
