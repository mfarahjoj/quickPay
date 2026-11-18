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
import { makeStyles, useColors, useTheme } from '../theme';


interface DarkScreenProps {
  children: React.ReactNode;
  edges?: Edge[];
  scroll?: boolean;
  keyboard?: boolean;
  glow?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * The screen shell shared across the app: the theme's canvas (grey in light,
 * black in dark), safe-area edges, optional scroll and keyboard avoidance.
 * `glow` is accepted for older callers and draws nothing: Zapp Pay's
 * screens are flat.
 */
export function DarkScreen({
  children,
  edges = ['top'],
  scroll = false,
  keyboard = false,
  contentStyle,
}: DarkScreenProps) {
  const styles = useStyles();
  const { scheme, colors } = useTheme();
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
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.ui.canvas}
      />
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
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        {onBack ? (
          <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeftIcon size={26} color={colors.ui.text} />
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
  const styles = useStyles();
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
  const colors = useColors();
  const styles = useStyles();
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
        <ActivityIndicator color={isPrimary ? colors.ui.onSolid : colors.ui.text} />
      ) : (
        <Text style={[styles.pillText, isPrimary ? styles.pillTextPrimary : styles.pillTextGlass]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  flex: { flex: 1 },
  safe: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
  },
  scrollContent: {
    flexGrow: 1,
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
    color: colors.ui.text,
  },
  headerSubtitle: {
    fontSize: 15,
    color: colors.ui.textDim,
    marginTop: 6,
    lineHeight: 22,
  },

  // glass card
  glassCard: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
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
    backgroundColor: colors.ui.solid,
  },
  pillGlass: {
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
  pillDisabled: {
    backgroundColor: colors.ui.ink(0.15),
  },
  pillText: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  pillTextPrimary: {
    color: colors.ui.onSolid,
  },
  pillTextGlass: {
    color: colors.ui.text,
  },
}));
