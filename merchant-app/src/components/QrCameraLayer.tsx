import React from 'react';
import { NativeModules, StyleSheet } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';

// VisionCamera v3 crashes at module level on the simulator — guard before hooks.
export const CAMERA_NATIVE_AVAILABLE =
  !!NativeModules.VisionCameraProxy || !!NativeModules.CameraDevicesManager;

interface CameraLayerProps {
  isActive: boolean;
  onScan: (value: string) => void;
  onPermission: (granted: boolean) => void;
}

/** Back camera filling its parent, reporting each QR it reads. */
export function CameraLayer({ isActive, onScan, onPermission }: CameraLayerProps) {
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
