import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  Camera,
  useCameraDevice,
  usePhotoOutput,
  type CameraPhotoOutput,
} from 'react-native-vision-camera';
import { CAMERA_NATIVE_AVAILABLE, requestCameraPermission } from '../hooks/useQrScannerOutputs';
import { GlassCard, PillButton, TEXT_DIM, TEXT_FAINT } from './DarkScreen';
import { CloseIcon, CheckIcon, ReceiptIcon, TorchIcon } from './icons/AuthIcons';
import {
  isReceiptOcrAvailable,
  readReceipt,
  setPreferredIdentifierKind,
} from '../services/receiptOcr.service';
import { triggerHaptic } from '../services/haptics.service';
import { ParsedReceipt, identifierToReference } from '../utils/receiptParser';
import { formatCents } from '../utils/money';
import { logger } from '../utils/logger';

export interface ReceiptDetails {
  /** Dollar total in cents, or null when the receipt had none we trust. */
  amountCents: number | null;
  /** "Invoice No 37841", or null when the merchant chose none. */
  reference: string | null;
  /** Kind of that number ("invoice", "kot"…), or null with no reference. */
  referenceKind: string | null;
}

interface ReceiptScannerProps {
  visible: boolean;
  onClose: () => void;
  onApply: (details: ReceiptDetails) => void;
}

type Step = 'camera' | 'reading' | 'review';

// ─── Camera layer — only mounted when the native module exists ───────────────
interface CameraLayerProps {
  active: boolean;
  torchOn: boolean;
  /** Filled with the photo output while the camera is mounted. */
  photoRef: React.MutableRefObject<CameraPhotoOutput | null>;
  onTorchAvailable: (hasTorch: boolean) => void;
  onPermission: (granted: boolean) => void;
}

function CameraLayer({ active, torchOn, photoRef, onTorchAvailable, onPermission }: CameraLayerProps) {
  const device = useCameraDevice('back');
  // 'quality': a receipt is small print on thermal paper, and the read is only
  // as good as the photo.
  const photoOutput = usePhotoOutput({ qualityPrioritization: 'quality' });
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
      .then((granted) => {
        if (!cancelled) onPermission(granted);
      })
      .catch(() => {
        if (!cancelled) onPermission(false);
      });
    return () => {
      cancelled = true;
    };
    // Ask once per mount; the callback is a stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (device) onTorchAvailable(device.hasTorch ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  if (!device) return null;

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={active}
      outputs={outputs}
      torchMode={torchOn ? 'on' : 'off'}
    />
  );
}

/**
 * Full-screen "scan receipt": photograph the till receipt, read it on the
 * device, and let the merchant confirm the total and pick which printed number
 * identifies the sale. Nothing is charged from here — the details only
 * pre-fill the Receive screen.
 */
