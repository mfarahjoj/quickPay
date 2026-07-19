import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Share,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { getMerchantSticker, MerchantStickerData } from '../../services/merchant.service';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { Header } from '../../components/Header';

interface Props {
  navigation: any;
}

export default function MerchantQRScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [sticker, setSticker] = useState<MerchantStickerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSticker();
  }, []);

  const loadSticker = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getMerchantSticker();
      setSticker(data);
    } catch (e: any) {
      setError(e.message || t('merchant.qr.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (!sticker) return;
    try {
      await Share.share({
        message: t('merchant.qr.shareMessage', { name: sticker.merchantName }),
        title: t('merchant.qr.shareTitle', { name: sticker.merchantName }),
      });
    } catch {
      Alert.alert(t('common.error'), t('merchant.qr.shareFailed'));
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('merchant.qr.loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadSticker}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title={t('merchant.qr.title')} onBack={() => navigation.goBack()} />

      <View style={styles.body}>
        <View style={styles.qrCard}>
          <View style={styles.merchantBadge}>
            <Text style={styles.badgeInitial}>
              {sticker!.merchantName.charAt(0).toUpperCase()}
            </Text>
          </View>

          <Text style={styles.businessName}>{sticker!.merchantName}</Text>
          {sticker!.businessAddress ? (
            <Text style={styles.address}>{sticker!.businessAddress}</Text>
          ) : null}

          <View style={styles.qrWrapper}>
            <QRCode
              value={sticker!.qrData}
              size={220}
              backgroundColor="#FFFFFF"
              color="#000000"
            />
          </View>

          <Text style={styles.scanHint}>
            {t('merchant.qr.scanHint')}
          </Text>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>&#x1F6C8;</Text>
          <Text style={styles.infoText}>
            {t('merchant.qr.info')}
          </Text>
        </View>

        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
          <Text style={styles.shareText}>{t('merchant.qr.share')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dark.canvas,
    paddingHorizontal: spacing.lg,
  },
  body: {
    flex: 1,
    padding: spacing.lg,
    alignItems: 'center',
  },
  qrCard: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.xxl,
    padding: spacing.xl,
    alignItems: 'center',
    width: '100%',
  },
  merchantBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.dark.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.smPlus,
  },
  badgeInitial: {
    ...typography.h1,
    color: colors.dark.accentText,
  },
  businessName: {
    ...typography.h2,
    color: colors.dark.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  address: {
    ...typography.caption,
    color: colors.dark.textFaint,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  qrWrapper: {
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
  },
  scanHint: {
    ...typography.body,
    color: colors.dark.textFaint,
    textAlign: 'center',
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: colors.dark.accentSoft,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
    width: '100%',
    alignItems: 'flex-start',
  },
  infoIcon: {
    fontSize: 18,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  infoText: {
    ...typography.body,
    color: colors.dark.accentText,
    flex: 1,
  },
  shareButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.dark.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.lg,
  },
  shareText: {
    ...typography.bodySemibold,
    color: '#FFFFFF',
  },
  loadingText: {
    marginTop: spacing.md,
    ...typography.body,
    color: colors.dark.textDim,
  },
  errorText: {
    ...typography.body,
    color: colors.dark.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.dark.accent,
    paddingVertical: spacing.smPlus,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
  },
  retryText: {
    color: '#FFFFFF',
    ...typography.bodySemibold,
  },
});
