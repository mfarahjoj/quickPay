import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Mask, Path, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import {
  CAMERA_NATIVE_AVAILABLE,
  requestCameraPermission,
  useQrScannerOutputs,
} from '../hooks/useQrScannerOutputs';

const FRAME = 264;
const RADIUS = 28;
const BRACKET = 34;
const CORAL = '#FF5043';
const GREEN = '#34C77B';
const RED = '#FF5C5C';

interface CameraFeedProps {
  /** Camera on; off once the screen is done with it. */
  running: boolean;
  /** Codes passed on; off while one is being checked. */
  accepting: boolean;
  torchOn: boolean;
  onScan: (value: string) => void;
  onTorchKnown: (hasTorch: boolean) => void;
}

/** Back camera filling the screen. Rendered only when the camera is linked. */
function CameraFeed({ running, accepting, torchOn, onScan, onTorchKnown }: CameraFeedProps) {
  const device = useCameraDevice('back');
  const outputs = useQrScannerOutputs((value) => {
    if (accepting) onScan(value);
  });

  useEffect(() => {
    if (device) onTorchKnown(device.hasTorch ?? false);
  }, [device, onTorchKnown]);

  if (!device) return null;
  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={running}
      outputs={outputs}
      torchMode={torchOn ? 'on' : 'off'}
    />
  );
}

function CloseGlyph({ back }: { back: boolean }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d={back ? 'M15 5l-7 7 7 7' : 'M6 6l12 12M18 6L6 18'}
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function TorchGlyph({ on }: { on: boolean }) {
  const color = on ? '#000000' : '#FFFFFF';
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8 2h8v3l-2 4v11a2 2 0 01-2 2 2 2 0 01-2-2V9L8 5V2z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        fill={on ? color : 'none'}
      />
      <Path d="M8 5h8" stroke={on ? '#FFFFFF' : color} strokeWidth={1.6} />
    </Svg>
  );
}

interface QrScannerViewProps {
  title: string;
  /** What to point the camera at. */
  hint: string;
  onScan: (value: string) => void;
  onClose: () => void;
  /** Screens pushed on a stack show a back chevron; the others a cross. */
  closeIcon?: 'back' | 'close';
  /** While false, codes are ignored: one is being checked, or a sheet is open. */
  scanning: boolean;
  /** Shown with a spinner while a scanned code is checked. */
  busy?: string | null;
  /** Shown in red; tapping it calls onDismissError. */
  error?: string | null;
  onDismissError?: () => void;
  /** Anything to offer below the window. */
  children?: React.ReactNode;
}

/**
 * The QR scanner (the same as Zapp Pay Merchant's): the camera under a
 * dimmed screen with a rounded window, a line sweeping the window while it
 * looks, and the window turning green once a code is read or red when
 * it's refused. It stays dark in light mode, like the phone's own camera.
 */
