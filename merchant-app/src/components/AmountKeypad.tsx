import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BackspaceIcon } from './icons/AuthIcons';
import { triggerHaptic } from '../services/haptics.service';
import { sanitizeAmountFor } from '../utils/money';
import { makeStyles, useColors } from '../theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

interface AmountKeypadProps {
  value: string;
  onChange: (next: string) => void;
  /** Height of one key. The caller sizes it to the phone. */
  keyHeight?: number;
  deleteLabel: string;
  /**
   * Whole shillings: no decimal point. The key left of 0 types "000"
   * instead, since shilling prices run to thousands.
   */
  wholeOnly?: boolean;
}

/**
 * The till's own number pad. Big fixed keys instead of the system keyboard:
 * nothing slides over the amount, and it can be worked one-handed at a
 * counter without looking.
 */
export function AmountKeypad({ value, onChange, keyHeight = 62, deleteLabel, wholeOnly }: AmountKeypadProps) {
  const colors = useColors();
  const styles = useStyles();
  const press = (key: (typeof KEYS)[number]) => {
    triggerHaptic('light');
    if (key === 'del') {
      onChange(value.slice(0, -1));
      return;
    }
    if (wholeOnly) {
      // Nothing to add zeros to on an empty pad.
      if (key === '.' && (value === '' || value === '0')) return;
      const typed = key === '.' ? '000' : key;
      onChange(sanitizeAmountFor((value === '0' ? '' : value) + typed, 'SLS'));
      return;
    }
    // "." on an empty pad means "0."; a leading zero is replaced, not kept.
    const base = key === '.' && value === '' ? '0' : value === '0' && key !== '.' ? '' : value;
    onChange(sanitizeAmountFor(base + key, 'USD'));
  };

  return (
    <View style={styles.pad}>
      {KEYS.map((key) => (
        <TouchableOpacity
          key={key}
          style={[styles.key, { height: keyHeight }]}
          onPress={() => press(key)}
          onLongPress={key === 'del' ? () => onChange('') : undefined}
          activeOpacity={0.5}
          accessibilityRole="button"
          accessibilityLabel={key === 'del' ? deleteLabel : key === '.' && wholeOnly ? '000' : key}
        >
          {key === 'del' ? (
            <BackspaceIcon size={26} color={colors.ui.ink(0.8)} />
          ) : (
            <Text style={styles.keyText}>{key === '.' && wholeOnly ? '000' : key}</Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
  },
  key: {
    width: '33.333%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: {
    fontSize: 30,
    fontWeight: '600',
    color: colors.ui.text,
    fontVariant: ['tabular-nums'],
  },
}));
