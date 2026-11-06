import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { GlassCard, ACCENT, TEXT_DIM, TEXT_FAINT } from '../../components';
import { formatLocal } from '../../utils/zaad';

/** Where payouts go: the Zaad account on file, with a way to change it. */
export function ZaadDestination({ zaad }: { zaad?: { msisdn: string; name: string } }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  return (
    <>
      <Text style={styles.label}>{t('payout.toLabel')}</Text>
      <GlassCard style={styles.card}>
        <View style={styles.text}>
          {zaad ? (
            <>
              <Text style={styles.number}>Zaad {formatLocal(zaad.msisdn)}</Text>
              <Text style={styles.name}>{zaad.name}</Text>
            </>
          ) : (
            <Text style={styles.name}>{t('payout.noZaad')}</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('ZaadAccount')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.change}>{zaad ? t('payout.changeZaad') : t('payout.addZaad')}</Text>
        </TouchableOpacity>
      </GlassCard>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: TEXT_FAINT,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  card: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  text: { flex: 1, gap: 2 },
  number: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  name: { fontSize: 13, color: TEXT_DIM },
  change: { fontSize: 14, fontWeight: '600', color: ACCENT },
});