export function QrScannerView({
  title,
  hint,
  onScan,
  onClose,
  closeIcon = 'close',
  scanning,
  busy,
  error,
  onDismissError,
  children,
}: QrScannerViewProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [permission, setPermission] = useState<boolean | null>(CAMERA_NATIVE_AVAILABLE ? null : false);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    if (!CAMERA_NATIVE_AVAILABLE) return;
    requestCameraPermission()
      .then(setPermission)
      .catch(() => setPermission(false));
  }, []);

  // The window sits a little above the middle, leaving room below for the
  // status and the other ways in.
  const x = (width - FRAME) / 2;
  const y = Math.max(insets.top + 84, (height - FRAME) / 2 - 56);
  const looking = permission === true && scanning && !busy && !error;
  const frameColor = error ? RED : busy ? GREEN : '#FFFFFF';

  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!looking) {
      sweep.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [looking, sweep]);
  const sweepY = sweep.interpolate({ inputRange: [0, 1], outputRange: [y + 22, y + FRAME - 24] });

  const r = RADIUS;
  const L = BRACKET;
  const x2 = x + FRAME;
  const y2 = y + FRAME;
  const brackets = [
    `M${x} ${y + L}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}H${x + L}`,
    `M${x2 - L} ${y}H${x2 - r}A${r} ${r} 0 0 1 ${x2} ${y + r}V${y + L}`,
    `M${x2} ${y2 - L}V${y2 - r}A${r} ${r} 0 0 1 ${x2 - r} ${y2}H${x2 - L}`,
    `M${x + L} ${y2}H${x + r}A${r} ${r} 0 0 1 ${x} ${y2 - r}V${y2 - L}`,
  ];

  const status = error ? (
    <TouchableOpacity style={[styles.pill, styles.pillError]} onPress={onDismissError} activeOpacity={0.85}>
      <Text style={styles.pillText}>{error}</Text>
      <Text style={styles.pillSub}>{t('qr.scan.tryAgain')}</Text>
    </TouchableOpacity>
  ) : busy ? (
    <View style={[styles.pill, styles.pillRow]}>
      <ActivityIndicator color="#FFFFFF" size="small" />
      <Text style={styles.pillText}>{busy}</Text>
    </View>
  ) : permission === true ? (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{hint}</Text>
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      {CAMERA_NATIVE_AVAILABLE && permission === true ? (
        <CameraFeed
          running={scanning || !!busy}
          accepting={scanning && !busy}
          torchOn={torchOn}
          onScan={onScan}
          onTorchKnown={setHasTorch}
        />
      ) : null}

      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Mask id="qr-window">
            <Rect x={0} y={0} width={width} height={height} fill="#FFFFFF" />
            <Rect x={x} y={y} width={FRAME} height={FRAME} rx={r} ry={r} fill="#000000" />
          </Mask>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0.62)" mask="url(#qr-window)" />
        {brackets.map((d) => (
          <Path key={d} d={d} stroke={frameColor} strokeWidth={4} strokeLinecap="round" fill="none" />
        ))}
      </Svg>

      {looking ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.sweep, { left: x + 22, width: FRAME - 44, transform: [{ translateY: sweepY }] }]}
        />
      ) : null}

      {permission === false ? (
        <View style={[styles.windowNote, { left: x, top: y, width: FRAME, height: FRAME }]}>
          <Text style={styles.windowNoteText}>
            {CAMERA_NATIVE_AVAILABLE ? t('qr.scan.cameraOff') : t('qr.scan.noCamera')}
          </Text>
          {CAMERA_NATIVE_AVAILABLE ? (
            <TouchableOpacity style={styles.settingsBtn} onPress={() => Linking.openSettings().catch(() => undefined)}>
              <Text style={styles.settingsText}>{t('qr.scan.openSettings')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : permission === null ? (
        <View style={[styles.windowNote, { left: x, top: y, width: FRAME, height: FRAME }]}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : null}

      <View style={[styles.statusWrap, { top: y + FRAME + 24 }]} pointerEvents="box-none">
        {status}
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.roundBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeIcon === 'back' ? t('common.back') : t('qr.scan.close')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <CloseGlyph back={closeIcon === 'back'} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {hasTorch ? (
          <TouchableOpacity
            style={[styles.roundBtn, torchOn && styles.roundBtnOn]}
            onPress={() => setTorchOn((on) => !on)}
            accessibilityRole="switch"
            accessibilityState={{ checked: torchOn }}
            accessibilityLabel={t('qr.scan.flashlight')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <TorchGlyph on={torchOn} />
          </TouchableOpacity>
        ) : (
          <View style={styles.roundSpacer} />
        )}
      </View>

      {children ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  sweep: {
    position: 'absolute',
    top: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: CORAL,
    shadowColor: CORAL,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  windowNote: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  windowNoteText: { fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  settingsBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
  },
  settingsText: { fontSize: 15, fontWeight: '700', color: '#000000' },
  statusWrap: { position: 'absolute', left: 24, right: 24, alignItems: 'center' },
  pill: {
    maxWidth: '100%',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 20,
    backgroundColor: 'rgba(20,20,24,0.78)',
    alignItems: 'center',
  },
  pillRow: { flexDirection: 'row', gap: 10 },
  pillError: { backgroundColor: 'rgba(255,92,92,0.92)', gap: 3 },
  pillText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', textAlign: 'center', lineHeight: 20 },
  pillSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  roundBtnOn: { backgroundColor: '#FFFFFF' },
  roundSpacer: { width: 44 },
  title: {
    flex: 1,
    marginHorizontal: 12,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: '#FFFFFF',
  },
  footer: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 0,
    alignItems: 'center',
    gap: 8,
  },
});
