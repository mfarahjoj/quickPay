import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import firestore from '@react-native-firebase/firestore';
import { functions } from '../../services/firebase.config';
import { LEGAL_VERSIONS, PRIVACY_URL, TERMS_URL } from '../../utils/legal';
import { logger } from '../../utils/logger';

type Consent = { termsVersion?: string; privacyVersion?: string } | undefined;

const isCurrent = (c: Consent) =>
  c?.termsVersion === LEGAL_VERSIONS.terms && c?.privacyVersion === LEGAL_VERSIONS.privacy;

/**
 * Asks for acceptance of the current terms and privacy policy, and records
 * it with versions and time (review B4, E12). Shown once per new version;
 * the app underneath waits until then.
 */
export function ConsentGate({ uid, children }: { uid: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () =>
      firestore()
        .collection('users')
        .doc(uid)
        .onSnapshot(
          (doc) => setConsent((doc?.data()?.consent as Consent) ?? undefined),
          // Unreadable (offline on first launch): don't trap them here.
          () => setConsent({ termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy }),
        ),
    [uid],
  );

  if (consent === null || isCurrent(consent)) return <>{consent === null ? null : children}</>;

  const accept = async () => {
    try {
      setSaving(true);
      setError('');
      await functions().httpsCallable('acceptTerms')({
        termsVersion: LEGAL_VERSIONS.terms,
        privacyVersion: LEGAL_VERSIONS.privacy,
        app: 'customer',
      });
    } catch (err: any) {
      logger.error('acceptTerms failed:', err);
      setError(t(err?.details?.reason === 'legal_version_mismatch' ? 'consent.updateApp' : 'consent.failed'));
    } finally {
      setSaving(false);
    }
  };

  const updated = !!consent?.termsVersion;
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.title}>{t(updated ? 'consent.updatedTitle' : 'consent.title')}</Text>
        <Text style={styles.text}>{t(updated ? 'consent.updatedBody' : 'consent.body')}</Text>
        <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}>
          <Text style={styles.link}>{t('consent.readTerms')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}>
          <Text style={styles.link}>{t('consent.readPrivacy')}</Text>
        </TouchableOpacity>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      <TouchableOpacity style={styles.button} onPress={accept} disabled={saving} accessibilityRole="button">
        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t('consent.accept')}</Text>}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000', paddingHorizontal: 24, paddingBottom: 24 },
  body: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 12 },
  text: { fontSize: 16, lineHeight: 23, color: 'rgba(255,255,255,0.7)', marginBottom: 24 },
  link: { fontSize: 16, fontWeight: '600', color: '#FF8A7A', paddingVertical: 10 },
  error: { fontSize: 14, color: '#FF6961', marginTop: 16 },
  button: {
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FF5043',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});
