/**
 * A large amount field whose placeholder is drawn as ordinary text.
 *
 * iOS clips the top of a TextInput's own placeholder at large bold sizes
 * ("0" and "0,000" lose their tops at 32pt and up), while typed digits and
 * plain Text render whole. So the placeholder sits behind an empty field as a
 * Text in the field's own style, and the field itself has none.
 */

import React from 'react';
import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View } from 'react-native';
import { makeStyles, useColors } from '../theme';

interface Props extends Omit<TextInputProps, 'placeholder' | 'style'> {
  value: string;
  placeholder: string;
  /** The field's text style; the placeholder takes it too, in its own colour. */
  style: StyleProp<TextStyle>;
  placeholderTextColor?: string;
}

export function AmountInput({ value, placeholder, style, placeholderTextColor, ...rest }: Props) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.wrap}>
      {value ? null : (
        <Text
          style={[style, styles.ghost, { color: placeholderTextColor ?? colors.ui.ink(0.25) }]}
          numberOfLines={1}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {placeholder}
        </Text>
      )}
      <TextInput {...rest} value={value} style={style} accessibilityHint={rest.accessibilityHint ?? placeholder} />
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
  ghost: { position: 'absolute', left: 0, right: 0, flex: 0, height: 'auto', paddingVertical: 0 },
}));
