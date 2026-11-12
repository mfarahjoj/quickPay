import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { makeStyles, useColors } from '../theme';
import { DeleteKeyIcon } from './icons/LineIcons';
import { triggerHaptic } from '../services/haptics.service';
import type { AmountKey } from '../utils/amountKeypad';

const ROWS: AmountKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'del'],
];

interface Props {
  onKey: (key: AmountKey) => void;
  /** Holding delete clears the amount. */
  onClear?: () => void;
}

/** The number pad for typing an amount, in place of the phone's keyboard. */
export function AmountKeypad({ onKey, onClear }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const keyHeight = height < 720 ? 50 : 60;

  return (
    <View style={styles.pad}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((key) => (
            <Pressable
              key={key}
              style={({ pressed }) => [styles.key, { height: keyHeight }, pressed && styles.keyPressed]}
              onPress={() => {
                triggerHaptic('light');
                onKey(key);
              }}
              onLongPress={
                key === 'del' && onClear
                  ? () => {
                      triggerHaptic('medium');
                      onClear();
                    }
                  : undefined
              }
              accessibilityRole="button"
              accessibilityLabel={
                key === 'del' ? t('common.delete') : key === '.' ? t('qr.enterAmount.decimalPoint') : key
              }
            >
              {key === 'del' ? (
                <DeleteKeyIcon size={24} color={colors.ui.text} strokeWidth={1.9} />
              ) : (
                <Text style={styles.keyText}>{key}</Text>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/** A blinking caret to sit after the amount. */
export function AmountCaret({ color, height }: { color: string; height: number }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withDelay(450, withTiming(0, { duration: 80 })),
        withDelay(450, withTiming(1, { duration: 80 })),
      ),
      -1,
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[caretStyles.caret, { height, backgroundColor: color }, style]} />;
}

const caretStyles = StyleSheet.create({
  caret: {
    width: 3,
    marginLeft: 4,
    borderRadius: 2,
  },
});

const useStyles = makeStyles((colors) => StyleSheet.create({
  pad: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  key: {
    flex: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: colors.ui.ink(0.08),
  },
  keyText: {
    fontSize: 26,
    fontWeight: '500',
    color: colors.ui.text,
  },
}));
