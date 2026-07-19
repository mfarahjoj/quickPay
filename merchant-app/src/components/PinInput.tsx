import React, { useRef } from 'react';
import { View, TextInput, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';

const PIN_LENGTH = 6;

interface PinInputProps {
  value: string;
  onChange: (pin: string) => void;
  onComplete?: (pin: string) => void;
  style?: StyleProp<ViewStyle>;
  secure?: boolean;
}

export function PinInput({
  value,
  onChange,
  onComplete,
  style,
  secure = true,
}: PinInputProps) {
  const inputRefs = useRef<Array<TextInput | null>>([]);
  const digits = value.split('').concat(Array(PIN_LENGTH - value.length).fill(''));

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
          accessibilityLabel={`PIN digit ${index + 1}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