export function ReceiptScanner({ visible, onClose, onApply }: ReceiptScannerProps) {
  const { t } = useTranslation();
  const photoRef = useRef<CameraPhotoOutput | null>(null);

  const [step, setStep] = useState<Step>('camera');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  // Index into receipt.identifiers, or -1 for "none of these".
  const [selected, setSelected] = useState(-1);

  const available = CAMERA_NATIVE_AVAILABLE && isReceiptOcrAvailable();

  // Start clean every time the scanner opens.
  useEffect(() => {
    if (!visible) return;
    setStep('camera');
    setError(null);
    setReceipt(null);
    setSelected(-1);
    setTorchOn(false);
  }, [visible]);

  const capture = useCallback(async () => {
    if (step !== 'camera' || !photoRef.current) return;
    setError(null);
    setStep('reading');
    triggerHaptic('medium');
    try {
      const photo = await photoRef.current.capturePhotoToFile({ flashMode: 'off' }, {});
      const parsed = await readReceipt(photo.filePath);
      if (parsed.amountCents === null && parsed.identifiers.length === 0) {
        setError(t('qr.receipt.failed'));
        setStep('camera');
        return;
      }
      setReceipt(parsed);
      setSelected(parsed.identifiers.length > 0 ? 0 : -1);
      setTorchOn(false);
      setStep('review');
    } catch (e) {
      logger.warn('Receipt scan failed:', e);
      setError(t('qr.receipt.failed'));
      setStep('camera');
    }
  }, [step, t]);

  const apply = () => {
    if (!receipt) return;
    const identifier = selected >= 0 ? receipt.identifiers[selected] : null;
    // Remember which kind of number this merchant uses. Only an actual pick is
    // remembered: choosing "none" for one sale shouldn't forget the habit.
    if (identifier) setPreferredIdentifierKind(identifier.kind);
    onApply({
      amountCents: receipt.amountCents,
      reference: identifier ? identifierToReference(identifier) : null,
      referenceKind: identifier ? identifier.kind : null,
    });
  };

  const retake = () => {
    setReceipt(null);
    setError(null);
    setStep('camera');
  };

  // ── Review ──────────────────────────────────────
  const renderReview = () => {
    if (!receipt) return null;
    const hasAmount = receipt.amountCents !== null;
    return (
      <SafeAreaView style={styles.reviewRoot} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.roundBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          >
            <CloseIcon size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.reviewContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.reviewTitle}>{t('qr.receipt.reviewTitle')}</Text>
          <Text style={styles.reviewSubtitle}>{t('qr.receipt.reviewSubtitle')}</Text>

          <GlassCard style={styles.totalCard}>
            <Text style={styles.cardLabel}>{t('qr.receipt.amountLabel')}</Text>
            {hasAmount ? (
              <Text style={styles.totalValue}>{formatCents(receipt.amountCents!)}</Text>
            ) : (
              <Text style={styles.totalMissing}>{t('qr.receipt.noAmount')}</Text>
            )}
          </GlassCard>

          <Text style={styles.sectionLabel}>{t('qr.receipt.identifierLabel')}</Text>
          {receipt.identifiers.length === 0 ? (
            <Text style={styles.noIdentifier}>{t('qr.receipt.noIdentifier')}</Text>
          ) : (
            <GlassCard>
              {receipt.identifiers.map((id, i) => (
                <React.Fragment key={`${id.kind}:${id.value}`}>
                  {i > 0 && <View style={styles.optionDivider} />}
                  <TouchableOpacity
                    style={styles.option}
                    onPress={() => setSelected(i)}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: selected === i }}
                  >
                    <View style={styles.optionText}>
                      <Text style={styles.optionLabel}>{id.label}</Text>
                      <Text style={styles.optionValue}>{id.value}</Text>
                    </View>
                    <View style={[styles.radio, selected === i && styles.radioOn]}>
                      {selected === i && <CheckIcon size={14} color="#000000" />}
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
              <View style={styles.optionDivider} />
              <TouchableOpacity
                style={styles.option}
                onPress={() => setSelected(-1)}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: selected === -1 }}
              >
                <Text style={[styles.optionLabel, styles.optionNone]}>{t('qr.receipt.none')}</Text>
                <View style={[styles.radio, selected === -1 && styles.radioOn]}>
                  {selected === -1 && <CheckIcon size={14} color="#000000" />}
                </View>
              </TouchableOpacity>
            </GlassCard>
          )}
          {receipt.identifiers.length > 1 && (
            <Text style={styles.rememberHint}>{t('qr.receipt.remember')}</Text>
          )}
        </ScrollView>

        <View style={styles.reviewFooter}>
          <PillButton label={t('qr.receipt.use')} onPress={apply} />
          <PillButton label={t('qr.receipt.retake')} variant="glass" onPress={retake} />
        </View>
      </SafeAreaView>
    );
  };

  // ── Camera ──────────────────────────────────────
  const renderCamera = () => {
    const ready = available && hasPermission === true;
    const reading = step === 'reading';
    return (
      <View style={styles.cameraRoot}>
        {available && (
          <CameraLayer
            // Kept running while the photo is read so the preview doesn't
            // drop to black under the "Reading…" overlay.
            active={visible && ready && step !== 'review'}
            torchOn={torchOn}
            photoRef={photoRef}
            onTorchAvailable={setHasTorch}
            onPermission={setHasPermission}
          />
        )}

        <SafeAreaView style={styles.cameraChrome} edges={['top', 'bottom']} pointerEvents="box-none">
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.roundBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <CloseIcon size={16} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.cameraTitle}>{t('qr.receipt.title')}</Text>
            {ready && hasTorch ? (
              <TouchableOpacity
                style={[styles.roundBtn, torchOn && styles.roundBtnOn]}
                onPress={() => setTorchOn((on) => !on)}
                accessibilityRole="button"
                accessibilityLabel={t('qr.receipt.torch')}
              >
                <TorchIcon size={18} color={torchOn ? '#000000' : '#FFFFFF'} />
              </TouchableOpacity>
            ) : (
              <View style={styles.roundSpacer} />
            )}
          </View>

          {/* Receipt-shaped guide */}
          <View style={styles.guideWrap} pointerEvents="none">
            <View style={styles.guide}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
              {!ready && (
                <View style={styles.guideCenter}>
                  {available && hasPermission === null ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ReceiptIcon size={48} color="rgba(255,255,255,0.4)" />
                  )}
                </View>
              )}
              {reading && (
                <View style={styles.readingVeil}>
                  <ActivityIndicator color="#FFFFFF" size="large" />
                  <Text style={styles.readingText}>{t('qr.receipt.reading')}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.cameraFooter}>
            {!available ? (
              <Text style={styles.cameraMessage}>{t('qr.receipt.unavailable')}</Text>
            ) : hasPermission === false ? (
              <>
                <Text style={styles.cameraMessage}>{t('qr.receipt.permission')}</Text>
                <PillButton
                  label={t('qr.receipt.openSettings')}
                  variant="glass"
                  onPress={() => Linking.openSettings()}
                  style={styles.settingsBtn}
                />
              </>
            ) : (
              <>
                <Text style={[styles.cameraMessage, !!error && styles.cameraError]}>
                  {error ?? t('qr.receipt.hint')}
                </Text>
                <TouchableOpacity
                  style={[styles.shutter, (!ready || reading) && styles.shutterDisabled]}
                  onPress={capture}
                  disabled={!ready || reading}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={t('qr.receipt.capture')}
                >
                  <View style={styles.shutterInner} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {step === 'review' ? renderReview() : renderCamera()}
    </Modal>
  );
}

const CORNER = 26;

const styles = StyleSheet.create({
  // camera
  cameraRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  cameraChrome: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    minHeight: 52,
  },
  cameraTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  roundBtnOn: {
    backgroundColor: '#FFFFFF',
  },
  roundSpacer: {
    width: 40,
  },
  guideWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  guide: {
    width: '74%',
    flex: 1,
    maxHeight: 520,
  },
  guideCenter: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: '#FFFFFF',
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  readingVeil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  readingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cameraFooter: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 20,
    gap: 20,
  },
  cameraMessage: {
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  cameraError: {
    color: '#FF6961',
    fontWeight: '600',
  },
  settingsBtn: {
    alignSelf: 'stretch',
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterDisabled: {
    opacity: 0.35,
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
  },

  // review
  reviewRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  reviewContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
  },
  reviewTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
  reviewSubtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: TEXT_DIM,
    marginTop: 6,
    marginBottom: 24,
  },
  totalCard: {
    padding: 20,
    marginBottom: 28,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_FAINT,
    marginBottom: 6,
  },
  totalValue: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  totalMissing: {
    fontSize: 15,
    lineHeight: 21,
    color: '#FFB020',
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  noIdentifier: {
    fontSize: 15,
    lineHeight: 21,
    color: TEXT_DIM,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    minHeight: 64,
    gap: 12,
  },
  optionText: {
    flex: 1,
    paddingVertical: 10,
  },
  optionLabel: {
    fontSize: 13,
    color: TEXT_DIM,
  },
  optionNone: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  optionValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  optionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginLeft: 18,
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOn: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  rememberHint: {
    fontSize: 13,
    lineHeight: 19,
    color: TEXT_FAINT,
    marginTop: 12,
  },
  reviewFooter: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    gap: 12,
  },
});
