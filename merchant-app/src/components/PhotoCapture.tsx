import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, Platform, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Camera, useCameraDevice, usePhotoOutput, type CameraPhotoOutput } from 'react-native-vision-camera';
import { CAMERA_NATIVE_AVAILABLE, requestCameraPermission } from '../hooks/useQrScannerOutputs';
import { PillButton, TEXT_DIM } from './DarkScreen';
import { CloseIcon } from './icons/AuthIcons';
import { triggerHaptic } from '../services/haptics.service';
import { logger } from '../utils/logger';

interface Props {
  visible: boolean;
  /** "front" for a selfie, "back" for documents and the shop. */
  facing: 'front' | 'back';
  title: string;
  hint: string;
  onClose: () => void;
  /** Local file path of the photo taken. */
  onCaptured: (filePath: string) => void;
}

function CameraLayer({
  facing,
  photoRef,
  onPermission,
}: {
  facing: 'front' | 'back';
  photoRef: React.MutableRefObject<CameraPhotoOutput | null>;
  onPermission: (granted: boolean) => void;
}) {
  const device = useCameraDevice(facing);
  // 'balanced': sharp enough to read an ID, small enough to upload on 3G.
  // 'jpeg': the default ('native') is HEIC on iPhone, which the review console
  // in Chrome cannot show, and the file is uploaded as .jpg either way.
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg', quality: 0.85, qualityPrioritization: 'balanced' });
  const outputs = useMemo(() => [photoOutput], [photoOutput]);

  useEffect(() => {
    photoRef.current = photoOutput;
    return () => {
      photoRef.current = null;
    };
  }, [photoOutput, photoRef]);

  useEffect(() => {
    let cancelled = false;
    requestCameraPermission()
      .then((granted) => !cancelled && onPermission(granted))
      .catch(() => !cancelled && onPermission(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!device) return null;
  return <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={outputs} />;
}

/** Full-screen camera for one application photo: ID side, selfie or shop. */
export function PhotoCapture({ visible, facing, title, hint, onClose, onCaptured }: Props) {
  const { t } = useTranslation();
  // A SafeAreaView inside a Modal can report no top inset, which put the close
  // button under the status bar. Read the insets and keep a floor below the notch.
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === 'ios' ? 54 : 24);
  const bottomInset = Math.max(insets.bottom, 12);
  const photoRef = useRef<CameraPhotoOutput | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setBusy(false);
      setError(null);
    }
  }, [visible]);

  const capture = useCallback(async () => {
    if (!photoRef.current || busy) return;
    setBusy(true);
    setError(null);
    triggerHaptic('medium');
    try {
      const photo = await photoRef.current.capturePhotoToFile({ flashMode: 'off' }, {});
      onCaptured(photo.filePath);
    } catch (e) {
      logger.warn('Photo capture failed:', e);
      setError(t('application.photo.failed'));
    } finally {
      setBusy(false);
    }
  }, [busy, onCaptured, t]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.root}>
        {visible && CAMERA_NATIVE_AVAILABLE && (
          <CameraLayer facing={facing} photoRef={photoRef} onPermission={setPermission} />
        )}

        <View style={[styles.overlay, { paddingTop: topInset, paddingBottom: bottomInset }]}>
          <View style={styles.top}>
            <TouchableOpacity onPress={onClose} style={styles.close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <CloseIcon size={16} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.hint}>{hint}</Text>
          </View>

          {facing === 'front' ? <View style={styles.faceFrame} /> : <View style={styles.cardFrame} />}

          <View style={styles.bottom}>
            {!CAMERA_NATIVE_AVAILABLE || permission === false ? (
              <>
                <Text style={styles.error}>{t('application.photo.noCamera')}</Text>
                <PillButton label={t('application.photo.openSettings')} onPress={() => Linking.openSettings()} variant="glass" />
              </>
            ) : (
              <>
                {!!error && <Text style={styles.error}>{error}</Text>}
                <TouchableOpacity
                  style={styles.shutter}
                  onPress={capture}
                  disabled={busy || permission !== true}
                  accessibilityRole="button"
                  accessibilityLabel={t('application.photo.take')}
                >
                  {busy ? <ActivityIndicator color="#000" /> : <View style={styles.shutterInner} />}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { paddingHorizontal: 20, paddingTop: 4 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  hint: { color: TEXT_DIM, fontSize: 15, marginTop: 6 },
  cardFrame: {
    alignSelf: 'center',
    width: '86%',
    aspectRatio: 1.58,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  faceFrame: {
    alignSelf: 'center',
    width: 240,
    height: 300,
    borderRadius: 150,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  bottom: { alignItems: 'center', paddingBottom: 24, paddingHorizontal: 20, gap: 12 },
  error: { color: '#FF8A80', textAlign: 'center', fontSize: 14 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF' },
});
