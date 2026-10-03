import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Vibration,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { validateQRCode } from '../../services/qr.service';
import { parseChargeLink } from '../../services/apiCharge.service';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface Props {
  navigation: any;
}

export default function ScanQRScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [hasPermission, setHasPermission] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const device = useCameraDevice('back');

  React.useEffect(() => {
    (async () => {
      try {
        const status = await Camera.requestCameraPermission();
        setHasPermission(status === 'granted');
        if (status !== 'granted') {
          Alert.alert(
            t('qr.scan.permissionTitle'),
            t('qr.scan.permissionMessage'),
            [
              { text: t('common.cancel'), onPress: () => navigation.goBack(), style: 'cancel' },
              { text: t('common.ok') },
            ],
          );
        }
      } catch {
        Alert.alert(t('common.error'), t('common.failedRequestPermission'));
        navigation.goBack();
      }
    })();
  }, [navigation, t]);

  useFocusEffect(
    React.useCallback(() => {
      setIsScanning(true);
      setScanError(null);
    }, [])
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (!isScanning || codes.length === 0) {
        return;
      }

      const qrData = codes[0].value;
      if (qrData) {
        handleQRScanned(qrData);
      }
    },
  });

  const handleQRScanned = async (qrData: string) => {
    setIsScanning(false);

    // An online checkout or a till's customer display: the charge already
    // carries the amount, so it goes straight to review.
    const chargeId = parseChargeLink(qrData);
    if (chargeId) {
      Vibration.vibrate(100);
      navigation.navigate('ApprovePayment', { chargeId });
      return;
    }

    try {
      const validation = await validateQRCode(qrData);

      if (!validation.valid) {
        setScanError(validation.reason || t('qr.scan.invalidQr'));
        setIsScanning(true);
        return;
      }

      Vibration.vibrate(100);

      if (validation.isMerchantSticker) {
        navigation.navigate('EnterAmount', {
          merchantId: validation.merchantId!,
          merchantName: validation.merchantName || t('common.merchant'),
          currency: validation.currency || 'USD',
        });
      } else {
        navigation.navigate('PaymentConfirm', {
          qrCodeId: validation.qrCodeId,
          amount: validation.amount! / 100,
          currency: validation.currency!,
          merchantId: validation.merchantId,
          merchantName: validation.merchantName,
          reference: validation.reference,
        });
      }
    } catch (error: any) {
      setScanError(error.message);
      setIsScanning(true);
    }
  };

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{t('qr.scan.permissionRequired')}</Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        codeScanner={codeScanner}
        torch={torchOn ? 'on' : 'off'}
      />

      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{t('qr.scan.title')}</Text>
        <TouchableOpacity
          style={styles.torchButton}
          onPress={() => setTorchOn(!torchOn)}
          disabled={!device.hasTorch}
        >
          <Text style={styles.torchIcon}>{torchOn ? '🔦' : '💡'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.overlay}>
        <View style={styles.topOverlay} />
        <View style={styles.middleOverlay}>
          <View style={styles.sideOverlay} />
          <View style={styles.scanArea}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
          <View style={styles.sideOverlay} />
        </View>
        <View style={styles.bottomOverlay}>
          {scanError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorBoxText}>{scanError}</Text>
              <TouchableOpacity onPress={() => setScanError(null)}>
                <Text style={styles.tryAgainText}>{t('qr.scan.tryAgain')}</Text>
              </TouchableOpacity>
            </View>
          )}
          {!scanError && (
            <View style={styles.instructionBox}>
              <Text style={styles.instructionText}>
                {t('qr.scan.instruction')}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    color: colors.text.inverse,
    fontSize: 20,
    fontWeight: 'bold',
  },
  topBarTitle: {
    ...typography.h3,
    color: colors.text.inverse,
    fontWeight: '600',
  },
  torchButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  torchIcon: {
    fontSize: 20,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  topOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  middleOverlay: {
    flexDirection: 'row',
  },
  sideOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  scanArea: {
    width: 280,
    height: 280,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderColor: colors.dark.incoming,
    borderWidth: 4,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: borderRadius.md,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: borderRadius.md,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: borderRadius.md,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: borderRadius.md,
  },
  bottomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: spacing.xxl,
  },
  instructionBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  instructionText: {
    ...typography.body,
    color: colors.text.inverse,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  errorBoxText: {
    ...typography.body,
    color: colors.text.inverse,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  tryAgainText: {
    ...typography.bodySemibold,
    color: colors.text.inverse,
  },
  errorText: {
    ...typography.body,
    color: colors.text.inverse,
    textAlign: 'center',
  },
});
