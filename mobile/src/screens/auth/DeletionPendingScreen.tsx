import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PinKeypad } from '../../components/PinKeypad';
import { functions } from '../../services/firebase.config';
import { signOut } from '../../services/auth.service';
import { colors, typography, spacing } from '../../theme';

interface Props {
  dueAt: Date;
  /** The PIN was right and the account is kept. */
  onKept: () => void;
}

/**
 * Shown to someone who signs back in while their account waits to be
 * deleted. The PIN keeps it; otherwise they sign out and it's deleted on
 * the date shown.
 */
export default function DeletionPendingScreen({ dueAt, onKept }: Props) {
  const { t, i18n } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const date = dueAt.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' });

  const keep = async (submitted: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await functions().httpsCallable('cancelAccountDeletion')({ pin: submitted });
      onKept();
    } catch (e: any) {
      setError(
        e?.code === 'functions/permission-denied' ? t('auth.pinLogin.invalidPin') : e?.message || t('common.error')
      );
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.fullScreen}>
      <PinKeypad
        value={pin}
        onChange={(v) => {
          setPin(v);
          if (error) setError('');
        }}
        onComplete={busy ? undefined : keep}
        title={t('auth.deletionPending.title')}
        subtitle={t('auth.deletionPending.subtitle', { date })}
        error={error}
      />
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => signOut().catch(() => undefined)} style={styles.link}>
          <Text style={styles.linkText}>{t('auth.deletionPending.signOut')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: colors.dark.canvas },
  footer: { alignItems: 'center', paddingBottom: spacing.xl },
  link: { padding: spacing.sm },
  linkText: { ...typography.body, color: colors.dark.textDim },
});
