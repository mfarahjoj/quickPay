import { Platform, Vibration } from 'react-native';

export type HapticType = 'light' | 'medium' | 'success';

export function triggerHaptic(type: HapticType = 'light') {
  try {
    if (Platform.OS === 'ios') {
      const duration = type === 'medium' ? 12 : type === 'success' ? 18 : 8;
      Vibration.vibrate(duration);
      return;
    }

    if (type === 'success') {
      Vibration.vibrate([0, 14, 26, 18]);
      return;
    }

    Vibration.vibrate(type === 'medium' ? 12 : 8);
  } catch {
    // Haptics should never block user actions.
  }
}
