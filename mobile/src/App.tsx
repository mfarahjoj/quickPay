import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Alert, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import AppNavigator, { navigationRef } from './navigation/AppNavigator';
import { ToastProvider } from './components/auth';
import { LanguageSync } from './i18n/useLanguageSync';
import { messaging, auth } from './services/firebase.config';
import { registerForPushNotifications } from './services/notification.service';
import crashlytics from '@react-native-firebase/crashlytics';
import { firebase } from '@react-native-firebase/app-check';

function navigateToPaymentRequest(data: Record<string, string>) {
  if (
    data.type !== 'payment_request' ||
    !data.requestId ||
    !data.merchantName ||
    !data.amount ||
    !data.currency
  ) {
    return;
  }

  const waitAndNavigate = () => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('ApprovePayment', {
        requestId: data.requestId,
        merchantName: data.merchantName,
        amount: Number(data.amount),
        currency: data.currency,
        ...(data.reference ? { reference: data.reference } : {}),
      });
    } else {
      setTimeout(waitAndNavigate, 500);
    }
  };
  waitAndNavigate();
}

function AppContent() {
  const { t } = useTranslation();

  useEffect(() => {
    try {
      crashlytics().setCrashlyticsCollectionEnabled(true);
    } catch {
      // Crashlytics may be unavailable in some dev builds.
    }

    try {
      const provider = firebase.appCheck().newReactNativeFirebaseAppCheckProvider();
      provider.configure({
        // Debug token must be registered in Firebase Console → App Check →
        // QuickPay iOS app → Manage debug tokens.
        apple: __DEV__
          ? { provider: 'debug', debugToken: '283DB4D1-8021-4A99-AF78-64C1125D0A13' }
          : { provider: 'appAttestWithDeviceCheckFallback' },
        android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
      });
      firebase.appCheck().initializeAppCheck({ provider, isTokenAutoRefreshEnabled: true });
    } catch {
      // App Check setup should not block app launch.
    }
  }, []);

  useEffect(() => {
    const unsubAuth = auth().onAuthStateChanged(async (user) => {
      if (!user) return;
      // New signups get the permission dialog on the success screen instead
      // of mid-OTP; only auto-register once setup has completed.
      const setupDone = await AsyncStorage.getItem('@quickpay_biometric_setup_done');
      if (setupDone === 'true') {
        registerForPushNotifications();
      }
    });
    return unsubAuth;
  }, []);

  useEffect(() => {
    // Foreground notification — show an alert so user can tap through
    const unsubForeground = messaging().onMessage(async (remoteMessage) => {
      const data = remoteMessage.data as Record<string, string> | undefined;
      if (data?.type === 'payment_request') {
        Alert.alert(
          remoteMessage.notification?.title ?? t('notifications.paymentRequestTitle'),
          remoteMessage.notification?.body ?? t('notifications.paymentRequestBody'),
          [
            { text: t('common.dismiss'), style: 'cancel' },
            { text: t('common.review'), onPress: () => navigateToPaymentRequest(data) },
          ],
        );
      }
    });

    // Background / quit → user tapped the notification
    const unsubOpened = messaging().onNotificationOpenedApp((remoteMessage) => {
      const data = remoteMessage.data as Record<string, string> | undefined;
      if (data) navigateToPaymentRequest(data);
    });

    // App was killed, opened via notification tap
    messaging()
      .getInitialNotification()
      .then((remoteMessage) => {
        if (remoteMessage?.data) {
          navigateToPaymentRequest(remoteMessage.data as Record<string, string>);
        }
      });

    return () => {
      unsubForeground();
      unsubOpened();
    };
  }, [t]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ToastProvider>
          <LanguageSync />
          <AppNavigator />
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
