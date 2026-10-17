import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BrandMarkIcon } from './icons/AuthIcons';

/**
 * Shown in place of the whole app when this build is older than
 * `config/app_client` allows (useUpdateGate). Nothing behind it is reachable:
 * an old build that cannot open payment links or approve the charges merchants
 * now raise is better stopped with a clear way out than left half-working.
 */
export function UpdateRequired({ updateUrl }: { updateUrl?: string }) {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0B0A" />
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.body}>
        <BrandMarkIcon size={64} onDark />
        <Text style={styles.title}>{t('update.title')}</Text>
        <Text style={styles.message}>{t('update.message')}</Text>
      </View>
      <View style={styles.footer}>
        {updateUrl ? (
          <TouchableOpacity
            style={styles.button}
            onPress={() => Linking.openURL(updateUrl).catch(() => undefined)}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{t('update.button')}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.hint}>{t('update.noLink')}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0B0A' },
  glow: {
    position: 'absolute',
    top: -140,
    alignSelf: 'center',
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: '#FF5043',
    opacity: 0.12,
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 28,
  },
  message: {
    fontSize: 16,
    lineHeight: 23,
    color: 'rgba(255,255,255,0.62)',
    textAlign: 'center',
    marginTop: 12,
  },
  footer: { paddingHorizontal: 24, paddingBottom: 24 },
  button: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#FF5043',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  hint: { fontSize: 14, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 20 },
});
