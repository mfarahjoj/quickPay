import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { useUserProfile } from '../../hooks/useUserProfile';
import { functions } from '../../services/firebase.config';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface Props {
  navigation: any;
}

export default function LinkedAccountsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { profile } = useUserProfile();
  const [zaadPhone, setZaadPhone] = useState('');
  const [edahabPhone, setEdahabPhone] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (profile) {
      setZaadPhone(profile.linkedAccounts?.zaadPhone ?? '');
      setEdahabPhone(profile.linkedAccounts?.edahabPhone ?? '');
    }
  }, [profile]);

  const handleSave = async () => {
    const phone252 = /^\+252[0-9]{9}$/;

    if (zaadPhone && !phone252.test(zaadPhone)) {
      Alert.alert(t('common.error'), t('profile.linkedAccounts.zaadFormatError'));
      return;
    }
    if (edahabPhone && !phone252.test(edahabPhone)) {
      Alert.alert(t('common.error'), t('profile.linkedAccounts.edahabFormatError'));
      return;
    }

    try {
      setLoading(true);
      const updateProfileFn = functions().httpsCallable('updateProfile');
      const result = await updateProfileFn({
        linkedAccounts: {
          zaadPhone: zaadPhone || undefined,
          edahabPhone: edahabPhone || undefined,
        },
      });

      const data = result.data as { success: boolean; error?: string };
      if (data.success) {
        Alert.alert(t('common.saved'), t('profile.linkedAccounts.saved'), [
          { text: t('common.ok'), onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert(t('common.error'), data.error ?? t('profile.linkedAccounts.updateFailed'));
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message ?? t('profile.linkedAccounts.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title={t('profile.linkedAccounts.title')} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.description}>
          {t('profile.linkedAccounts.description')}
        </Text>

        <View style={styles.card}>
          <View style={styles.providerHeader}>
            <Text style={styles.providerIcon}>Z</Text>
            <Text style={styles.providerName}>{t('profile.linkedAccounts.zaad')}</Text>
          </View>
          <TextInput
            style={styles.input}
            value={zaadPhone}
            onChangeText={setZaadPhone}
            placeholder={t('common.phoneFormat252')}
            placeholderTextColor={colors.text.tertiary}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.card}>
          <View style={styles.providerHeader}>
            <Text style={styles.providerIcon}>E</Text>
            <Text style={styles.providerName}>{t('profile.linkedAccounts.edahab')}</Text>
          </View>
          <TextInput
            style={styles.input}
            value={edahabPhone}
            onChangeText={setEdahabPhone}
            placeholder={t('common.phoneFormat252')}
            placeholderTextColor={colors.text.tertiary}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.saveContainer}>
          <Button
            title={t('profile.linkedAccounts.save')}
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
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  description: {
    ...typography.body,
    color: colors.dark.textDim,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  providerIcon: {
    ...typography.bodySemibold,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.dark.accentSoft,
    textAlign: 'center',
    lineHeight: 36,
    color: colors.dark.accentText,
    marginRight: spacing.md,
    overflow: 'hidden',
  },
  providerName: {
    ...typography.bodySemibold,
    color: colors.dark.text,
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
  saveContainer: { marginTop: spacing.xl },
});
