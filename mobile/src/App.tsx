import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Alert, Linking, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import AppNavigator, { navigationRef } from './navigation/AppNavigator';
import { ToastProvider } from './components/auth';
import { LanguageSync } from './i18n/useLanguageSync';
import { messaging, auth } from './services/firebase.config';
import { registerForPushNotifications } from './services/notification.service';
import crashlytics from '@react-native-firebase/crashlytics';
import { firebase } from '@react-native-firebase/app-check';
import { parseChargeLink } from './services/apiCharge.service';

/** Give up on a pending deep link if the customer hasn't unlocked the app by then. */
const PENDING_LINK_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Open the approval screen for an API charge once the app can show it. The
 * navigation container only mounts after sign-in and the app lock, so a link
 * opened from the checkout page waits for the customer to unlock first.
 */
function navigateToApiCharge(chargeId: string) {
  const startedAt = Date.now();
  const waitAndNavigate = () => {
    if (navigationRef.isReady() && auth().currentUser) {
      navigationRef.navigate('ApprovePayment', { chargeId });
    } else if (Date.now() - startedAt < PENDING_LINK_TIMEOUT_MS) {
      setTimeout(waitAndNavigate, 500);
    }
  };
  waitAndNavigate();
}

/** Push notifications for charges: in-person requests and API charges. */
function navigateFromNotification(data: Record<string, string>) {
  if (data.type === 'api_charge' && data.chargeId) {
    const chargeId = parseChargeLink(`zapppay://charge/${data.chargeId}`);
    if (chargeId) navigateToApiCharge(chargeId);
    return;
  }
  navigateToPaymentRequest(data);
}

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
        android: __DEV__
          ? { provider: 'debug', debugToken: 'D43FA50C-9835-4CC6-AAB7-B7CF0E2C2784' }
          : { provider: 'playIntegrity' },
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
      if (data?.type === 'payment_request' || data?.type === 'api_charge') {
        Alert.alert(
          remoteMessage.notification?.title ?? t('notifications.paymentRequestTitle'),
          remoteMessage.notification?.body ?? t('notifications.paymentRequestBody'),
          [
            { text: t('common.dismiss'), style: 'cancel' },
            { text: t('common.review'), onPress: () => navigateFromNotification(data) },
          ],
        );
      }
    });

    // Background / quit → user tapped the notification
    const unsubOpened = messaging().onNotificationOpenedApp((remoteMessage) => {
      const data = remoteMessage.data as Record<string, string> | undefined;
      if (data) navigateFromNotification(data);
    });

    // App was killed, opened via notification tap
    messaging()
      .getInitialNotification()
      .then((remoteMessage) => {
        if (remoteMessage?.data) {
          navigateFromNotification(remoteMessage.data as Record<string, string>);
        }
      });

    return () => {
      unsubForeground();
      unsubOpened();
    };
  }, [t]);

  // zapppay://charge/{id} — the "Open Zapp Pay" button on the hosted checkout.
  useEffect(() => {
    const open = (url: string | null) => {
      const chargeId = url ? parseChargeLink(url) : null;
      if (chargeId) navigateToApiCharge(chargeId);
    };
    Linking.getInitialURL().then(open).catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => open(url));
    return () => sub.remove();
  }, []);

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
