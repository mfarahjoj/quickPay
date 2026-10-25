import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DarkScreen, PillButton, TEXT_DIM } from '../DarkScreen';
import { PinInput } from '../PinInput';
import { functions } from '../../services/firebase.config';
import { signOut } from '../../services/auth.service';

interface Props {
  dueAt: Date;
}

/**
 * Shown to someone who signs back in while their account waits to be
 * deleted. The PIN keeps it (the account then reads as active again and this
 * screen goes by itself); otherwise they sign out.
 */
export function DeletionPendingScreen({ dueAt }: Props) {
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
    } catch (e: any) {
      setError(e?.code === 'functions/permission-denied' ? t('errors.wrongPin') : e?.message || t('common.error'));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DarkScreen contentStyle={styles.content}>
      <Text style={styles.title}>{t('deletionPending.title')}</Text>
      <Text style={styles.body}>{t('deletionPending.subtitle', { date })}</Text>
      <PinInput
        value={pin}
        onChange={(v) => {
          setPin(v);
          if (error) setError('');
        }}
        onComplete={keep}
        style={styles.pin}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
      <PillButton label={t('deletionPending.signOut')} variant="glass" onPress={() => signOut().catch(() => undefined)} style={styles.signOut} />
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  title: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  body: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  pin: { marginTop: 32 },
  error: { color: '#FF6961', textAlign: 'center', marginTop: 12 },
  spinner: { marginTop: 16 },
  signOut: { marginTop: 32 },
});
