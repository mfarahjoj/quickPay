import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Alert, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import AppNavigator, { navigationRef } from './navigation/AppNavigator';
import { UpdateRequired } from './components/UpdateRequired';
import { useUpdateGate } from './hooks/useUpdateGate';
import { ToastProvider } from './components/auth';
import { LanguageSync } from './i18n/useLanguageSync';
import { messaging, auth } from './services/firebase.config';
import { registerForPushNotifications } from './services/notification.service';
import crashlytics from '@react-native-firebase/crashlytics';
import { firebase } from '@react-native-firebase/app-check';

function AppContent() {
  const { t } = useTranslation();

  useEffect(() => {
    crashlytics().setCrashlyticsCollectionEnabled(true);

    try {
      const provider = firebase.appCheck().newReactNativeFirebaseAppCheckProvider();
      provider.configure({
        // Debug tokens must be registered in Firebase Console → App Check →
        // the merchant iOS / Android app → Manage debug tokens.
        apple: __DEV__
          ? { provider: 'debug', debugToken: 'ACB49DE0-2AE8-48A8-92DC-3EF16B02FDC9' }
          : { provider: 'appAttestWithDeviceCheckFallback' },
        android: __DEV__
          ? { provider: 'debug', debugToken: '2D05C996-017D-4B9A-976C-AB191AA7DF0A' }
          : { provider: 'playIntegrity' },
      });
      firebase.appCheck().initializeAppCheck({ provider, isTokenAutoRefreshEnabled: true });
    } catch {
      // App Check setup should not block app launch.
    }
  }, []);

  useEffect(() => {
    const unsubAuth = auth().onAuthStateChanged((user) => {
      if (user) {
        registerForPushNotifications();
      }
    });
    return unsubAuth;
  }, []);

  useEffect(() => {
    const unsubForeground = messaging().onMessage(async (remoteMessage) => {
      const data = remoteMessage.data as Record<string, string> | undefined;
      if (data?.type === 'payment_approved' || data?.type === 'payment_rejected') {
        Alert.alert(
          remoteMessage.notification?.title ?? t('notifications.paymentUpdateTitle'),
          remoteMessage.notification?.body ?? t('notifications.paymentUpdateBody'),
        );
      }
    });

    const unsubOpened = messaging().onNotificationOpenedApp((_remoteMessage) => {
      // Navigate to relevant screen if needed
    });

    messaging()
      .getInitialNotification()
      .then((_remoteMessage) => {
        // Handle cold-start from notification if needed
      });

    return () => {
      unsubForeground();
      unsubOpened();
    };
  }, []);

  // After the App Check setup above: the gate's first read should carry a token.
  const updateGate = useUpdateGate();

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ToastProvider>
          <LanguageSync />
          {updateGate.required ? (
            <UpdateRequired updateUrl={updateGate.updateUrl} />
          ) : (
            <AppNavigator />
          )}
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  return <AppContent />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
