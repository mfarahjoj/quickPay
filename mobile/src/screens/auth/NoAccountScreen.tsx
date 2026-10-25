import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, typography, spacing } from '../../theme';

interface Props {
  /** The number the code was sent to, as typed (E.164). */
  phone: string | null;
  onCreate: () => void;
  onOtherNumber: () => void;
}

/**
 * Someone chose Log in, and the number they verified has no Zapp account.
 * Without this they'd land on "choose a PIN" — a quiet sign-up — which a
 * mistyped number makes very confusing.
 */
export default function NoAccountScreen({ phone, onCreate, onOtherNumber }: Props) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.fullScreen}>
      <View style={styles.body}>
        <Text style={styles.title}>{t('auth.noAccount.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.noAccount.subtitle', { phone: phone ?? '' })}</Text>
      </View>
      <View style={styles.footer}>
        <TouchableOpacity onPress={onCreate} style={styles.primary} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('auth.noAccount.create')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOtherNumber} style={styles.link} accessibilityRole="button">
          <Text style={styles.linkText}>{t('auth.noAccount.otherNumber')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: colors.dark.canvas },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  title: { ...typography.h1, color: colors.dark.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.dark.textDim, textAlign: 'center', marginTop: spacing.md },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md },
  primary: {
    backgroundColor: colors.dark.accent,
    borderRadius: 999,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryText: { ...typography.bodySemibold, color: '#FFFFFF' },
  link: { alignItems: 'center', padding: spacing.sm },
  linkText: { ...typography.body, color: colors.dark.textDim },
});
