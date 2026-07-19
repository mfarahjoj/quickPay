import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Vibration,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import LinearGradient from 'react-native-linear-gradient';
import { scanCustomerToken, createPaymentRequest, ScanTokenResult } from '../../services/customerToken.service';
import { firestore } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { CURRENCY_SYMBOL } from '../../config/constants';
import { Header } from '../../components/Header';

interface Props {
  navigation: any;
}

type Step = 'scan' | 'amount' | 'waiting' | 'done';

export default function MerchantScanScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('scan');
  const [isScanning, setIsScanning] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [customer, setCustomer] = useState<ScanTokenResult | null>(null);
  const [amountText, setAmountText] = useState('');
  const [sending, setSending] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string>('pending');

  const device = useCameraDevice('back');
  const listenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
      if (status !== 'granted') {
        Alert.alert(
          t('merchant.scan.permissionTitle'),
          t('merchant.scan.permissionMessage'),
          [
            { text: t('common.cancel'), onPress: () => navigation.goBack(), style: 'cancel' },
            { text: t('common.ok') },
          ],
        );
      }
    })();

    return () => {
      listenerRef.current?.();
    };
  }, [navigation, t]);

  useFocusEffect(
    React.useCallback(() => {
      if (step === 'scan') {
        setIsScanning(true);
        setScanError(null);
      }
    }, [step])
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (!isScanning || codes.length === 0) return;
      const qrData = codes[0].value;
      if (qrData) handleQRScanned(qrData);
    },
  });

  const handleQRScanned = async (tokenData: string) => {
    setIsScanning(false);
    setScanError(null);

    try {
      const result = await scanCustomerToken(tokenData);
      Vibration.vibrate(100);
      triggerHaptic('success');
      setCustomer(result);
      setStep('amount');
    } catch (err: any) {
      setScanError(err.message || t('merchant.scan.invalidQr'));
      setIsScanning(true);
    }
  };

  const parsedAmount = parseFloat(amountText);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;

  const handleCharge = async () => {
    if (!customer || !isValidAmount) return;

    try {
      setSending(true);
      const { requestId: rid } = await createPaymentRequest(
        customer.tokenId,
        parsedAmount,
        'USD',
      );
      setRequestId(rid);
      triggerHaptic('medium');
      setStep('waiting');

      const unsub = firestore()
        .collection('paymentRequests')
        .doc(rid)
        .onSnapshot((snap) => {
          const data = snap.data();
          if (!data) return;
          if (data.status === 'approved') {
            setPaymentStatus('approved');
            triggerHaptic('success');
            setStep('done');
          } else if (data.status === 'rejected') {
            setPaymentStatus('rejected');
            triggerHaptic('medium');
            setStep('done');
          } else if (data.status === 'expired') {
            setPaymentStatus('expired');
            setStep('done');
          }
        });
      listenerRef.current = unsub;
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('merchant.scan.chargeFailed'));
    } finally {
      setSending(false);
    }
  };

  const handleDone = () => {
    listenerRef.current?.();
    navigation.goBack();
  };

  const handleReset = () => {
    listenerRef.current?.();
    setStep('scan');
    setCustomer(null);
    setAmountText('');
    setRequestId(null);
    setPaymentStatus('pending');
    setIsScanning(true);
    setScanError(null);
  };

  if (step === 'scan') {
    if (!hasPermission || !device) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t('merchant.scan.settingUp')}</Text>
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
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <Text style={styles.closeIcon}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>{t('merchant.scan.title')}</Text>
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
            {scanError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorBoxText}>{scanError}</Text>
                <TouchableOpacity onPress={() => { setScanError(null); setIsScanning(true); }}>
                  <Text style={styles.tryAgainText}>{t('common.tryAgain')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.instructionBox}>
                <Text style={styles.instructionText}>
                  {t('merchant.scan.instruction')}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  if (step === 'amount' && customer) {
    return (
      <View style={styles.whiteContainer}>
        <Header title={t('merchant.scan.title')} onBack={handleReset} />
        <View style={styles.amountContent}>
          <View style={styles.customerBadge}>
            <View style={styles.customerAvatar}>
              <Text style={styles.customerAvatarText}>
                {customer.customerName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.customerName}>{customer.customerName}</Text>
          </View>

          <Text style={styles.amountLabel}>{t('merchant.scan.enterAmount')}</Text>
          <View style={styles.amountInputRow}>
            <Text style={styles.currencyPrefix}>{CURRENCY_SYMBOL}</Text>
            <TextInput
              style={styles.amountInput}
              value={amountText}
              onChangeText={setAmountText}
              placeholder="0.00"
              placeholderTextColor={colors.text.tertiary}
              keyboardType="decimal-pad"
              autoFocus
              maxLength={10}
            />
          </View>

          <TouchableOpacity
            style={[styles.chargeButton, !isValidAmount && styles.buttonDisabled]}
            onPress={handleCharge}
            disabled={!isValidAmount || sending}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[colors.primary, colors.primaryGradientEnd]}
              style={styles.gradientButton}
            >
              {sending ? (
                <ActivityIndicator color={colors.text.inverse} />
              ) : (
                <Text style={styles.chargeButtonText}>
                  {t('merchant.scan.charge', {
                    amount: `${CURRENCY_SYMBOL}${isValidAmount ? parsedAmount.toFixed(2) : '0.00'}`,
                  })}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === 'waiting') {
    return (
      <View style={styles.centeredWhite}>
        <View style={styles.waitingPulse}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        <Text style={styles.waitingTitle}>{t('merchant.scan.waitingTitle')}</Text>
        <Text style={styles.waitingSubtitle}>
          {t('merchant.scan.waitingSubtitle', {
            name: customer?.customerName ?? '',
            amount: `${CURRENCY_SYMBOL}${parsedAmount.toFixed(2)}`,
          })}
        </Text>
        <Text style={styles.waitingHint}>
          {t('merchant.scan.waitingHint')}
        </Text>
      </View>
    );
  }

  const isApproved = paymentStatus === 'approved';

  return (
    <View style={styles.centeredWhite}>
      <View style={[styles.statusCircle, isApproved ? styles.statusApproved : styles.statusDeclined]}>
        <Text style={styles.statusIcon}>{isApproved ? '✓' : '✕'}</Text>
      </View>
      <Text style={styles.doneTitle}>
        {isApproved
          ? t('merchant.scan.paymentReceived')
          : paymentStatus === 'expired'
            ? t('merchant.scan.requestExpired')
            : t('merchant.scan.paymentDeclined')}
      </Text>
      <Text style={styles.doneAmount}>
        {CURRENCY_SYMBOL}{parsedAmount.toFixed(2)}
      </Text>
      <Text style={styles.doneCustomer}>
        {isApproved
          ? t('merchant.scan.fromCustomer', { name: customer?.customerName ?? '' })
          : customer?.customerName}
      </Text>

      <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
        <Text style={styles.doneButtonText}>{t('common.done')}</Text>
      </TouchableOpacity>

      {!isApproved && (
        <TouchableOpacity style={styles.retryLink} onPress={handleReset}>
          <Text style={styles.retryLinkText}>{t('merchant.scan.scanAnother')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const SCAN_SIZE = 260;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  whiteContainer: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  centeredWhite: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dark.canvas,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.md,
    color: '#FFFFFF',
    ...typography.body,
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  closeIcon: { color: colors.text.inverse, fontSize: 20, fontWeight: 'bold' },
  topBarTitle: { ...typography.h3, color: colors.text.inverse, fontWeight: '600' },
  torchButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  torchIcon: { fontSize: 20 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  topOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  middleOverlay: { flexDirection: 'row' },
  sideOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  scanArea: { width: SCAN_SIZE, height: SCAN_SIZE, position: 'relative' },
  corner: { position: 'absolute', width: 48, height: 48, borderColor: colors.dark.incoming, borderWidth: 4 },
  topLeft: { top: 0, left: 0, borderTopLeftRadius: borderRadius.md },
  topRight: { top: 0, right: 0, borderTopRightRadius: borderRadius.md },
  bottomLeft: { bottom: 0, left: 0, borderBottomLeftRadius: borderRadius.md },
  bottomRight: { bottom: 0, right: 0, borderBottomRightRadius: borderRadius.md },
  bottomOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', paddingBottom: spacing.xxl,
  },
  instructionBox: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  instructionText: { ...typography.body, color: colors.text.inverse, fontWeight: '600', textAlign: 'center' },
  errorBox: {
    backgroundColor: 'rgba(255,59,48,0.9)',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: borderRadius.lg, alignItems: 'center',
  },
  errorBoxText: { ...typography.body, color: colors.text.inverse, marginBottom: spacing.sm, textAlign: 'center' },
  tryAgainText: { ...typography.bodySemibold, color: colors.text.inverse },

  amountContent: { flex: 1, padding: spacing.lg },
  customerBadge: { alignItems: 'center', marginBottom: spacing.xl, marginTop: spacing.md },
  customerAvatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.dark.incomingSoft,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: spacing.sm,
  },
  customerAvatarText: { ...typography.h1, color: colors.dark.incoming },
  customerName: { ...typography.h2, color: colors.dark.text, textAlign: 'center' },
  amountLabel: {
    ...typography.captionBold, color: colors.dark.textFaint,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  amountInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  currencyPrefix: { ...typography.display, color: colors.dark.textFaint, marginRight: spacing.sm },
  amountInput: { flex: 1, ...typography.display, color: colors.dark.text, padding: 0 },
  chargeButton: { borderRadius: borderRadius.lg, overflow: 'hidden' },
  gradientButton: { paddingVertical: spacing.lg, alignItems: 'center' },
  chargeButtonText: { ...typography.h3, color: colors.text.inverse, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },

  waitingPulse: { marginBottom: spacing.lg },
  waitingTitle: { ...typography.h1, color: colors.dark.text, marginBottom: spacing.sm },
  waitingSubtitle: { ...typography.body, color: colors.dark.textDim, textAlign: 'center', marginBottom: spacing.md },
  waitingHint: { ...typography.caption, color: colors.dark.textFaint, textAlign: 'center' },

  statusCircle: {
    width: 80, height: 80, borderRadius: 40,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: spacing.lg,
  },
  statusApproved: { backgroundColor: colors.dark.incomingSoft },
  statusDeclined: { backgroundColor: colors.dark.errorSoft },
  statusIcon: { fontSize: 36, fontWeight: '700' },
  doneTitle: { ...typography.h1, color: colors.dark.text, marginBottom: spacing.xs },
  doneAmount: { ...typography.display, color: colors.dark.text, marginBottom: spacing.xs },
  doneCustomer: { ...typography.body, color: colors.dark.textDim, marginBottom: spacing.xl },
  doneButton: {
    backgroundColor: colors.dark.accent,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.lg,
  },
  doneButtonText: { ...typography.bodySemibold, color: '#FFFFFF' },
  retryLink: { marginTop: spacing.lg, padding: spacing.md },
  retryLinkText: { ...typography.bodySemibold, color: colors.dark.accentText },
});
