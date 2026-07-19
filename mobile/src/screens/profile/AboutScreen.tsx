import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { PinInput } from '../../components/PinInput';
import { functions } from '../../services/firebase.config';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface Props {
  navigation: any;
}

const APP_VERSION = '1.0.0';

export default function AboutScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [showDelete, setShowDelete] = useState(false);
  const [pin, setPin] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = () => {
    Alert.alert(
      t('profile.about.deleteConfirmTitle'),
      t('profile.about.deleteConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.about.deleteAccount'),
          style: 'destructive',
          onPress: () => setShowDelete(true),
        },
      ]
    );
  };

  const confirmDelete = async () => {
    if (pin.length !== 6) {
      Alert.alert(t('common.error'), t('profile.about.enterPinError'));
      return;
    }

    try {
      setDeleting(true);
      const fn = functions().httpsCallable('requestAccountDeletion');
      const result = await fn({ pin });
      const data = result.data as { success: boolean; message?: string; error?: string };

      if (data.success) {
        Alert.alert(
          t('profile.about.deletionRequested'),
          data.message ?? t('profile.about.deletionMessage')
        );
      } else {
        Alert.alert(t('common.error'), data.error ?? t('profile.about.deleteFailed'));
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message ?? t('profile.about.deleteFailed'));
    } finally {
      setDeleting(false);
      setPin('');
      setShowDelete(false);
    }
  };

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() =>
      Alert.alert(t('common.error'), t('profile.about.cannotOpenLink'))
    );
  };

  return (
    <View style={styles.container}>
      <Header title={t('profile.about.title')} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.logoCard}>
          <Text style={styles.appName}>{t('profile.about.appName')}</Text>
          <Text style={styles.version}>{t('common.version', { version: APP_VERSION })}</Text>
          <Text style={styles.tagline}>{t('profile.about.tagline')}</Text>
        </View>

        <View style={styles.menu}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => openLink('https://quickpay.so/terms')}
          >
            <Text style={styles.menuText}>{t('profile.about.termsOfService')}</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => openLink('https://quickpay.so/privacy')}
          >
            <Text style={styles.menuText}>{t('profile.about.privacyPolicy')}</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => openLink('https://quickpay.so/support')}
          >
            <Text style={styles.menuText}>{t('profile.about.helpSupport')}</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>{t('profile.about.dangerZone')}</Text>
          {showDelete ? (
            <View style={styles.deleteForm}>
              <Text style={styles.deletePrompt}>
                {t('profile.about.enterPinDelete')}
              </Text>
              <PinInput value={pin} onChange={setPin} />
              <View style={styles.deleteButtons}>
                <Button
                  title={t('common.cancel')}
                  variant="ghost"
                  onPress={() => {
                    setShowDelete(false);
                    setPin('');
                  }}
                  style={styles.deleteBtn}
                />
                <Button
                  title={t('profile.about.confirmDelete')}
                  onPress={confirmDelete}
                  loading={deleting}
                  style={styles.deleteBtnDangerFull}
                  textStyle={styles.deleteBtnText}
                />
              </View>
            </View>
          ) : (
            <Button
              title={t('profile.about.deleteAccount')}
              onPress={handleDeleteAccount}
              variant="outline"
              textStyle={styles.deleteButtonText}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  logoCard: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  appName: { ...typography.h1, color: colors.dark.accentText },
  version: { ...typography.caption, color: colors.dark.textFaint, marginTop: spacing.xs },
  tagline: { ...typography.body, color: colors.dark.textDim, marginTop: spacing.sm },
  menu: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.divider,
  },
  menuText: {
    flex: 1,
    ...typography.body,
    color: colors.dark.text,
  },
  menuArrow: { fontSize: 20, color: colors.dark.textFaint },
  dangerZone: {
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.dark.errorSoft,
  },
  dangerTitle: {
    ...typography.captionBold,
    color: colors.dark.error,
    marginBottom: spacing.md,
  },
  deleteButtonText: { color: colors.dark.error },
  deleteForm: { gap: spacing.md },
  deletePrompt: { ...typography.body, color: colors.dark.textDim },
  deleteButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  deleteBtn: { flex: 1 },
  deleteBtnDanger: {
    backgroundColor: colors.dark.error,
    borderColor: colors.dark.error,
  },
  deleteBtnDangerFull: {
    flex: 1,
    backgroundColor: colors.dark.error,
    borderColor: colors.dark.error,
  },
  deleteBtnText: { color: '#fff' },
});
