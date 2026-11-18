import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { GlassCard } from '../../components';
import { formatLocal } from '../../utils/zaad';
import { makeStyles } from '../../theme';

/** Where payouts go: the Zaad account on file, with a way to change it. */
export function ZaadDestination({ zaad }: { zaad?: { msisdn: string; name: string } }) {
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.ui.textFaint,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  card: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  text: { flex: 1, gap: 2 },
  number: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  name: { fontSize: 13, color: colors.ui.textDim },
  change: { fontSize: 14, fontWeight: '600', color: colors.ui.accent },
}));
