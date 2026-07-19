import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from '../icons/AuthIcons';
import { StepProgress } from './StepProgress';
import { colors, spacing } from '../../theme';

interface AuthLayoutProps {
  children: React.ReactNode;
  onBack?: () => void;
  step?: { current: number; total: number };
  scroll?: boolean;
  contentStyle?: ViewStyle;
  footer?: React.ReactNode;
  topRight?: React.ReactNode;
  variant?: 'light' | 'dark' | 'white';
}

export function AuthLayout({
  children,
  onBack,
  step,
  scroll = true,
  contentStyle,
  footer,
  topRight,
  variant = 'light',
}: AuthLayoutProps) {
  const dark = variant === 'dark';
  const white = variant === 'white';
  const body = (
    <>
      <View style={styles.topBar}>
        {onBack ? (
          <TouchableOpacity
            style={[styles.backBtn, dark && styles.backBtnDark, white && styles.backBtnWhite]}
            onPress={onBack}
            accessibilityLabel="Back"
          >
            <ChevronLeftIcon color={dark ? colors.hero.text : white ? '#0A0A14' : colors.text.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backPlaceholder} />
        )}
        {topRight ?? <View style={styles.backPlaceholder} />}
      </View>
      {step ? <StepProgress currentStep={step.current} totalSteps={step.total} /> : null}
      {children}
      {footer}
    </>
  );

  return (
    <SafeAreaView
      style={[styles.safe, dark && styles.safeDark, white && styles.safeWhite]}
      edges={['top', 'bottom']}
    >
      <StatusBar
        barStyle={dark ? 'light-content' : 'dark-content'}
        backgroundColor={dark ? colors.hero.canvas : white ? '#FFFFFF' : colors.background.primary}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.scrollContent, contentStyle]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {body}
          </ScrollView>
        ) : (
          <View style={[styles.scrollContent, styles.flex, contentStyle]}>{body}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  safeDark: {
    backgroundColor: colors.hero.canvas,
  },
  safeWhite: {
    backgroundColor: '#FFFFFF',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    minHeight: 44,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.dark.glass,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnDark: {
    backgroundColor: colors.hero.pill,
    borderWidth: 1,
    borderColor: colors.hero.border,
  },
  backBtnWhite: {
    backgroundColor: '#F1F5F9',
  },
  backPlaceholder: {
    width: 44,
    height: 44,
  },
});
