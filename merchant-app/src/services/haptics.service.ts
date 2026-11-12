import { Vibration } from 'react-native';
import HapticFeedback from 'react-native-haptic-feedback';

export type HapticType = 'light' | 'medium' | 'success' | 'payment';

/**
 * `payment` is deliberately longer and double-pulsed: money landing is the one
 * event a merchant must notice with the phone face-down on a loud counter, so
 * it stays a real vibration.
 */
const PAYMENT_PATTERN = [0, 120, 90, 240];

/**
 * Everything else is a short tap through the system haptic engine. It used
 * to call Vibration.vibrate(8), but iOS ignores the duration and plays its
 * full ~400 ms vibration, so every tap buzzed like a phone call.
 */
const PATTERN = {
  light: 'impactLight',
  medium: 'impactMedium',
  success: 'notificationSuccess',
} as const;

export function triggerHaptic(type: HapticType = 'light') {
  try {
    if (type === 'payment') {
      Vibration.vibrate(PAYMENT_PATTERN);
      return;
    }
    HapticFeedback.trigger(PATTERN[type], {
      enableVibrateFallback: false,
      ignoreAndroidSystemSettings: false,
    });
  } catch {
    // Haptics should never block user actions.
  }
}
