import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { useUserProfile } from '../../hooks/useUserProfile';
import { functions } from '../../services/firebase.config';
import { applyLanguage } from '../../i18n';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { PreferredLanguage } from '../../types';

interface Props {
  navigation: any;
}

const LANGUAGES: { value: PreferredLanguage; labelKey: string }[] = [
  { value: 'en', labelKey: 'profile.edit.languageEnglish' },
  { value: 'so', labelKey: 'profile.edit.languageSomali' },
  { value: 'ar', labelKey: 'profile.edit.languageArabic' },
];

const GENDERS = [
  { value: 'male', labelKey: 'profile.edit.genderMale' },
  { value: 'female', labelKey: 'profile.edit.genderFemale' },
  { value: 'other', labelKey: 'profile.edit.genderOther' },
];

export default function EditProfileScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { profile } = useUserProfile();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [language, setLanguage] = useState<PreferredLanguage>('en');
  const [loading, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName ?? '');
      setEmail(profile.email ?? '');
      setDateOfBirth(profile.dateOfBirth ?? '');
      setGender(profile.gender ?? null);
      setCity(profile.address?.city ?? '');
      setDistrict(profile.address?.district ?? '');
      setLanguage(profile.preferredLanguage ?? 'en');
    }
  }, [profile]);

  const handleSave = async () => {
    if (fullName.trim().length < 2) {
      Alert.alert(t('common.error'), t('profile.edit.fullNameError'));
      return;
    }

    try {
      setSaving(true);

      const updateData: Record<string, any> = {
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        dateOfBirth: dateOfBirth.trim() || undefined,
        gender: gender || undefined,
        address: { city: city.trim(), district: district.trim(), country: 'Somalia' },
        preferredLanguage: language,
      };

      const updateProfileFn = functions().httpsCallable('updateProfile');
      const result = await updateProfileFn(updateData);
      const data = result.data as { success: boolean; error?: string };

      if (!data.success) {
        Alert.alert(t('common.error'), data.error ?? t('profile.edit.updateFailed'));
        return;
      }

      if (language !== profile?.preferredLanguage) {
        await applyLanguage(language);
      }

      Alert.alert(t('common.success'), t('profile.edit.updateSuccess'), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message ?? t('profile.edit.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title={t('profile.edit.title')} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.label}>{t('profile.edit.fullName')}</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder={t('profile.edit.fullNamePlaceholder')}
          placeholderTextColor={colors.text.tertiary}
        />

        <Text style={styles.label}>{t('profile.edit.emailOptional')}</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder={t('profile.edit.emailPlaceholder')}
          placeholderTextColor={colors.text.tertiary}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>{t('profile.edit.dateOfBirth')}</Text>
        <TextInput
          style={styles.input}
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          placeholder={t('profile.edit.dobPlaceholder')}
          placeholderTextColor={colors.text.tertiary}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        />

        <Text style={styles.label}>{t('profile.edit.gender')}</Text>
        <View style={styles.chipRow}>
          {GENDERS.map((g) => (
            <TouchableOpacity
              key={g.value}
              style={[styles.chip, gender === g.value && styles.chipSelected]}
              onPress={() => setGender(gender === g.value ? null : g.value)}
            >
              <Text
                style={[
                  styles.chipText,
                  gender === g.value && styles.chipTextSelected,
                ]}
              >
                {t(g.labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('profile.edit.city')}</Text>
        <TextInput
          style={styles.input}
          value={city}
          onChangeText={setCity}
          placeholder={t('profile.edit.cityPlaceholder')}
          placeholderTextColor={colors.text.tertiary}
        />

        <Text style={styles.label}>{t('profile.edit.district')}</Text>
        <TextInput
          style={styles.input}
          value={district}
          onChangeText={setDistrict}
          placeholder={t('profile.edit.districtPlaceholder')}
          placeholderTextColor={colors.text.tertiary}
        />

        <Text style={styles.label}>{t('profile.edit.language')}</Text>
        <View style={styles.chipRow}>
          {LANGUAGES.map((l) => (
            <TouchableOpacity
              key={l.value}
              style={[styles.chip, language === l.value && styles.chipSelected]}
              onPress={() => setLanguage(l.value)}
            >
              <Text
                style={[
                  styles.chipText,
                  language === l.value && styles.chipTextSelected,
                ]}
              >
                {t(l.labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.saveContainer}>
          <Button
            title={t('profile.edit.saveChanges')}
            onPress={handleSave}
            loading={loading}
            fullWidth
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  scroll: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  label: {
    ...typography.captionBold,
    color: colors.dark.textDim,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.dark.text,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    backgroundColor: colors.dark.glass,
  },
  chipSelected: {
    backgroundColor: colors.dark.accentSoft,
    borderColor: colors.dark.accentBorder,
  },
  chipText: {
    ...typography.caption,
    color: colors.dark.textDim,
  },
  chipTextSelected: {
    color: colors.dark.accentText,
    fontWeight: '600',
  },
  saveContainer: {
    marginTop: spacing.xl,
  },
});
