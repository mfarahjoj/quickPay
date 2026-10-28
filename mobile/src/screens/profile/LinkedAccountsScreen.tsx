import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { useUserProfile } from '../../hooks/useUserProfile';
import { formatLocal } from '../../services/mobileMoney.utils';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface Props {
  navigation: any;
}

/**
 * The Zaad / eDahab numbers this customer tops up from. A number counts only
 * once it's verified by an activation payment from it (functions/src/
 * mobileMoney/), so it can't be typed in here: linking goes through the
 * Zaad top-up screen. The server writes linkedAccounts.
 */
export default function LinkedAccountsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { profile } = useUserProfile();
  const zaad = profile?.linkedAccounts?.zaadPhone;
  const zaadVerified = profile?.linkedAccounts?.zaadVerified === true;

  const zaadStatus = !zaad
    ? t('profile.linkedAccounts.notLinked')
    : zaadVerified
      ? t('profile.linkedAccounts.verified')
      : t('profile.linkedAccounts.waitingActivation');

  return (
    <View style={styles.container}>
      <Header title={t('profile.linkedAccounts.title')} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.description}>{t('profile.linkedAccounts.description')}</Text>

        <View style={styles.card}>
          <View style={styles.providerHeader}>
            <Text style={styles.providerIcon}>Z</Text>
            <View style={styles.providerText}>
              <Text style={styles.providerName}>{t('profile.linkedAccounts.zaad')}</Text>
              {zaad ? <Text style={styles.number}>{formatLocal(zaad)}</Text> : null}
            </View>
            <Text style={[styles.status, zaadVerified && styles.statusGood]}>{zaadStatus}</Text>
          </View>
          <Button
            title={zaad ? t('profile.linkedAccounts.change') : t('profile.linkedAccounts.link')}
            onPress={() => navigation.navigate('ZaadTopup', { mode: 'link' })}
            fullWidth
          />
        </View>

        <View style={styles.card}>
          <View style={styles.providerHeader}>
            <Text style={styles.providerIcon}>E</Text>
            <View style={styles.providerText}>
              <Text style={styles.providerName}>{t('profile.linkedAccounts.edahab')}</Text>
            </View>
            <Text style={styles.status}>{t('profile.linkedAccounts.comingSoon')}</Text>
          </View>
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
    gap: spacing.md,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
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
  providerText: { flex: 1 },
  providerName: {
    ...typography.bodySemibold,
    color: colors.dark.text,
  },
  number: { ...typography.body, color: colors.dark.textDim, marginTop: 2 },
  status: { ...typography.body, color: colors.dark.textDim },
  statusGood: { color: '#34C77B' },
});
