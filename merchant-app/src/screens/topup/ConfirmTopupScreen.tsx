import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Vibration,
  NativeModules,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { functions } from '../../services/firebase.config';
import {
  DarkScreen,
  GlassCard,
  PillButton,
  PinInput,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import { SuccessCheckIcon, CloseIcon, ScanIcon } from '../../components/icons/AuthIcons';

// VisionCamera v3 crashes at module level on the simulator — guard before hooks.
const CAMERA_NATIVE_AVAILABLE =
  !!NativeModules.VisionCameraProxy || !!NativeModules.CameraDevicesManager;

type Step = 'capture' | 'pin' | 'processing' | 'success' | 'error';

interface Props {
  navigation: any;
}

interface Result {
  amount: number;
  customerName: string;
  commission: number;
  confirmationId: string;
}

// Accepts the QR JSON payload {type:'zapp_topup',code} or a raw 6-digit code.
function extractCode(value: string): string | null {
  const raw = value.trim();
  if (/^\d{6}$/.test(raw)) return raw;
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.type === 'zapp_topup' && /^\d{6}$/.test(String(obj.code))) {
      return String(obj.code);
    }
  } catch {
    // not JSON
  }
  return null;
}

function shortConfirmation(id: string): string {
  return `ZP-${id.slice(-6).toUpperCase()}`;
}

interface CameraLayerProps {
  isActive: boolean;
  onScan: (value: string) => void;
  onPermission: (granted: boolean) => void;
}

