import 'react-native-gesture-handler';
import 'react-native-reanimated';
// Hermes/JSC may not define TextEncoder; required by qrcode (react-native-qrcode-svg).
import 'fast-text-encoding';
import './src/i18n';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
