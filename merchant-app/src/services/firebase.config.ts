import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';
import storage from '@react-native-firebase/storage';
import messaging from '@react-native-firebase/messaging';
import { EMULATOR_HOST, EMULATOR_PORTS } from './emulator';

try {
  firestore().settings({
    // No offline cache against the emulators: it is keyed by project, so it
    // would mix production documents into a local session and back.
    persistence: !EMULATOR_HOST,
    cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED,
  });
} catch (e) {
  // Settings may already be applied; safe to ignore.
}

// Debug builds only, and only when the simulator names a host (emulator.ts).
if (EMULATOR_HOST) {
  auth().useEmulator(`http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`);
  firestore().useEmulator(EMULATOR_HOST, EMULATOR_PORTS.firestore);
  functions().useEmulator(EMULATOR_HOST, EMULATOR_PORTS.functions);
  storage().useEmulator(EMULATOR_HOST, EMULATOR_PORTS.storage);
  console.log(`[firebase] Using local emulators on ${EMULATOR_HOST}`);

  // The iOS SDK's stream to the Firestore emulator is closed by the emulator
  // within a minute or two and isn't reopened until the app next comes to the
  // foreground, so every listener (balance, disputes, bills) goes stale.
  // Production isn't affected. Reopening it now and then keeps a QA session live.
  setInterval(() => {
    firestore()
      .disableNetwork()
      .then(() => firestore().enableNetwork())
      .catch(() => undefined);
  }, 20_000);
}

export { auth, firestore, functions, storage, messaging };
