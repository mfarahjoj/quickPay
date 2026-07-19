import React from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import LinearGradient from 'react-native-linear-gradient';
import { colors } from '../../theme';

interface GradientTextProps {
  children: string;
  style?: StyleProp<TextStyle>;
  /** Gradient stops; defaults to the hero accent gradient */
  gradientColors?: string[];
}

/**
 * Apple-style gradient headline text (MaskedView + LinearGradient).
 * Best used for a single emphasized line within a dark hero headline.
 */
export function GradientText({ children, style, gradientColors }: GradientTextProps) {
  const palette = gradientColors ?? colors.hero.accentGradient;
  return (
    <MaskedView
      maskElement={
        <Text style={[style, { backgroundColor: 'transparent' }]}>{children}</Text>
      }
    >
      <LinearGradient colors={palette} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
        <Text style={[style, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}