function CameraLayer({ isActive, onScan, onPermission }: CameraLayerProps) {
  const device = useCameraDevice('back');

  React.useEffect(() => {
    (async () => {
      try {
        const status = await Camera.requestCameraPermission();
        onPermission(status === 'granted');
      } catch {
        onPermission(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (!isActive || codes.length === 0) return;
      const value = codes[0].value;
      if (value) onScan(value);
    },
  });

  if (!device) return null;

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={isActive}
      codeScanner={codeScanner}
    />
  );
}

export default function ConfirmTopupScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('capture');
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [hasPermission, setHasPermission] = useState<boolean | null>(
    CAMERA_NATIVE_AVAILABLE ? null : false,
  );
  const [scanError, setScanError] = useState<string | null>(null);
  // The code identifies the customer's request; the PIN proves the person
  // holding the phone is the agent whose float is about to be spent.
  const [pendingCode, setPendingCode] = useState('');
  const [pin, setPin] = useState('');
  const isProcessing = useRef(false);

  useFocusEffect(
    useCallback(() => {
      isProcessing.current = false;
      setScanError(null);
    }, []),
  );

  const confirm = useCallback(async (code: string, agentPin: string) => {
    if (isProcessing.current) return;
    isProcessing.current = true;
    setStep('processing');
    try {
      const fn = functions().httpsCallable('agentConfirmTopup');
      const res = await fn({ otpCode: code, agentPin });
      setResult((res.data as any).data);
      setStep('success');
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to confirm top-up');
      setStep('error');
    } finally {
      setPin('');
      isProcessing.current = false;
    }
  }, []);

  const askForPin = useCallback((code: string) => {
    setPendingCode(code);
    setPin('');
    setStep('pin');
  }, []);

  const handleScan = useCallback(
    (value: string) => {
      if (isProcessing.current) return;
      const code = extractCode(value);
      if (!code) {
        setScanError('Not a Zapp top-up code');
        return;
      }
      Vibration.vibrate(80);
      askForPin(code);
    },
    [askForPin],
  );

  const handleManual = () => {
    const code = extractCode(manual);
    if (!code) {
      setScanError('Enter the 6-digit code from the customer');
      return;
    }
    askForPin(code);
  };

  if (step === 'success' && result) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <SuccessCheckIcon size={72} />
        <Text style={styles.resultTitle}>Top-Up Confirmed</Text>
        <Text style={styles.resultAmount}>${(result.amount / 100).toFixed(2)}</Text>
        <Text style={styles.resultSub}>Credited to {result.customerName}</Text>
        <GlassCard style={styles.confCard}>
          <Text style={styles.confLabel}>CONFIRMATION ID</Text>
          <Text style={styles.confValue}>{shortConfirmation(result.confirmationId)}</Text>
        </GlassCard>
        {result.commission > 0 && (
          <GlassCard style={styles.commissionCard}>
            <Text style={styles.commissionLabel}>YOUR COMMISSION</Text>
            <Text style={styles.commissionValue}>+${(result.commission / 100).toFixed(2)}</Text>
          </GlassCard>
        )}
        <View style={styles.resultBtn}>
          <PillButton label="Done" onPress={() => navigation.goBack()} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'error') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <View style={styles.failIcon}>
          <CloseIcon size={32} color="#FF6961" />
        </View>
        <Text style={styles.resultTitle}>Couldn’t Confirm</Text>
        <Text style={styles.resultSub}>{errorMsg}</Text>
        <View style={styles.resultBtn}>
          <PillButton
            label="Try Again"
            variant="glass"
            onPress={() => {
              setStep('capture');
              setManual('');
              setErrorMsg('');
              setScanError(null);
              isProcessing.current = false;
            }}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <Text style={styles.resultTitle}>{t('topup.confirm.pinTitle')}</Text>
        <Text style={styles.resultSub}>{t('topup.confirm.pinSubtitle')}</Text>
        <PinInput
          value={pin}
          onChange={setPin}
          onComplete={(entered) => confirm(pendingCode, entered)}
          style={styles.pinInput}
        />
        <View style={styles.resultBtn}>
          <PillButton
            label={t('common.cancel')}
            variant="glass"
            onPress={() => {
              setPin('');
              setPendingCode('');
              setScanError(null);
              isProcessing.current = false;
              setStep('capture');
            }}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'processing') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.resultWrap}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.processingText}>Confirming top-up…</Text>
      </DarkScreen>
    );
  }

  const cameraReady = CAMERA_NATIVE_AVAILABLE && hasPermission === true;

  return (
    <View style={styles.root}>
      {CAMERA_NATIVE_AVAILABLE && (
        <CameraLayer
          isActive={cameraReady}
          onScan={handleScan}
          onPermission={setHasPermission}
        />
      )}

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topOverlay} />
        <View style={styles.middleRow}>
          <View style={styles.sideOverlay} />
          <View style={styles.scanWindow}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
            {!cameraReady && (
              <View style={styles.placeholderCenter}>
                {hasPermission === null ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ScanIcon size={44} color="rgba(255,255,255,0.4)" />
                )}
              </View>
            )}
          </View>
          <View style={styles.sideOverlay} />
        </View>
        <View style={styles.bottomOverlay}>
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              {scanError || 'Scan the customer’s top-up QR'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.topBar} pointerEvents="box-none">
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Confirm Top-Up</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.manualWrap}
        pointerEvents="box-none"
      >
        <View style={styles.manualSection}>
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>OR ENTER CODE</Text>
            <View style={styles.orLine} />
          </View>
          <GlassCard style={styles.inputCard}>
            <TextInput
              style={styles.otpInput}
              value={manual}
              onChangeText={(t) => { setManual(t.replace(/\D/g, '').slice(0, 6)); setScanError(null); }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="— — — — — —"
              placeholderTextColor="rgba(255,255,255,0.2)"
            />
          </GlassCard>
          <PillButton
            label="Confirm & Credit"
            onPress={handleManual}
            disabled={extractCode(manual) === null}
            style={styles.verifyBtn}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Top gets less flex than bottom so the scan window sits in the visible
  // space between the top bar and the manual-entry panel, not behind it.
  topOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  bottomOverlay: {
    flex: 1.7,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    paddingTop: 20,
  },
  middleRow: { flexDirection: 'row' },
  sideOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  scanWindow: { width: 268, height: 268, justifyContent: 'center', alignItems: 'center' },
  placeholderCenter: { position: 'absolute' },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: ACCENT },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  hintBox: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  hintText: { fontSize: 14, color: '#fff', fontWeight: '500', textAlign: 'center' },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  backArrow: { fontSize: 24, color: '#fff', lineHeight: 28 },
  topBarTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  topBarSpacer: { width: 36 },
  manualWrap: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
  },
  manualSection: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.15)' },
  orText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: 'rgba(255,255,255,0.35)' },
  inputCard: { height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  otpInput: { fontSize: 30, fontWeight: '800', color: ACCENT, letterSpacing: 8, textAlign: 'center', width: '100%' },
  verifyBtn: { marginTop: 0 },

  // Result states
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  failIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,59,48,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  resultTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, textAlign: 'center', marginTop: 20 },
  resultAmount: { fontSize: 44, fontWeight: '800', color: '#34C77B', letterSpacing: -2, marginTop: 8 },
  resultSub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  confCard: { marginTop: 20, padding: 16, alignItems: 'center', width: '100%' },
  confLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  confValue: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 4, letterSpacing: 1 },
  commissionCard: { marginTop: 14, padding: 16, alignItems: 'center', width: '100%' },
  commissionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: TEXT_FAINT },
  commissionValue: { fontSize: 26, fontWeight: '800', color: '#34C77B', marginTop: 4 },
  resultBtn: { alignSelf: 'stretch', marginTop: 28 },
  pinInput: { marginTop: 28 },
  processingText: { fontSize: 16, color: TEXT_DIM, marginTop: 20 },
});
