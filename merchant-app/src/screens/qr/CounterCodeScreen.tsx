import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Share, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { generateMerchantSticker } from '../../services/qr.service';
import { MerchantStickerData } from '../../types';
import { callableErrorKey } from '../../utils/errors';
import { DarkScreen, ScreenHeader, PillButton, TEXT_DIM } from '../../components';
import CounterIncomingFeed from './CounterIncomingFeed';

/**
 * My QR: the shop's own code. The customer scans it and types the amount
 * themselves, so there is nothing to do here per sale. The shopkeeper holds
 * up the phone, or prints the code once, and watches payments land in the
 * list underneath.
 *
 * The code is as wide as the sale ticket's, because it is mostly shown to a
 * customer across a counter. Reached from the top of Receive.
 */
export default function CounterCodeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const [sticker, setSticker] = useState<MerchantStickerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qrRef = useRef<any>(null);
  const qrSize = Math.min(260, width - 120);

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
      <ScreenHeader title={t('qr.myQr.title')} onBack={() => navigation.goBack()} />

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {sticker ? (
        <>
          <View style={styles.card}>
            <Text style={styles.payTo}>{t('qr.display.payTo')}</Text>
            <Text style={styles.name} numberOfLines={2}>
              {sticker.merchantName}
            </Text>
            <View style={styles.qr}>
              <QRCode
                value={sticker.qrData}
                size={qrSize}
                backgroundColor="#FFFFFF"
                color="#000000"
                getRef={(c) => {
                  qrRef.current = c;
                }}
              />
            </View>
            <Text style={styles.cardText}>{t('qr.myQr.hint')}</Text>
          </View>

          <View style={styles.footer}>
            <PillButton label={t('qr.counter.share')} variant="glass" onPress={share} />
            <Text style={styles.info}>{t('qr.counter.hint')}</Text>
          </View>

          <View style={styles.feed}>
            <CounterIncomingFeed />
          </View>
        </>
      ) : (
        <Text style={[styles.info, styles.infoAlone]}>
          {loading ? t('qr.counter.loading') : error ? '' : t('qr.counter.unavailable')}
        </Text>
      )}
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 24 },
  card: {
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 8,
    paddingTop: 24,
    paddingBottom: 22,
    paddingHorizontal: 20,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
  },
  payTo: { fontSize: 13, fontWeight: '600', color: '#636366' },
  name: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: '#000000',
    textAlign: 'center',
    marginTop: 2,
  },
  qr: { marginTop: 18, marginBottom: 16 },
  cardText: { fontSize: 15, fontWeight: '600', color: '#48484A', textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  feed: { paddingHorizontal: 20, marginTop: 12 },
  info: { fontSize: 13, lineHeight: 19, color: TEXT_DIM, textAlign: 'center' },
  infoAlone: { marginTop: 40, paddingHorizontal: 24 },
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
