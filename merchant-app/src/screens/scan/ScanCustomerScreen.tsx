import React, { useState, useCallback, useRef } from 'react';
import { triggerHaptic } from '../../services/haptics.service';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { scanCustomerToken } from '../../services/scan.service';
import { formatCents } from '../../utils/money';
import { CodeSheet, QrScannerView, ScannerButton } from '../../components/QrScannerView';

/**
 * Scans the customer's Zapp QR. From Receive it charges them; as Give cash
 * (purpose cash_out) they approve on their phone and the agent hands over
 * the cash.
 */
export default function ScanCustomerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const params = useRoute<any>().params;
  const purpose: 'payment' | 'cash_out' =
    (params?.purpose as string) === 'cash_out' ? 'cash_out' : 'payment';
  // A sale already typed on Receive: its amount stays in sight while scanning.
  const amountCents: number | undefined =
    typeof params?.amountCents === 'number' && params.amountCents > 0 ? params.amountCents : undefined;
  const reference: string | undefined = params?.reference;
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  // The QR's data pasted instead of scanned: for testing, and a camera that won't focus.
  const [pasting, setPasting] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const isProcessing = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setIsScanning(true);
      setScanError(null);
      isProcessing.current = false;
    }, [])
  );

  const handleScan = useCallback(
    async (tokenData: string) => {
      if (!tokenData || loading || isProcessing.current) return;
      isProcessing.current = true;
      setIsScanning(false);
      setLoading(true);
      setScanError(null);
      triggerHaptic('medium');
      try {
        const result = await scanCustomerToken(tokenData);
        setManualInput('');
        navigation.navigate('Charge', {
          tokenId: result.tokenId,
          customerName: result.customerName,
          customerId: result.customerId,
          purpose,
          amountCents,
          reference,
        });
      } catch (e: any) {
        setScanError(e.message || t('scan.scanFailedMessage'));
        setIsScanning(true);
        isProcessing.current = false;
      } finally {
        setLoading(false);
      }
    },
    [loading, navigation, t, purpose, amountCents, reference]
  );

  return (
    <>
      <QrScannerView
        title={
          purpose === 'cash_out'
            ? t('scan.cashOut.scanTitle')
            : amountCents
              ? t('scan.chargingAmount', { amount: formatCents(amountCents) })
              : t('scan.title')
        }
        hint={purpose === 'cash_out' ? t('scan.cashOut.hint') : t('scan.cameraHint')}
        onScan={handleScan}
        onClose={() => navigation.goBack()}
        closeIcon="back"
        scanning={isScanning && !pasting}
        busy={loading ? t('scan.verifying') : null}
        error={scanError}
        onDismissError={() => setScanError(null)}
      >
        {/* Customer apps that can't approve at the counter show a cash-out code. */}
        {purpose === 'cash_out' ? (
          <ScannerButton label={t('scan.cashOut.haveCode')} onPress={() => navigation.replace('ConfirmCashOut')} />
        ) : null}
        <ScannerButton link label={t('scan.pasteCode')} onPress={() => setPasting(true)} />
      </QrScannerView>
      <CodeSheet
        visible={pasting}
        title={t('scan.pasteCode')}
        value={manualInput}
        onChangeText={setManualInput}
        placeholder={t('scan.pastePlaceholder')}
        submitLabel={t('scan.verifyCustomer')}
        onSubmit={() => {
          setPasting(false);
          handleScan(manualInput.trim());
        }}
        onClose={() => setPasting(false)}
        submitDisabled={!manualInput.trim()}
      />
    </>
  );
}
