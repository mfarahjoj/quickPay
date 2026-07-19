import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';
import storage from '@react-native-firebase/storage';
import messaging from '@react-native-firebase/messaging';

try {
  firestore().settings({
    persistence: true,
    cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED,
  });
} catch (e) {
  // Settings may already be applied; safe to ignore.
}

if (__DEV__) {
  // Uncomment to use local emulators
  // functions().useFunctionsEmulator('http://localhost:5001');
  // firestore().useEmulator('localhost', 8080);
  // auth().useEmulator('http://localhost:9099');
}

export { auth, firestore, functions, storage, messaging };
