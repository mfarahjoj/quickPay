import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BackspaceIcon } from './icons/AuthIcons';
import { triggerHaptic } from '../services/haptics.service';
import { sanitizeAmountInput } from '../utils/money';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

interface AmountKeypadProps {
  value: string;
  onChange: (next: string) => void;
  /** Height of one key. The caller sizes it to the phone. */
  keyHeight?: number;
  deleteLabel: string;
}

/**
 * The till's own number pad. Big fixed keys instead of the system keyboard:
 * nothing slides over the amount, and it can be worked one-handed at a
 * counter without looking.
 */
export function AmountKeypad({ value, onChange, keyHeight = 62, deleteLabel }: AmountKeypadProps) {
  const press = (key: (typeof KEYS)[number]) => {
    triggerHaptic('light');
    if (key === 'del') {
      onChange(value.slice(0, -1));
      return;
    }
    // "." on an empty pad means "0."; a leading zero is replaced, not kept.
    const base = key === '.' && value === '' ? '0' : value === '0' && key !== '.' ? '' : value;
    onChange(sanitizeAmountInput(base + key));
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
          accessibilityLabel={key === 'del' ? deleteLabel : key}
        >
          {key === 'del' ? (
            <BackspaceIcon size={26} color="rgba(255,255,255,0.8)" />
          ) : (
            <Text style={styles.keyText}>{key}</Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
});
