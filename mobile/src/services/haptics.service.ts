import HapticFeedback from 'react-native-haptic-feedback';

export type HapticType = 'light' | 'medium' | 'success';

/**
 * Short taps through the system haptic engine (iOS Taptic Engine, Android
 * haptic feedback constants).
 *
 * This used to call Vibration.vibrate(8), but iOS ignores the duration and
 * plays its full ~400 ms vibration every time: each PIN digit buzzed like a
 * phone call, and typing quickly queued them up so the keypad felt laggy.
 */
const PATTERN = {
  light: 'impactLight',
  medium: 'impactMedium',
  success: 'notificationSuccess',
} as const;

const OPTIONS = {
  // No long vibration on phones without a haptic engine.
  enableVibrateFallback: false,
  // Respect the phone's "touch feedback" setting.
  ignoreAndroidSystemSettings: false,
};

export function triggerHaptic(type: HapticType = 'light') {
  try {
    HapticFeedback.trigger(PATTERN[type], OPTIONS);
  } catch {
    // Haptics should never block user actions.
  }
}
