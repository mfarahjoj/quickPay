import { Platform, Vibration } from 'react-native';

export type HapticType = 'light' | 'medium' | 'success' | 'payment';

/**
 * `payment` is deliberately longer and double-pulsed: money landing is the one
 * event a merchant must notice with the phone face-down on a loud counter.
 */
const PAYMENT_PATTERN = [0, 120, 90, 240];

export function triggerHaptic(type: HapticType = 'light') {
  try {
    if (type === 'payment') {
      Vibration.vibrate(PAYMENT_PATTERN);
      return;
    }

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
