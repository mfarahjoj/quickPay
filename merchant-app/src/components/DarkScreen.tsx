import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from './icons/AuthIcons';

export const ACCENT = '#FF5043';
export const GLASS = 'rgba(255,255,255,0.06)';
export const GLASS_BORDER = 'rgba(255,255,255,0.1)';
export const TEXT_DIM = 'rgba(255,255,255,0.45)';
export const TEXT_FAINT = 'rgba(255,255,255,0.4)';

interface DarkScreenProps {
  children: React.ReactNode;
  edges?: Edge[];
  scroll?: boolean;
  keyboard?: boolean;
  glow?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Black canvas with the QuickPay ambient glow, shared across all screens. */
export function DarkScreen({
  children,
  edges = ['top'],
  scroll = false,
  keyboard = false,
  glow = true,
  contentStyle,
}: DarkScreenProps) {
  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.scrollContent, contentStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentStyle]}>{children}</View>
  );

  const inner = keyboard ? (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      {glow && <View style={styles.glow} pointerEvents="none" />}
      {inner}
    </SafeAreaView>
  );
}

interface ScreenHeaderProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

/** Dark screen header: optional back chevron, title, and right slot. */
export function ScreenHeader({ title, subtitle, onBack, right }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        {onBack ? (
          <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeftIcon size={26} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <View style={styles.backSpacer} />
        )}
        <View style={styles.headerRight}>{right}</View>
      </View>
      {!!title && <Text style={styles.headerTitle}>{title}</Text>}
      {!!subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
    </View>
  );
}

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function GlassCard({ children, style }: GlassCardProps) {
  return <View style={[styles.glassCard, style]}>{children}</View>;
}

interface PillButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'glass';
  style?: StyleProp<ViewStyle>;
}

/** White pill (primary) or frosted glass (secondary) — matches Welcome/Login. */
export function PillButton({ label, onPress, loading, disabled, variant = 'primary', style }: PillButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      style={[
        styles.pill,
        isPrimary ? styles.pillPrimary : styles.pillGlass,
        disabled && styles.pillDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#000000' : '#FFFFFF'} />
      ) : (
        <Text style={[styles.pillText, isPrimary ? styles.pillTextPrimary : styles.pillTextGlass]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    flexGrow: 1,
  },
  glow: {
    position: 'absolute',
    top: -120,
    alignSelf: 'center',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: ACCENT,
    opacity: 0.1,
  },

  // header
  header: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
    marginBottom: 8,
  },
  backBtn: {
    marginLeft: -6,
  },
  backSpacer: {
    width: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 15,
    color: TEXT_DIM,
    marginTop: 6,
    lineHeight: 22,
  },

  // glass card
  glassCard: {
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 20,
  },

  // pill button
  pill: {
    height: 58,
    borderRadius: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillPrimary: {
    backgroundColor: '#FFFFFF',
  },
  pillGlass: {
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  pillDisabled: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  pillText: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  pillTextPrimary: {
    color: '#000000',
  },
  pillTextGlass: {
    color: '#FFFFFF',
  },
});
