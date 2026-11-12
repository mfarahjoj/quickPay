import React from 'react';
import { StyleSheet } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import {
  CAMERA_NATIVE_AVAILABLE,
  requestCameraPermission,
  useQrScannerOutputs,
} from '../hooks/useQrScannerOutputs';

export { CAMERA_NATIVE_AVAILABLE };

interface CameraLayerProps {
  isActive: boolean;
  onScan: (value: string) => void;
  onPermission: (granted: boolean) => void;
}

/** Back camera filling its parent, reporting each QR it reads. */
export function CameraLayer({ isActive, onScan, onPermission }: CameraLayerProps) {
  const device = useCameraDevice('back');

  React.useEffect(() => {
    requestCameraPermission()
      .then(onPermission)
      .catch(() => onPermission(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outputs = useQrScannerOutputs((value) => {
    if (isActive) onScan(value);
  });

  if (!device) return null;

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={isActive}
      outputs={outputs}
    />
  );
}
