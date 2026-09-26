import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Vibration,
  NativeModules,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { scanCustomerToken } from '../../services/scan.service';
import { GlassCard, PillButton } from '../../components';
import { ScanIcon } from '../../components/icons/AuthIcons';

const ACCENT_COLOR = '#FF5043';

// VisionCamera v3 crashes at module level on simulator — guard before any hook call.
const CAMERA_NATIVE_AVAILABLE = !!NativeModules.VisionCameraProxy || !!NativeModules.CameraDevicesManager;

// ─── Camera layer — only rendered when native module exists ───────────────────
interface CameraLayerProps {
  isActive: boolean;
  torchOn: boolean;
  onScan: (value: string) => void;
  onDeviceReady: (hasTorch: boolean) => void;
  onPermission: (granted: boolean) => void;
}

function CameraLayer({ isActive, torchOn, onScan, onDeviceReady, onPermission }: CameraLayerProps) {
  const device = useCameraDevice('back');
  const notifiedDevice = useRef(false);

  React.useEffect(() => {
    (async () => {
      try {
        const status = await Camera.requestCameraPermission();
        onPermission(status === 'granted');
      } catch {
        onPermission(false);
      }
    })();
  }, []);

  React.useEffect(() => {
    if (device && !notifiedDevice.current) {
      notifiedDevice.current = true;
      onDeviceReady(device.hasTorch ?? false);
    }
  }, [device]);

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
      torch={torchOn ? 'on' : 'off'}
    />
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function ScanCustomerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [hasPermission, setHasPermission] = useState<boolean | null>(
    CAMERA_NATIVE_AVAILABLE ? null : false
  );
  const [isScanning, setIsScanning] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
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
      Vibration.vibrate(80);
      try {
        const result = await scanCustomerToken(tokenData);
        navigation.navigate('Charge', {
          tokenId: result.tokenId,
          customerName: result.customerName,
          customerId: result.customerId,
        });
      } catch (e: any) {
        setScanError(e.message || t('scan.scanFailedMessage'));
        setIsScanning(true);
        isProcessing.current = false;
      } finally {
        setLoading(false);
      }
    },
    [loading, navigation, t]
  );

  const handleManualSubmit = () => {
    const trimmed = manualInput.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('scan.pasteRequiredMessage'));
      return;
    }
    handleScan(trimmed);
  };

  const cameraReady = CAMERA_NATIVE_AVAILABLE && hasPermission === true;

  return (
    <View style={styles.root}>
      {/* Camera feed — only when native module is present */}
      {CAMERA_NATIVE_AVAILABLE && (
        <CameraLayer
          isActive={cameraReady && (isScanning || loading)}
          torchOn={torchOn}
          onScan={(value) => {
            if (isScanning && !isProcessing.current) handleScan(value);
          }}
          onDeviceReady={(torch) => setHasTorch(torch)}
          onPermission={(granted) => {
            setHasPermission(granted);
            if (!granted) {
              Alert.alert(
                t('scan.permissionTitle', 'Camera Access Needed'),
                t('scan.permissionMessage', 'Allow camera access to scan customer QR codes.'),
              );
            }
          }}
        />
      )}

      {/* Dark overlay with scan window */}
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
          {scanError ? (
            <TouchableOpacity
              style={styles.errorBox}
              onPress={() => { setScanError(null); setIsScanning(true); isProcessing.current = false; }}
            >
              <Text style={styles.errorText}>{scanError}</Text>
              <Text style={styles.tapRetry}>{t('scan.tapRetry')}</Text>
            </TouchableOpacity>
          ) : loading ? (
            <View style={styles.hintBox}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.hintText}>{t('scan.verifying')}</Text>
            </View>
          ) : hasPermission === false ? (
            <View style={styles.hintBox}>
              <Text style={styles.hintText}>
                {CAMERA_NATIVE_AVAILABLE ? t('scan.cameraDenied') : t('scan.cameraUnavailable')}
              </Text>
            </View>
          ) : (
            <View style={styles.hintBox}>
              <Text style={styles.hintText}>{t('scan.cameraHint')}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Top bar */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topBarSpacer} />
        <Text style={styles.topBarTitle}>{t('scan.title', 'Scan Customer')}</Text>
        {hasTorch ? (
          <TouchableOpacity style={styles.torchBtn} onPress={() => setTorchOn(!torchOn)}>
            <Text style={styles.torchIcon}>{torchOn ? '🔦' : '💡'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
      </View>

      {/* Manual entry */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.manualWrap}
        pointerEvents="box-none"
      >
      <View style={styles.manualSection}>
        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>{t('scan.orManual', 'OR ENTER MANUALLY')}</Text>
          <View style={styles.orLine} />
        </View>

        <GlassCard style={styles.inputCard}>
          <TextInput
            style={styles.textInput}
            placeholder={t('scan.pastePlaceholder', 'Paste token here…')}
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={manualInput}
            onChangeText={setManualInput}
            multiline
            numberOfLines={2}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </GlassCard>

        <PillButton
          label={t('scan.verifyCustomer', 'Verify Customer')}
          onPress={handleManualSubmit}
          loading={loading}
          disabled={!manualInput.trim() || loading}
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
  scanWindow: {
    width: 268,
    height: 268,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderCenter: { position: 'absolute' },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: ACCENT_COLOR },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  hintBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  hintText: { fontSize: 14, color: '#fff', fontWeight: '500' },
  errorBox: {
    backgroundColor: 'rgba(255,69,58,0.85)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    gap: 4,
  },
  errorText: { fontSize: 14, color: '#fff', fontWeight: '600', textAlign: 'center' },
  tapRetry: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  topBarSpacer: { width: 44 },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
  },
  torchBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  torchIcon: { fontSize: 22 },
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
  inputCard: { padding: 0, marginBottom: 12 },
  textInput: {
    fontSize: 14,
    color: '#fff',
    padding: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  verifyBtn: { marginTop: 0 },
});
