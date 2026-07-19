import 'react-native-gesture-handler';
import 'react-native-reanimated';
import 'fast-text-encoding';
import './src/i18n';
import {AppRegistry} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';

// Initialize App Check before any Firebase service is used so that
// production builds (TestFlight/App Store) get a valid token early.
try {
  const { firebase } = require('@react-native-firebase/app-check');
  const provider = firebase.appCheck().newReactNativeFirebaseAppCheckProvider();
  provider.configure({
    apple: { provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback' },
    android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
  });
  firebase.appCheck().initializeAppCheck({ provider, isTokenAutoRefreshEnabled: true });
} catch (_) {
  // App Check failure must never prevent the app from launching.
}

AppRegistry.registerComponent(appName, () => App);
