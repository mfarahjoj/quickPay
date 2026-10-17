// The barcode scanner (ML Kit) is Android-only here: iOS reads QR codes with
// VisionCamera's own object output, which keeps ML Kit — and its iOS 15.5
// minimum — out of the iOS build. See src/hooks/useQrScannerOutputs.ts.
module.exports = {
  dependencies: {
    'react-native-vision-camera-barcode-scanner': {
      platforms: { ios: null },
    },
  },
};
