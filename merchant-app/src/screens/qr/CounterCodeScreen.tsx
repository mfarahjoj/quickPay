import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { generateMerchantSticker } from '../../services/qr.service';
import { MerchantStickerData } from '../../types';
import { callableErrorKey } from '../../utils/errors';
import { DarkScreen, ScreenHeader, PillButton, TEXT_DIM } from '../../components';
import CounterIncomingFeed from './CounterIncomingFeed';

const QR_SIZE = 132;

/**
 * The counter code: the shop's one printed QR. The customer scans it and
 * types the amount themselves, so there is nothing to do here per sale. The
 * shopkeeper prints it once and watches payments land in the list.
 *
 * It is reached from the top of Receive, off the path of a normal sale.
 */
export default function CounterCodeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [sticker, setSticker] = useState<MerchantStickerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qrRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    generateMerchantSticker()
      .then((s) => {
        if (!cancelled) setSticker(s);
      })
      .catch((e: any) => {
        if (!cancelled) setError(t(callableErrorKey(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const share = async () => {
    if (!sticker) return;
    const message = t('qr.counter.shareMessage', { name: sticker.merchantName });
    try {
      const dataUrl: string | null = await new Promise((resolve) => {
        if (!qrRef.current?.toDataURL) return resolve(null);
        qrRef.current.toDataURL((data: string) => resolve(data));
      });
      if (dataUrl) {
        await Share.share({ url: `data:image/png;base64,${dataUrl}`, message });
        return;
      }
    } catch {
      // Fall through to a plain text share below.
    }
    try {
      await Share.share({ message });
    } catch {
      // User dismissed the sheet.
    }
  };

  return (
    <DarkScreen scroll contentStyle={styles.content}>
      <ScreenHeader title={t('qr.mode.counter')} onBack={() => navigation.goBack()} />

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {sticker ? (
        <>
          <View style={styles.card}>
            <QRCode
              value={sticker.qrData}
              size={QR_SIZE}
              backgroundColor="#FFFFFF"
              color="#000000"
              getRef={(c) => {
                qrRef.current = c;
              }}
            />
            <View style={styles.cardBody}>
              <Text style={styles.name} numberOfLines={2}>
                {sticker.merchantName}
              </Text>
              <Text style={styles.cardText}>{t('qr.counter.subtitle')}</Text>
              <Text style={styles.cardHint}>{t('qr.counter.hint')}</Text>
            </View>
          </View>

          <View style={styles.feed}>
            <CounterIncomingFeed />
          </View>

          <View style={styles.footer}>
            <PillButton label={t('qr.counter.share')} variant="glass" onPress={share} />
          </View>
        </>
      ) : (
        <Text style={styles.info}>
          {loading ? t('qr.counter.loading') : error ? '' : t('qr.counter.unavailable')}
        </Text>
      )}
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginHorizontal: 20,
    marginTop: 8,
    padding: 18,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
  },
  cardBody: { flex: 1, gap: 6 },
  name: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, color: '#000000' },
  cardText: { fontSize: 14, lineHeight: 19, color: '#48484A' },
  cardHint: { fontSize: 13, lineHeight: 18, color: '#636366' },
  feed: { flexGrow: 1, paddingHorizontal: 20, marginTop: 8 },
  footer: { paddingHorizontal: 20, paddingTop: 16 },
  info: { fontSize: 14, color: TEXT_DIM, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,59,48,0.12)',
  },
  errorText: { fontSize: 13, fontWeight: '600', color: '#FF6961', textAlign: 'center' },
});
