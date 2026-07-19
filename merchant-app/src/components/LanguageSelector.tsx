import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './BottomSheet';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import { applyLanguage } from '../i18n';
import { functions } from '../services/firebase.config';
import { colors, typography, spacing, borderRadius } from '../theme';
import type { PreferredLanguage } from '../types';

interface LanguageSelectorProps {
  currentLanguage?: PreferredLanguage;
  compact?: boolean;
  dark?: boolean;
}

export function LanguageSelector({ currentLanguage = 'en', compact = false, dark = false }: LanguageSelectorProps) {
  const { t, i18n } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === (i18n.language as PreferredLanguage))
    ?? SUPPORTED_LANGUAGES.find((l) => l.code === currentLanguage)
    ?? SUPPORTED_LANGUAGES[0];

  const handleSelect = async (code: PreferredLanguage) => {
    if (code === i18n.language) {
      setVisible(false);
      return;
    }

    try {
      setSaving(true);
      await applyLanguage(code);

      try {
        const updateProfileFn = functions().httpsCallable('updateProfile');
        await updateProfileFn({ preferredLanguage: code });
      } catch {
        // Language still applied locally if profile update fails
      }

      setVisible(false);
      Alert.alert(t('language.changedTitle'), t('language.changedMessage'));
    } catch {
      Alert.alert(t('common.error'), t('language.changeFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, compact && styles.triggerCompact, dark && styles.triggerDark]}
        onPress={() => setVisible(true)}
        accessibilityLabel={t('language.selectLanguage')}
        activeOpacity={0.7}
      >
        <Text style={styles.triggerFlag}>{current.flag}</Text>
        {!compact && <Text style={[styles.triggerLabel, dark && styles.triggerLabelDark]}>{current.nativeName}</Text>}
        <Text style={[styles.triggerChevron, dark && styles.triggerChevronDark]}>▾</Text>
      </TouchableOpacity>

      <BottomSheet visible={visible} onClose={() => setVisible(false)} height="45%">
        <Text style={styles.sheetTitle}>{t('language.selectLanguage')}</Text>
        {saving && (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        )}
        {SUPPORTED_LANGUAGES.map((lang) => {
          const selected = i18n.language === lang.code;
          return (
            <TouchableOpacity
              key={lang.code}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => handleSelect(lang.code)}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={styles.optionFlag}>{lang.flag}</Text>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {lang.nativeName}
                </Text>
                <Text style={styles.optionSub}>{lang.label}</Text>
              </View>
              {selected && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          );
        })}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.light,
    gap: spacing.xs,
  },
  triggerCompact: {
    paddingHorizontal: spacing.sm,
  },
  triggerDark: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  triggerLabelDark: {
    color: '#FFFFFF',
  },
  triggerChevronDark: {
    color: 'rgba(255,255,255,0.5)',
  },
  triggerFlag: {
    fontSize: 18,
  },
  triggerLabel: {
    ...typography.captionBold,
    color: colors.text.primary,
  },
  triggerChevron: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  sheetTitle: {
    ...typography.h3,
    color: colors.text.primary,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  loader: {
    marginBottom: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.background.secondary,
  },
  optionSelected: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  optionFlag: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  optionText: {
    flex: 1,
  },
  optionLabel: {
    ...typography.bodySemibold,
    color: colors.text.primary,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  optionSub: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: 2,
  },
  checkmark: {
    ...typography.bodyLarge,
    color: colors.primary,
    fontWeight: '700',
  },
});
