import type { ComponentType } from 'react';
import { Platform, SafeAreaView as CoreSafeAreaView, type ViewProps } from 'react-native';
import { SafeAreaView as InsetSafeAreaView } from 'react-native-safe-area-context';

/**
 * React Native's own SafeAreaView pads only on iOS. On Android it is a plain
 * View, and Android 15+ draws every app under the status and navigation bars,
 * so headers and bottom buttons sat beneath them. Android takes its insets
 * from react-native-safe-area-context; iOS keeps the very component it had.
 */
export const SafeAreaView: ComponentType<ViewProps> =
  Platform.OS === 'android' ? InsetSafeAreaView : CoreSafeAreaView;
