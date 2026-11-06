import React, { useState } from 'react';
import { Vibration } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { QrScannerView } from '../../components/QrScannerView';
import { validateQRCode } from '../../services/qr.service';
import { parseChargeLink } from '../../services/apiCharge.service';

interface Props {
  navigation: any;
}

export default function ScanQRScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [isScanning, setIsScanning] = useState(true);
  const [checking, setChecking] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      setIsScanning(true);
      setScanError(null);
    }, [])
  );

  const handleQRScanned = async (qrData: string) => {
    setIsScanning(false);
    setScanError(null);

    // An online checkout or a till's customer display: the charge already
    // carries the amount, so it goes straight to review.
    const chargeId = parseChargeLink(qrData);
    if (chargeId) {
      Vibration.vibrate(100);
      navigation.navigate('ApprovePayment', { chargeId });
      return;
    }

    setChecking(true);
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
      setScanError(error.message || t('qr.scan.invalidQr'));
      setIsScanning(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <QrScannerView
      title={t('qr.scan.title')}
      hint={t('qr.scan.instruction')}
      onScan={handleQRScanned}
      onClose={() => navigation.goBack()}
      scanning={isScanning}
      busy={checking ? t('qr.scan.checking') : null}
      error={scanError}
      onDismissError={() => setScanError(null)}
    />
  );
}
