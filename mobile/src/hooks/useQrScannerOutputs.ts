import { useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { NitroModules } from 'react-native-nitro-modules';
import {
  VisionCamera,
  useObjectOutput,
  type CameraOutput,
  type ScannedCode,
  type ScannedObject,
  type ScannedObjectType,
} from 'react-native-vision-camera';
import type {
  Barcode,
  TargetBarcodeFormat,
} from 'react-native-vision-camera-barcode-scanner';

/**
 * QR scanning on VisionCamera 5.
 *
 * iOS reads codes with VisionCamera's own object output (Apple's detector).
 * That output is iOS-only, so Android uses ML Kit through the barcode-scanner
 * package — which is not linked on iOS (react-native.config.js) and creates
 * its native object on import, so it is only required on Android.
 */
const barcodeScanner: typeof import('react-native-vision-camera-barcode-scanner') | null =
  Platform.OS === 'android' ? require('react-native-vision-camera-barcode-scanner') : null;

/** False when the native camera isn't linked into this build. */
export const CAMERA_NATIVE_AVAILABLE = NitroModules.hasHybridObject('CameraFactory');

// Both outputs are memoized on these arrays, so they must stay module constants:
// a fresh array each render would rebuild the camera output every render.
const IOS_TYPES: ScannedObjectType[] = ['qr'];
const ANDROID_FORMATS: TargetBarcodeFormat[] = ['qr-code'];

type OnScan = (value: string) => void;

function useIosQrOutput(onScan: OnScan): CameraOutput {
  const latest = useRef(onScan);
  latest.current = onScan;
  const onObjectsScanned = useCallback((objects: ScannedObject[]) => {
    const value = objects.map((o) => (o as ScannedCode).value).find(Boolean);
    if (value) latest.current(value);
  }, []);
  return useObjectOutput({ types: IOS_TYPES, onObjectsScanned });
}

function useAndroidQrOutput(onScan: OnScan): CameraOutput {
  return barcodeScanner!.useBarcodeScannerOutput({
    barcodeFormats: ANDROID_FORMATS,
    onBarcodeScanned: (barcodes: Barcode[]) => {
      const value = barcodes.map((b) => b.rawValue).find(Boolean);
      if (value) onScan(value);
    },
    onError: (error: Error) => console.warn('QR scanner error', error),
  });
}

const useQrOutput = Platform.OS === 'android' ? useAndroidQrOutput : useIosQrOutput;

/**
 * Camera outputs that call `onScan` with each QR code read, for
 * `<Camera outputs={...} />`. `onScan` may change every render; the latest
 * one is always called.
 */
export function useQrScannerOutputs(onScan: OnScan): CameraOutput[] {
  const output = useQrOutput(onScan);
  return useMemo(() => [output], [output]);
}

/** Ask for camera access; resolves true when granted. */
export async function requestCameraPermission(): Promise<boolean> {
  if (VisionCamera.cameraPermissionStatus === 'authorized') return true;
  return VisionCamera.requestCameraPermission();
}
