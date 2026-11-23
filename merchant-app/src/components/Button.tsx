import React, { useRef } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  Animated,
  Easing,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { typography, borderRadius, gradients, shadows, makeStyles, useColors } from '../theme';
import { triggerHaptic, HapticType } from '../services/haptics.service';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'gradient' | 'darkGhost';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  haptic?: HapticType | 'none';
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
  textStyle,
  haptic = 'light',
}: ButtonProps) {
  const colors = useColors();
  const styles = useStyles();
  const isDisabled = disabled || loading;
  const scale = useRef(new Animated.Value(1)).current;

  const animateScale = (to: number, duration: number) => {
    Animated.timing(scale, {
      toValue: to,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    if (!isDisabled && haptic !== 'none') {
      triggerHaptic(haptic);
    }
    onPress();
  };

  const variantStyles: Record<ButtonVariant, ViewStyle> = {
    primary: styles.primary,
    secondary: styles.secondary,
    outline: styles.secondary,
    ghost: styles.secondary,
    gradient: styles.gradient,
    darkGhost: styles.darkGhost,
  };

  const textVariantStyles: Record<ButtonVariant, TextStyle> = {
    primary: styles.primaryText,
    secondary: styles.secondaryText,
    outline: styles.secondaryText,
    ghost: styles.secondaryText,
    gradient: styles.gradientText,
    darkGhost: styles.darkGhostText,
  };

  const inner = loading ? (
    <ActivityIndicator
      color={
        variant === 'primary' || variant === 'gradient' || variant === 'darkGhost'
          ? colors.text.inverse
          : colors.text.primary
      }
    />
  ) : (
    <Text
      style={[
        textVariantStyles[variant],
        isDisabled && variant === 'primary' ? styles.disabledPrimaryText : undefined,
        isDisabled && variant === 'gradient' ? styles.disabledPrimaryText : undefined,
        isDisabled && variant !== 'primary' && variant !== 'gradient' && variant !== 'darkGhost'
          ? styles.disabledSecondaryText
          : undefined,
        textStyle,
      ]}
    >
      {title}
    </Text>
  );

  if (variant === 'gradient') {
    return (
      <TouchableOpacity
        onPress={handlePress}
        disabled={isDisabled}
        onPressIn={() => animateScale(0.96, 80)}
        onPressOut={() => animateScale(1, 140)}
        activeOpacity={0.9}
        style={[
          styles.base,
          styles.gradientOuter,
          fullWidth && styles.fullWidth,
          isDisabled && styles.gradientDisabled,
          style,
          { transform: [{ scale }] },
        ]}
      >
        <LinearGradient
          colors={isDisabled ? [colors.border.default, colors.border.dark] : gradients.primary.colors}
          start={gradients.primary.start}
          end={gradients.primary.end}
          style={styles.gradientInner}
        >
          {inner}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isDisabled}
      onPressIn={() => animateScale(0.96, 80)}
      onPressOut={() => animateScale(1, 140)}
      activeOpacity={variant === 'primary' ? 0.82 : 0.8}
      style={[
        styles.base,
        variantStyles[variant],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
        { transform: [{ scale }] },
      ]}
    >
      {inner}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  base: {
    height: 56,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  fullWidth: {
    width: '100%',
  },
  primary: {
    backgroundColor: colors.action.primary,
  },
  disabled: {
    opacity: 0.38,
    backgroundColor: colors.border.default,
    borderColor: colors.border.default,
  },
  primaryText: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
    letterSpacing: -0.3,
    color: colors.action.primaryText,
    textAlign: 'center',
    width: '100%',
  },
  secondary: {
    backgroundColor: colors.ui.accentSoft,
    borderWidth: 1,
    borderColor: colors.ui.accentBorder,
  },
  secondaryText: {
    fontSize: 17,
    fontWeight: '500',
    lineHeight: 24,
    letterSpacing: -0.2,
    color: colors.text.primary,
  },
  disabledPrimaryText: {
    color: colors.text.tertiary,
  },
  disabledSecondaryText: {
    color: colors.text.tertiary,
  },
  darkGhost: {
    backgroundColor: colors.ui.ink(0.13),
    borderWidth: 1.5,
    borderColor: colors.ui.ink(0.22),
  },
  darkGhostText: {
    fontSize: 17,
    fontWeight: '500',
    lineHeight: 24,
    letterSpacing: -0.2,
    color: colors.hero.text,
  },
  gradient: {},
  gradientOuter: {
    // `base` sets paddingHorizontal, which outranks a plain `padding: 0`, so
    // it is zeroed by name: otherwise the gradient sits 28pt inside the
    // button's width on each side.
    padding: 0,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    ...shadows.primary,
    // shadows.primary is the old blue brand; under coral it drew a blue halo.
    // No overflow clipping here either, or iOS cuts the glow off square.
    shadowColor: colors.action.primary,
  },
  gradientInner: {
    flex: 1,
    alignSelf: 'stretch',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    // No padding on the gradient itself: the native view draws inside it and
    // then offsets its children by it again, which shrank the gradient and
    // pushed the label right. The label carries the inset (gradientText).
    minHeight: 54,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  gradientText: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
    letterSpacing: -0.3,
    color: colors.action.primaryText,
    textAlign: 'center',
    width: '100%',
    paddingHorizontal: 28,
  },
  gradientDisabled: {
    opacity: 0.65,
    shadowOpacity: 0,
    elevation: 0,
  },
}));
