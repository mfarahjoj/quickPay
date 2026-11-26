import React, { useState, useCallback, useRef } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { triggerHaptic } from '../../services/haptics.service';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect, useRoute, useIsFocused } from '@react-navigation/native';
import { scanCustomerToken } from '../../services/scan.service';
import { formatAmount } from '../../utils/money';
import { CodeSheet, QrScannerView, ScannerButton } from '../../components/QrScannerView';
import { useScannerInput, normaliseScannedCode } from '../../hooks/useScannerInput';

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
  const currency: 'USD' | 'SLS' = params?.currency === 'SLS' ? 'SLS' : 'USD';
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
          currency,
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
    [loading, navigation, t, purpose, amountCents, currency, reference]
  );

  // A paired Bluetooth/USB handheld scanner types the code into a hidden
  // field. It listens only while the camera does and the paste sheet is shut.
  const isFocused = useIsFocused();
  const scanner = useScannerInput({
    enabled: isFocused && isScanning && !pasting && !loading && !scanError,
    onScan: (code) => {
      if (!isProcessing.current) handleScan(code);
    },
  });

  // A scanner typing into the paste sheet ends with Enter: submit it.
  const handlePasteChange = (text: string) => {
    if (/[\r\n]$/.test(text) && text.trim()) {
      setPasting(false);
      handleScan(normaliseScannedCode(text));
      return;
    }
    setManualInput(text);
  };

  return (
    <>
      <QrScannerView
        title={
          purpose === 'cash_out'
            ? t('scan.cashOut.scanTitle')
            : amountCents
              ? t('scan.chargingAmount', { amount: formatAmount(amountCents, currency) })
              : t('scan.title')
        }
        hint={purpose === 'cash_out' ? t('scan.cashOut.hint') : t('scan.cameraHint')}
        onScan={handleScan}
        onClose={() => navigation.goBack()}
        closeIcon="back"
        scanning={isScanning && !pasting}
        busy={loading ? t('scan.verifying') : null}
        error={scanError}
        onDismissError={() => {
          setScanError(null);
          scanner.focus();
        }}
      >
        {!scanError && !loading ? (
          <Text style={styles.scannerHint}>{t('scan.scannerHint')}</Text>
        ) : null}
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
        onChangeText={handlePasteChange}
        placeholder={t('scan.pastePlaceholder')}
        submitLabel={t('scan.verifyCustomer')}
        onSubmit={() => {
          setPasting(false);
          handleScan(manualInput.trim());
        }}
        onClose={() => setPasting(false)}
        submitDisabled={!manualInput.trim()}
      />
      {/* Catches a paired Bluetooth/USB scanner; never visible, no keyboard. */}
      <TextInput style={styles.scannerInput} {...scanner.inputProps} />
    </>
  );
}

const styles = StyleSheet.create({
  scannerHint: {
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 8,
  },
  scannerInput: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
