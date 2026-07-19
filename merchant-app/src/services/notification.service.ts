import { Platform } from 'react-native';
import { messaging, firestore, auth } from './firebase.config';
import { logger } from '../utils/logger';

/**
 * Request permission (iOS) and save the FCM device token to Firestore
 * so the backend can send push notifications to this device.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      if (!enabled) return;
    }

    const token = await messaging().getToken();
    await saveTokenToFirestore(token);

    messaging().onTokenRefresh(async (newToken) => {
      await saveTokenToFirestore(newToken);
    });
  } catch (e) {
    logger.warn('Push notification registration failed:', e);
  }
}

async function saveTokenToFirestore(token: string): Promise<void> {
  const uid = auth().currentUser?.uid;
  if (!uid || !token) return;

  try {
    await firestore()
      .collection('users')
      .doc(uid)
      .collection('fcmTokens')
      .doc(token)
      .set({
        token,
        platform: Platform.OS,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    logger.warn('Failed to save FCM token:', e);
  }
}

/**
 * Remove the current device's FCM token on sign-out so notifications
 * stop being delivered to a logged-out device.
 */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const uid = auth().currentUser?.uid;
    const token = await messaging().getToken().catch(() => null);
    if (uid && token) {
      await firestore()
        .collection('users')
        .doc(uid)
        .collection('fcmTokens')
        .doc(token)
        .delete();
    }
  } catch (e) {
    logger.warn('Failed to remove FCM token:', e);
  }
}
