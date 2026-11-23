import { LogBox, Platform, Settings } from 'react-native';

/**
 * Local QA (docs/LOCAL_QA.md): point a debug build at the Firebase emulators.
 *
 * Off unless the simulator has been given a host, with no code change:
 *   xcrun simctl spawn <device> defaults write quickpay ZAPP_EMULATOR_HOST 127.0.0.1
 * and back to production with:
 *   xcrun simctl spawn <device> defaults delete quickpay ZAPP_EMULATOR_HOST
 *
 * Only a __DEV__ bundle ever reads it, so no release build can be pointed at a
 * local machine. iOS only (it reads NSUserDefaults).
 */
function readEmulatorHost(): string | null {
  if (!__DEV__ || Platform.OS !== 'ios') return null;
  try {
    const value = Settings.get('ZAPP_EMULATOR_HOST');
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export const EMULATOR_HOST = readEmulatorHost();

/** True while this debug build talks to local emulators instead of production. */
export const USING_EMULATORS = EMULATOR_HOST !== null;

if (USING_EMULATORS) {
  // React Native Firebase warns on every namespaced call (the move to the
  // modular API is a known to-do), and in a QA session the warning toast sits
  // over the tab bar and eats taps. Its own switch quiets it; the rest of
  // LogBox stays on.
  (globalThis as { RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS?: boolean }).RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;
  LogBox.ignoreLogs(['This method is deprecated']);
}

/**
 * Functions go through scripts/qa/appcheck-proxy.mjs (:5002), which adds the
 * App Check token the callables require; App Check itself stays off.
 */
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, functions: 5002, storage: 9199 } as const;
