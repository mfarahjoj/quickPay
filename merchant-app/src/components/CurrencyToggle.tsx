/**
 * Shillings or dollars, side by side. Float in each currency is held apart
 * and never converted (SHILLINGS.md), so screens that move float ask which.
 */

import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../theme';

export type FloatCurrency = 'USD' | 'SLS';

interface Props {
  value: FloatCurrency;
  onChange: (currency: FloatCurrency) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function CurrencyToggle({ value, onChange, disabled, style }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const options: Array<{ currency: FloatCurrency; label: string }> = [
    { currency: 'SLS', label: t('currency.shillings') },
    { currency: 'USD', label: t('currency.dollars') },
  ];
  return (
    <View style={[styles.row, style]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.currency === value;
        return (
          <TouchableOpacity
            key={o.currency}
            style={[styles.item, on && styles.itemOn]}
            onPress={() => onChange(o.currency)}
            disabled={disabled}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
          >
            <Text style={[styles.text, on && styles.textOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.ui.glass,
    borderColor: colors.ui.glassBorder,
    borderWidth: 1,
    borderRadius: 999,
    padding: 4,
  },
  item: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' },
  itemOn: { backgroundColor: colors.ui.solid },
  text: { fontSize: 15, fontWeight: '700', color: colors.ui.textDim },
  textOn: { color: colors.ui.onSolid },
}));
