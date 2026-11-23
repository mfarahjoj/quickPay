import React, { useEffect, useRef } from 'react';
import { View, TextInput, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { typography, spacing, borderRadius, makeStyles } from '../theme';

const PIN_LENGTH = 6;

interface PinInputProps {
  value: string;
  onChange: (pin: string) => void;
  onComplete?: (pin: string) => void;
  style?: StyleProp<ViewStyle>;
  secure?: boolean;
  /**
   * Open the number pad without a tap: on mount (after the screen's
   * transition), when this turns true, and again after the PIN is cleared
   * for a retry. Only for a screen whose job is the PIN.
   */
  autoFocus?: boolean;
}

export function PinInput({
  value,
  onChange,
  onComplete,
  style,
  secure = true,
  autoFocus = false,
}: PinInputProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const inputRefs = useRef<Array<TextInput | null>>([]);
  const digits = value.split('').concat(Array(PIN_LENGTH - value.length).fill(''));

  // Cleared after a wrong PIN, or shown for the first time: back to box one.
  const cleared = value.length === 0;
  useEffect(() => {
    if (!autoFocus || !cleared) return;
    const timer = setTimeout(() => inputRefs.current[0]?.focus(), 350);
    return () => clearTimeout(timer);
  }, [autoFocus, cleared]);

  const handleChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    const newValue = newDigits.join('');
    onChange(newValue);

    if (digit && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newValue.length === PIN_LENGTH && onComplete) {
      onComplete(newValue);
    }
  };

  const handleKeyPress = (e: { nativeEvent: { key: string } }, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newDigits = [...digits];
      newDigits[index - 1] = '';
      onChange(newDigits.join(''));
    }
  };

  return (
    <View style={[styles.container, style]}>
      {Array.from({ length: PIN_LENGTH }).map((_, index) => (
        <TextInput
          key={index}
          ref={(ref) => (inputRefs.current[index] = ref)}
          style={[
            styles.digit,
            digits[index] ? styles.digitFilled : undefined,
          ]}
          value={digits[index]}
          onChangeText={(text) => handleChange(text, index)}
          onKeyPress={(e) => handleKeyPress(e, index)}
          keyboardType="number-pad"
          maxLength={1}
          selectTextOnFocus
          secureTextEntry={secure}
          accessibilityLabel={t('common.pinDigit', { n: index + 1 })}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  digit: {
    flex: 1,
    height: 56,
    borderWidth: 2,
    borderColor: colors.border.light,
    borderRadius: borderRadius.lg,
    ...typography.h2,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.text.primary,
    backgroundColor: colors.background.secondary,
  },
  digitFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
}));
