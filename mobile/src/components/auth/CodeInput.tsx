import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Animated,
  Text,
  Platform,
} from 'react-native';
import { colors, typography, spacing, borderRadius } from '../../theme';

const CODE_LENGTH = 6;

interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  secure?: boolean;
  error?: string;
  autoFocus?: boolean;
  /** Enable SMS OTP autofill on first cell */
  otpMode?: boolean;
}

export function CodeInput({
  value,
  onChange,
  onComplete,
  secure = false,
  error,
  autoFocus = true,
  otpMode = false,
}: CodeInputProps) {
  const inputRefs = useRef<Array<TextInput | null>>([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const [focusedIndex, setFocusedIndex] = useState<number | null>(autoFocus ? 0 : null);
  const digits = value.split('').concat(Array(CODE_LENGTH - value.length).fill(''));

  useEffect(() => {
    if (!error) return;
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [error, shakeAnim]);

  const handleChange = (text: string, index: number) => {
    // Handle paste of full code
    const cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned.length > 1) {
      const pasted = cleaned.slice(0, CODE_LENGTH);
      onChange(pasted);
      if (pasted.length === CODE_LENGTH) {
        onComplete?.(pasted);
        inputRefs.current[CODE_LENGTH - 1]?.blur();
      } else {
        inputRefs.current[pasted.length]?.focus();
      }
      return;
    }

    const digit = cleaned.slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    const newValue = newDigits.join('');
    onChange(newValue);

    if (digit && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newValue.length === CODE_LENGTH && onComplete) {
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
    <View>
      <Animated.View style={[styles.container, { transform: [{ translateX: shakeAnim }] }]}>
        {Array.from({ length: CODE_LENGTH }).map((_, index) => {
          const focused = focusedIndex === index;
          return (
            <View
              key={index}
              style={[styles.cell, error ? styles.cellError : undefined]}
            >
              <TextInput
                ref={(ref) => {
                  inputRefs.current[index] = ref;
                }}
                style={styles.digit}
                value={secure && digits[index] ? '•' : digits[index]}
                onChangeText={(text) => handleChange(text, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                onFocus={() => setFocusedIndex(index)}
                onBlur={() => setFocusedIndex((cur) => (cur === index ? null : cur))}
                keyboardType="number-pad"
                maxLength={index === 0 && otpMode ? CODE_LENGTH : 1}
                selectTextOnFocus
                secureTextEntry={false}
                autoFocus={autoFocus && index === 0}
                textContentType={otpMode && index === 0 ? 'oneTimeCode' : 'none'}
                autoComplete={otpMode && index === 0 ? (Platform.OS === 'android' ? 'sms-otp' : 'one-time-code') : 'off'}
                accessibilityLabel={`Digit ${index + 1}`}
              />
              <View
                style={[
                  styles.underline,
                  focused && styles.underlineFocused,
                  error ? styles.underlineError : undefined,
                ]}
              />
            </View>
          );
        })}
      </Animated.View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cell: {
    flex: 1,
    height: 60,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    overflow: 'hidden',
  },
  cellError: {
    backgroundColor: colors.dark.errorSoft,
  },
  digit: {
    flex: 1,
    width: '100%',
    fontSize: 28,
    fontWeight: '600',
    textAlign: 'center',
    color: colors.dark.text,
    padding: 0,
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    left: spacing.smPlus,
    right: spacing.smPlus,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  underlineFocused: {
    backgroundColor: colors.dark.accent,
  },
  underlineError: {
    backgroundColor: colors.dark.error,
  },
  errorText: {
    ...typography.caption,
    color: colors.dark.error,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});

export const WEAK_PINS = ['123456', '654321', '111111', '000000', '121212', '123123'];

export function isWeakPin(pin: string): boolean {
  if (WEAK_PINS.includes(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  return false;
}
